/**
 * AegisLLM AWS Lambda Telemetry Ingestion Handler
 *
 * Privacy Invariants:
 * 1. ZERO PLAINTEXT: Strictly rejects any payload containing raw prompt text or secrets.
 * 2. ANONYMIZED COUNTERS: Updates atomic daily decision counters in DynamoDB (REDACTED vs KEPT).
 * 3. FEEDBACK LOOP: Powers automatic detector override rate calculation:
 *    Override Rate = KEPT / (REDACTED + KEPT)
 */

export interface TelemetryEventPayload {
  detectorType: string;
  userAction: 'REDACTED' | 'KEPT';
  confidence: number;
  clientTimestamp: number;
}

export interface APIGatewayEventLike {
  httpMethod?: string | undefined;
  requestContext?:
    | {
        http?:
          | {
              method?: string | undefined;
            }
          | undefined;
      }
    | undefined;
  body: string | null;
  headers?: Record<string, string | undefined> | undefined;
}

export interface APIGatewayResponseLike {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface DynamoDBUpdateItemInput {
  TableName: string;
  Key: {
    detectorType_date: { S: string };
    userAction: { S: string };
  };
  UpdateExpression: string;
  ExpressionAttributeValues: {
    ':inc': { N: string };
    ':conf': { N: string };
    ':ttl': { N: string };
    ':updated': { S: string };
  };
}

// Security guard: disallowed keys that indicate leakage of user content or raw secrets
const FORBIDDEN_CONTENT_KEYS = new Set([
  'prompt',
  'raw',
  'secret',
  'key',
  'token',
  'text',
  'body',
  'content',
  'input',
  'value',
  'message',
]);

const ALLOWED_DETECTOR_TYPES = new Set([
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'AWS_ACCESS_KEY',
  'AWS_SECRET_KEY',
  'GITHUB_TOKEN',
  'GOOGLE_API_KEY',
  'SLACK_TOKEN',
  'STRIPE_KEY',
  'HUGGINGFACE_TOKEN',
  'GITLAB_TOKEN',
  'DATABASE_URL',
  'PRIVATE_KEY',
  'JWT_TOKEN',
  'PASSWORD',
  'CREDIT_CARD',
  'INDIAN_PAN',
  'INDIAN_AADHAAR',
  'US_SSN',
  'SSN',
  'EMAIL',
  'PHONE_NUMBER',
  'IPV4',
  'IPV6',
  'IPV4_ADDRESS',
  'IPV6_ADDRESS',
  'HIGH_ENTROPY_SECRET',
  'GENERIC_API_KEY',
]);

/**
 * Validates incoming telemetry payload against zero-plaintext rules and schema.
 */
export function validateTelemetryPayload(data: unknown): {
  valid: boolean;
  error?: string;
  payload?: TelemetryEventPayload;
} {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Payload must be a non-null JSON object.' };
  }

  const obj = data as Record<string, unknown>;

  // Zero-plaintext audit: reject any forbidden text/secret keys
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_CONTENT_KEYS.has(key.toLowerCase())) {
      return {
        valid: false,
        error: `Security violation: Forbidden key '${key}' detected. Zero-plaintext rule strictly enforced.`,
      };
    }
  }

  // Validate detectorType
  if (typeof obj.detectorType !== 'string' || !ALLOWED_DETECTOR_TYPES.has(obj.detectorType)) {
    return { valid: false, error: `Invalid or unrecognized detectorType: ${String(obj.detectorType)}` };
  }

  // Validate userAction
  if (obj.userAction !== 'REDACTED' && obj.userAction !== 'KEPT') {
    return { valid: false, error: "userAction must be exactly 'REDACTED' or 'KEPT'." };
  }

  // Validate confidence (0.0 to 1.0)
  if (
    typeof obj.confidence !== 'number' ||
    isNaN(obj.confidence) ||
    obj.confidence < 0 ||
    obj.confidence > 1.0
  ) {
    return { valid: false, error: 'confidence must be a number between 0.0 and 1.0.' };
  }

  // Validate clientTimestamp (must be within last 48 hours and not in future)
  if (typeof obj.clientTimestamp !== 'number') {
    return { valid: false, error: 'clientTimestamp must be a numeric epoch timestamp (ms).' };
  }

  const now = Date.now();
  const fortyEightHoursMs = 48 * 60 * 60 * 1000;
  if (obj.clientTimestamp < now - fortyEightHoursMs || obj.clientTimestamp > now + 300000) {
    return { valid: false, error: 'clientTimestamp is outside allowable time window.' };
  }

  return {
    valid: true,
    payload: {
      detectorType: obj.detectorType,
      userAction: obj.userAction,
      confidence: obj.confidence,
      clientTimestamp: obj.clientTimestamp,
    },
  };
}

