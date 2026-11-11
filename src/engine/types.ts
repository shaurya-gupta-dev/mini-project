/**
 * Core type definitions for AegisLLM detection and redaction engine.
 */

export type EntityType =
  // Cloud & Developer Credentials
  | 'OPENAI_API_KEY'
  | 'ANTHROPIC_API_KEY'
  | 'AWS_ACCESS_KEY'
  | 'AWS_SECRET_KEY'
  | 'GITHUB_TOKEN'
  | 'GOOGLE_API_KEY'
  | 'SLACK_TOKEN'
  | 'GENERIC_API_KEY'
  | 'HUGGINGFACE_TOKEN'
  | 'GITLAB_TOKEN'
  | 'STRIPE_KEY'
  | 'DATABASE_URL'
  | 'PRIVATE_KEY'
  | 'JWT_TOKEN'
  | 'PASSWORD'
  // Personal Identifiable Information (PII)
  | 'EMAIL'
  | 'PHONE_NUMBER'
  | 'IPV4'
  | 'IPV6'
  | 'SSN'
  // Financial Data
  | 'CREDIT_CARD'
  // Unstructured Secrets
  | 'HIGH_ENTROPY_SECRET';

export type DetectionTier =
  | 'TIER1_REGEX'
  | 'TIER2_LUHN'
  | 'TIER3_ENTROPY'
  | 'TIER4_NER';

export interface DetectedEntity {
  type: EntityType;
  raw: string;
  startIndex: number;
  endIndex: number;
  tier: DetectionTier;
  confidence: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface RedactionResult {
  originalText: string;
  redactedText: string;
  entities: DetectedEntity[];
  vault: Record<string, string>;
  durationMs: number;
}

export interface DetectionOptions {
  enableEntropy?: boolean;
  minEntropyThreshold?: number;
  excludedTypes?: EntityType[];
  allowedSecrets?: Set<string>;
}

