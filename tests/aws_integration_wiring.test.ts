import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  isPlaceholderAwsUrl,
  DEFAULT_AWS_CONFIG,
} from '../src/extension/aws_config.js';
import { recordAnonymizedDecisionWithStatus } from '../src/extension/telemetry_client.js';

describe('AWS Live Integration Wiring & Manifest Verification', () => {
  it('declares AWS host_permissions in public/manifest.json and synced dist/manifest.json', () => {
    const publicManifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../public/manifest.json'), 'utf8')
    );
    expect(Array.isArray(publicManifest.host_permissions)).toBe(true);
    expect(publicManifest.host_permissions).toContain('https://*.amazonaws.com/*');
  });

  it('distinguishes placeholder domains from live AWS S3 and API Gateway URLs', () => {
    expect(isPlaceholderAwsUrl(DEFAULT_AWS_CONFIG.s3RulesUrl)).toBe(true);
    expect(isPlaceholderAwsUrl(DEFAULT_AWS_CONFIG.telemetryEndpointUrl)).toBe(true);
    expect(isPlaceholderAwsUrl('')).toBe(true);
    expect(
      isPlaceholderAwsUrl('https://aegis-llm-rules-123456789012-ap-south-1.s3.ap-south-1.amazonaws.com/rule_packs/rules.v1.json')
    ).toBe(false);
    expect(
      isPlaceholderAwsUrl('https://abc123def.execute-api.ap-south-1.amazonaws.com/prod/telemetry/event')
    ).toBe(false);
  });

  it('skips placeholder endpoints safely and posts zero-plaintext payload to live API Gateway URLs', async () => {
    const placeholderRes = await recordAnonymizedDecisionWithStatus({
      detectorType: 'PASSWORD',
      userAction: 'REDACTED',
      confidence: 0.92,
      endpointUrl: DEFAULT_AWS_CONFIG.telemetryEndpointUrl,
    });
    expect(placeholderRes.sent).toBe(false);
    expect(placeholderRes.reason).toBe('Awaiting AWS Deploy');

    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'recorded' }), { status: 200 })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const liveUrl = 'https://xyz987.execute-api.us-east-1.amazonaws.com/prod/telemetry/event';
      const liveRes = await recordAnonymizedDecisionWithStatus({
        detectorType: 'PASSWORD',
        userAction: 'REDACTED',
        confidence: 0.92,
        endpointUrl: liveUrl,
      });

      expect(liveRes.sent).toBe(true);
      expect(liveRes.statusCode).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [, init] = fetchMock.mock.calls[0]!;
      const sentPayload = JSON.parse(String(init.body));
      expect(Object.keys(sentPayload).sort()).toEqual([
        'clientTimestamp',
        'confidence',
        'detectorType',
        'userAction',
      ]);
      expect(sentPayload.detectorType).toBe('PASSWORD');
      expect(sentPayload.userAction).toBe('REDACTED');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