/**
 * Computes feedback loop override rate:
 * Override Rate = KEPT / (REDACTED + KEPT)
 */
export function calculateOverrideRate(redactedCount: number, keptCount: number): {
  rate: number;
  totalDecisions: number;
  recommendation: 'TUNING_NEEDED' | 'BALANCED' | 'INSUFFICIENT_DATA';
} {
  const totalDecisions = redactedCount + keptCount;
  if (totalDecisions < 10) {
    return { rate: 0, totalDecisions, recommendation: 'INSUFFICIENT_DATA' };
  }

  const rate = keptCount / totalDecisions;
  // If user chooses "Leave as is" more than 25% of the time, detector has high false positives
  const recommendation = rate > 0.25 ? 'TUNING_NEEDED' : 'BALANCED';

  return { rate, totalDecisions, recommendation };
}

/**
 * Builds the atomic DynamoDB UpdateItem parameters for tracking decision aggregates.
 */
export function buildDynamoDBUpdateParams(
  payload: TelemetryEventPayload,
  tableName = 'AegisTelemetry'
): DynamoDBUpdateItemInput {
  const dateStr = new Date(payload.clientTimestamp).toISOString().slice(0, 10); // YYYY-MM-DD
  const partitionKey = `${payload.detectorType}#${dateStr}`;
  const thirtyDaysSec = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

  return {
    TableName: tableName,
    Key: {
      detectorType_date: { S: partitionKey },
      userAction: { S: payload.userAction },
    },
    UpdateExpression:
      'ADD eventCount :inc, totalConfidence :conf SET ttl = :ttl, lastUpdated = :updated',
    ExpressionAttributeValues: {
      ':inc': { N: '1' },
      ':conf': { N: payload.confidence.toFixed(4) },
      ':ttl': { N: thirtyDaysSec.toString() },
      ':updated': { S: new Date().toISOString() },
    },
  };
}

interface AwsDynamoSdkModule {
  DynamoDBClient: new (config: Record<string, never>) => {
    send: (command: unknown) => Promise<unknown>;
  };
  UpdateItemCommand: new (input: DynamoDBUpdateItemInput) => unknown;
}

let cachedDynamoDbClient: { updateItem: (params: DynamoDBUpdateItemInput) => Promise<unknown> } | null = null;

/**
 * Resolves the built-in AWS SDK v3 DynamoDB client inside AWS Lambda Node.js runtime.
 */
async function getDefaultDynamoDbClient(): Promise<{
  updateItem: (params: DynamoDBUpdateItemInput) => Promise<unknown>;
}> {
  if (cachedDynamoDbClient) {
    return cachedDynamoDbClient;
  }

  const awsDynamoModule = '@aws-sdk/client-dynamodb';
  const sdk = (await import(awsDynamoModule)) as AwsDynamoSdkModule;
  const client = new sdk.DynamoDBClient({});

  cachedDynamoDbClient = {
    updateItem: (params: DynamoDBUpdateItemInput) => client.send(new sdk.UpdateItemCommand(params)),
  };
  return cachedDynamoDbClient;
}

/**
 * Extracts HTTP method across API Gateway REST v1, HTTP API v2, and Lambda Function URLs.
 */
function extractHttpMethod(event: APIGatewayEventLike): string {
  return (event.httpMethod || event.requestContext?.http?.method || '').toUpperCase();
}

/**
 * Standard AWS Lambda Handler for API Gateway / Function URL integration.
 */
export async function handler(
  event: APIGatewayEventLike,
  dynamoDbClient?: { updateItem: (params: DynamoDBUpdateItemInput) => Promise<unknown> }
): Promise<APIGatewayResponseLike> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Api-Key',
  };

  const method = extractHttpMethod(event);

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (method !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  if (!event.body) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing request body' }),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Malformed JSON payload' }),
    };
  }

  const validation = validateTelemetryPayload(parsed);
  if (!validation.valid || !validation.payload) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: validation.error }),
    };
  }

  const tableName = process.env.TELEMETRY_TABLE || 'AegisTelemetry';
  const updateParams = buildDynamoDBUpdateParams(validation.payload, tableName);

  try {
    const runningInLambda = Boolean(
      process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_EXECUTION_ENV
    );
    const activeClient =
      dynamoDbClient ?? (runningInLambda ? await getDefaultDynamoDbClient() : null);

    if (activeClient) {
      await activeClient.updateItem(updateParams);
    }
  } catch (err) {
    console.error('[Telemetry] DynamoDB update failed:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal persistence error' }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      status: 'recorded',
      detectorType: validation.payload.detectorType,
      userAction: validation.payload.userAction,
      feedbackLoop: 'active',
    }),
  };
}

