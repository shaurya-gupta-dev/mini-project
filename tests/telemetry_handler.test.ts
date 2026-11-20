import { describe, it, expect, vi } from 'vitest';
import {
  validateTelemetryPayload,
  calculateOverrideRate,
  buildDynamoDBUpdateParams,
  handler,
  APIGatewayEventLike,
} from '../src/aws/telemetry_handler.js';

describe('AWS DynamoDB & Lambda Zero-Plaintext Telemetry Pipeline', () => {
  describe('Zero-Plaintext Security & Schema Enforcement', () => {
    it('accepts valid anonymized decision payload', () => {
      const result = validateTelemetryPayload({
        detectorType: 'OPENAI_API_KEY',
        userAction: 'REDACTED',
        confidence: 0.99,
        clientTimestamp: Date.now() - 5000,
      });

      expect(result.valid).toBe(true);
      expect(result.payload?.detectorType).toBe('OPENAI_API_KEY');
      expect(result.payload?.userAction).toBe('REDACTED');
    });

    it('STRICTLY REJECTS payloads containing forbidden plaintext keys', () => {
      const violations = [
        { detectorType: 'OPENAI_API_KEY', userAction: 'REDACTED', confidence: 0.99, clientTimestamp: Date.now(), prompt: 'hello' },
        { detectorType: 'OPENAI_API_KEY', userAction: 'REDACTED', confidence: 0.99, clientTimestamp: Date.now(), secret: 'sk-123' },
        { detectorType: 'OPENAI_API_KEY', userAction: 'REDACTED', confidence: 0.99, clientTimestamp: Date.now(), raw: 'AKIA123' },
        { detectorType: 'OPENAI_API_KEY', userAction: 'REDACTED', confidence: 0.99, clientTimestamp: Date.now(), text: 'my api key' },
        { detectorType: 'OPENAI_API_KEY', userAction: 'REDACTED', confidence: 0.99, clientTimestamp: Date.now(), token: 'ghp_456' },
      ];

      for (const payload of violations) {
        const res = validateTelemetryPayload(payload);
        expect(res.valid).toBe(false);
        expect(res.error).toContain('Security violation');
      }
    });

    it('rejects invalid userAction or confidence out of bounds', () => {
      expect(
        validateTelemetryPayload({
          detectorType: 'OPENAI_API_KEY',
          userAction: 'INVALID',
          confidence: 0.95,
          clientTimestamp: Date.now(),
        }).valid
      ).toBe(false);

      expect(
        validateTelemetryPayload({
          detectorType: 'OPENAI_API_KEY',
          userAction: 'REDACTED',
          confidence: 1.5, // > 1.0
          clientTimestamp: Date.now(),
        }).valid
      ).toBe(false);
    });
  });

  describe('Adaptive Feedback Loop (Override Rate Calculation)', () => {
    it('returns INSUFFICIENT_DATA when sample count < 10', () => {
      const res = calculateOverrideRate(5, 2);
      expect(res.recommendation).toBe('INSUFFICIENT_DATA');
      expect(res.totalDecisions).toBe(7);
    });

    it('identifies BALANCED detectors when override rate <= 25%', () => {
      // 90 redacted, 10 kept -> 10% override rate
      const res = calculateOverrideRate(90, 10);
      expect(res.rate).toBeCloseTo(0.1, 2);
      expect(res.recommendation).toBe('BALANCED');
    });

    it('flags TUNING_NEEDED when override rate > 25% (signals false positives)', () => {
      // 50 redacted, 50 kept -> 50% override rate (user frequently overrides the detector)
      const res = calculateOverrideRate(50, 50);
      expect(res.rate).toBe(0.5);
      expect(res.recommendation).toBe('TUNING_NEEDED');
    });
  });

  describe('DynamoDB UpdateItem Parameter Generation', () => {
    it('generates atomic update expression with composite partition key and 30-day TTL', () => {
      const now = new Date('2026-11-10T12:00:00Z').getTime();
      const params = buildDynamoDBUpdateParams(
        {
          detectorType: 'HIGH_ENTROPY_SECRET',
          userAction: 'KEPT',
          confidence: 0.88,
          clientTimestamp: now,
        },
        'CustomTelemetryTable'
      );

      expect(params.TableName).toBe('CustomTelemetryTable');
      expect(params.Key.detectorType_date.S).toBe('HIGH_ENTROPY_SECRET#2026-11-10');
      expect(params.Key.userAction.S).toBe('KEPT');
      expect(params.UpdateExpression).toContain('ADD eventCount :inc, totalConfidence :conf');
      expect(params.ExpressionAttributeValues[':inc'].N).toBe('1');
      expect(params.ExpressionAttributeValues[':conf'].N).toBe('0.8800');
      expect(Number(params.ExpressionAttributeValues[':ttl'].N)).toBeGreaterThan(now / 1000);
    });
  });

  describe('Lambda Execution Handler', () => {
    it('handles CORS OPTIONS preflight request', async () => {
      const event: APIGatewayEventLike = {
        httpMethod: 'OPTIONS',
        body: null,
      };
      const res = await handler(event);
      expect(res.statusCode).toBe(204);
      expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    });

    it('rejects non-POST HTTP methods', async () => {
      const event: APIGatewayEventLike = {
        httpMethod: 'GET',
        body: null,
      };
      const res = await handler(event);
      expect(res.statusCode).toBe(405);
    });

    it('rejects security violations with 400 Bad Request', async () => {
      const event: APIGatewayEventLike = {
        httpMethod: 'POST',
        body: JSON.stringify({
          detectorType: 'OPENAI_API_KEY',
          userAction: 'REDACTED',
          confidence: 0.95,
          clientTimestamp: Date.now(),
          prompt: 'Leaked plaintext prompt',
        }),
      };
      const res = await handler(event);
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('Security violation');
    });

    it('successfully processes valid event and invokes DynamoDB client updateItem', async () => {
      const updateItemMock = vi.fn().mockResolvedValue({});
      const event: APIGatewayEventLike = {
        httpMethod: 'POST',
        body: JSON.stringify({
          detectorType: 'CREDIT_CARD',
          userAction: 'REDACTED',
          confidence: 0.99,
          clientTimestamp: Date.now() - 1000,
        }),
      };

      const res = await handler(event, { updateItem: updateItemMock });
      expect(res.statusCode).toBe(200);
      expect(updateItemMock).toHaveBeenCalledTimes(1);

      const parsedRes = JSON.parse(res.body);
      expect(parsedRes.status).toBe('recorded');
      expect(parsedRes.detectorType).toBe('CREDIT_CARD');
      expect(parsedRes.feedbackLoop).toBe('active');
    });

    it('supports API Gateway HTTP API v2 requestContext.http.method and extended detector types', async () => {
      const updateItemMock = vi.fn().mockResolvedValue({});
      const preflightRes = await handler({
        requestContext: { http: { method: 'OPTIONS' } },
        body: null,
      });
      expect(preflightRes.statusCode).toBe(204);

      for (const detectorType of ['PASSWORD', 'DATABASE_URL', 'HUGGINGFACE_TOKEN', 'IPV4']) {
        const res = await handler(
          {
            requestContext: { http: { method: 'POST' } },
            body: JSON.stringify({
              detectorType,
              userAction: 'KEPT',
              confidence: 0.92,
              clientTimestamp: Date.now() - 500,
            }),
          },
          { updateItem: updateItemMock }
        );
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).detectorType).toBe(detectorType);
      }

      expect(updateItemMock).toHaveBeenCalledTimes(4);
    });
  });
});

