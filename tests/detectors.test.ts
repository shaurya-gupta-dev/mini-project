import { describe, it, expect } from 'vitest';
import { scanTier1Regex } from '../src/engine/tier1_regex.js';
import { scanTier2Luhn, passesLuhnChecksum } from '../src/engine/tier2_luhn.js';
import {
  calculateShannonEntropy,
  scanTier3Entropy,
} from '../src/engine/tier3_entropy.js';
import {
  detectEntities,
  redactText,
  unmaskText,
} from '../src/engine/detector_pipeline.js';

describe('Tier 1: Deterministic Regex Matchers', () => {
  it('detects OpenAI API keys (both legacy and project keys)', () => {
    const text = 'Use key sk-proj-99887766554433221100aabbccddeeffgghh in your config.';
    const results = scanTier1Regex(text);
    expect(results.length).toBe(1);
    expect(results[0]!.type).toBe('OPENAI_API_KEY');
    expect(results[0]!.raw).toBe('sk-proj-99887766554433221100aabbccddeeffgghh');
  });

  it('detects Anthropic API keys', () => {
    const text = 'export ANTHROPIC_API_KEY="sk-ant-api03-abcdef1234567890abcdef1234567890"';
    const results = scanTier1Regex(text);
    expect(results.length).toBe(1);
    expect(results[0]!.type).toBe('ANTHROPIC_API_KEY');
  });

  it('detects AWS Access Keys', () => {
    const text = 'AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE"';
    const results = scanTier1Regex(text);
    expect(results.length).toBe(1);
    expect(results[0]!.type).toBe('AWS_ACCESS_KEY');
    expect(results[0]!.raw).toBe('AKIAIOSFODNN7EXAMPLE');
  });

  it('detects GitHub Personal Access Tokens', () => {
    const text = 'git clone https://ghp_11223344556677889900aabbccddeeff1234@github.com/repo';
    const results = scanTier1Regex(text);
    expect(results.length).toBe(1);
    expect(results[0]!.type).toBe('GITHUB_TOKEN');
  });

  it('detects Google / Gemini API keys', () => {
    const text = 'GEMINI_KEY="AIzaSyD-1234567890abcdefghijklmnopqrstuv"';
    const results = scanTier1Regex(text);
    expect(results.length).toBe(1);
    expect(results[0]!.type).toBe('GOOGLE_API_KEY');
  });

  it('detects email addresses', () => {
    const text = 'Contact support at security.team+alerts@company.co.uk immediately.';
    const results = scanTier1Regex(text);
    expect(results.length).toBe(1);
    expect(results[0]!.type).toBe('EMAIL');
    expect(results[0]!.raw).toBe('security.team+alerts@company.co.uk');
  });

  it('detects US Social Security Numbers', () => {
    const text = 'Patient SSN is 123-45-6789 on the medical intake form.';
    const results = scanTier1Regex(text);
    expect(results.length).toBe(1);
    expect(results[0]!.type).toBe('SSN');
    expect(results[0]!.raw).toBe('123-45-6789');
  });

  it('detects IPv4 addresses while ignoring 0.0.0.0', () => {
    const text = 'Bind host 192.168.1.105 instead of default 0.0.0.0.';
    const results = scanTier1Regex(text);
    expect(results.length).toBe(1);
    expect(results[0]!.type).toBe('IPV4');
    expect(results[0]!.raw).toBe('192.168.1.105');
  });

  it('detects phone numbers', () => {
    const text = 'Call me at (555) 234-5678 or India mobile +91 9876543210.';
    const results = scanTier1Regex(text);
    expect(results.length).toBe(2);
    expect(results.every((r) => r.type === 'PHONE_NUMBER')).toBe(true);
  });

  it('does not match phone number inside 16 digit number or UUID', () => {
    const res1 = scanTier1Regex('const orderId = "1234567812345678";');
    expect(res1).toEqual([]);
    const res2 = scanTier1Regex('const sessionUUID = "550e8400-e29b-41d4-a716-446655440000";');
    expect(res2).toEqual([]);
  });

  it('detects generic API key and secret assignments with captureGroupIndex 2', () => {
    const text1 = 'MY_API_KEY="abcdef1234567890abcdef"';
    const text2 = 'export SECRET_KEY=12345678901234567890';
    const text3 = 'const auth_key: "abcdef1234567890"';
    const text4 = 'private_key="abcdef1234567890"';

    const res1 = scanTier1Regex(text1);
    expect(res1.length).toBe(1);
    expect(res1[0]!.type).toBe('GENERIC_API_KEY');
    expect(res1[0]!.raw).toBe('abcdef1234567890abcdef');

    const res2 = scanTier1Regex(text2);
    expect(res2.length).toBe(1);
    expect(res2[0]!.type).toBe('GENERIC_API_KEY');
    expect(res2[0]!.raw).toBe('12345678901234567890');

    const res3 = scanTier1Regex(text3);
    expect(res3.length).toBe(1);
    expect(res3[0]!.type).toBe('GENERIC_API_KEY');
    expect(res3[0]!.raw).toBe('abcdef1234567890');

    const res4 = scanTier1Regex(text4);
    expect(res4.length).toBe(1);
    expect(res4[0]!.type).toBe('GENERIC_API_KEY');
    expect(res4[0]!.raw).toBe('abcdef1234567890');
  });

  it('does NOT match bare token, csrf_token, xsrf_token, at, or f.sid as GENERIC_API_KEY', () => {
    const text = `
      token="1234567890abcdef1234567890abcdef"
      csrf_token="1234567890abcdef1234567890abcdef"
      xsrf_token="1234567890abcdef1234567890abcdef"
      at="AB1234CD1234567890abcdef"
      f.sid="1234567890abcdef1234567890abcdef"
      _reqid="1234567890abcdef"
    `;
    const results = scanTier1Regex(text);
    const genericApiKeyMatches = results.filter((r) => r.type === 'GENERIC_API_KEY');
    expect(genericApiKeyMatches).toEqual([]);
  });
});

describe('Tier 2: Luhn Modulo 10 Checksum (Credit Cards)', () => {
  it('correctly validates test cards passing Luhn checksum', () => {
    // Standard test card numbers (Test Visa & Test Mastercard)
    expect(passesLuhnChecksum('4532015112830366')).toBe(true);
    expect(passesLuhnChecksum('5424180123456789')).toBe(true);
  });

  it('rejects arbitrary 16-digit order numbers that fail Luhn', () => {
    // 16-digit number that fails Luhn checksum
    expect(passesLuhnChecksum('1234567812345678')).toBe(false);
    expect(passesLuhnChecksum('0000000000000000')).toBe(false);
  });

  it('detects real card formats in text and rejects invalid numbers', () => {
    const text = `
      Valid Visa: 4532 0151 1283 0366
      Invalid Order ID: 1234 5678 1234 5678
      Another Visa: 4532-0151-1283-0366
    `;
    const results = scanTier2Luhn(text);
    expect(results.length).toBe(2);
    expect(results.every((r) => r.type === 'CREDIT_CARD')).toBe(true);
  });
});

describe('Tier 3: Shannon Information Entropy Analyzer', () => {
  it('calculates higher entropy for cryptographic secrets than plain English', () => {
    const englishText = 'the quick brown fox jumps over the lazy dog';
    const secretKey = 'K9#xP2$mQ8!vL4@wZ7&rT1*bN5^yC3%u';

    const englishEntropy = calculateShannonEntropy(englishText);
    const secretEntropy = calculateShannonEntropy(secretKey);

    expect(secretEntropy).toBeGreaterThan(englishEntropy);
    expect(secretEntropy).toBeGreaterThan(4.2);
  });

  it('detects high-entropy secret tokens and ignores standard UUIDs', () => {
    const text = `
      const config = {
        secret: "qW9$eR2*tY5^uI8(oP1_aS4+dF7-gH0",
        uuid: "550e8400-e29b-41d4-a716-446655440000",
        greeting: "hello world how are you doing today"
      };
    `;

    const results = scanTier3Entropy(text);
    expect(results.length).toBe(1);
    expect(results[0]!.type).toBe('HIGH_ENTROPY_SECRET');
    expect(results[0]!.raw).toContain('qW9$eR2');
  });

  it('rejects URLs, model slugs, and package paths as false positives in Tier 3', () => {
    const text = `
      custom_providers:
        - name: "APInex"
          base_url: "https://api.apinex.bond/v1"
          key_env: "OPENAI_API_KEY"
          api_mode: "chat_completions"
          discover_models: false
          models:
            - "free/glm-5.3-flash"
            - "free/deepseek-v4.1-flash"
            - "claude-opus-5.5"
            - "claude-sonnet-5.5"
            - "gpt-6.1-sol"
            - "free/gemini-3.8-flash"
            - "free/qwen-3.8-max"
            - "free/kimi-k3"
            - "free/deepseek-v4-pro-0813"
            - "free/deepseek-v4-flash-0731"
            - "free/hy4"
            - "free/muse-spark-1.3"
      model:
        default: "free/glm-5.3-flash"
        provider: "custom:apinex"
        base_url: "https://api.apinex.bond/v1"
        context_length: 1000000
    `;

    const entropyResults = scanTier3Entropy(text);
    expect(entropyResults).toEqual([]);

    const pipelineResults = detectEntities(text);
    expect(pipelineResults).toEqual([]);
  });

  it('detects user custom provider key in natural language prompt', () => {
    const text = 'hey i have a problem with my api provider. the key is "cmp438078272436591415144cbd44b149a9"';
    const entities = detectEntities(text);
    expect(entities.length).toBe(1);
    expect(entities[0]!.raw).toBe('cmp438078272436591415144cbd44b149a9');
    expect(entities[0]!.type).toBe('GENERIC_API_KEY');
  });

  it('detects diverse vendor credential styles (HuggingFace, GitLab, Stripe, JWT, DB, Private Keys)', () => {
    const text = `
      hf_token = "hf_0123456789abcdefghijklmnopqrstuvwxyz"
      gitlab_pat = "glpat-0123456789abcdefghij"
      stripe_secret = "sk_live_0123456789abcdefghijklmn"
      jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
      db_url = "postgres://root:SuperSecretDBPass2026@db.internal.net:5432/analytics"
      key_block:
      -----BEGIN RSA PRIVATE KEY-----
      MIIEowIBAAKCAQEA0Y1
      -----END RSA PRIVATE KEY-----
    `;

    const entities = detectEntities(text);
    const types = entities.map((e) => e.type);

    expect(types).toContain('HUGGINGFACE_TOKEN');
    expect(types).toContain('GITLAB_TOKEN');
    expect(types).toContain('STRIPE_KEY');
    expect(types).toContain('JWT_TOKEN');
    expect(types).toContain('DATABASE_URL');
    expect(types).toContain('PRIVATE_KEY');
  });

  it('detects cmp key embedded inside YAML key_env configuration prompt', () => {
    const text = `custom_providers:
  - name: "APInex"
    base_url: "https://api.apinex.bond/v1"
    key_env: "cmp438078272436591415144cbd44b149a9Y"
    api_mode: "chat_completions"
    discover_models: false
    models:
      - "free/glm-5.3-flash"
      - "free/deepseek-v4.1-flash"
model:
  default: "free/glm-5.3-flash"`;

    const entities = detectEntities(text);
    expect(entities.length).toBe(1);
    expect(entities[0]!.raw).toBe('cmp438078272436591415144cbd44b149a9Y');
    expect(entities[0]!.type).toBe('GENERIC_API_KEY');
  });

  it('detects natural-language and config-assigned passwords including short/symbolic passwords', () => {
    const prompt = [
      'also my password is ex@mple1234',
      'my pass is "hunter2"',
      'escaped password is \\"ex@mple1234\\"',
      'db_password: "SuperSecret123!"',
      'DB_PASSWORD=Pass@word99',
    ].join('\n');

    const entities = detectEntities(prompt);
    const passwords = entities.filter((e) => e.type === 'PASSWORD');
    expect(passwords.map((e) => e.raw)).toEqual([
      'ex@mple1234',
      'hunter2',
      'ex@mple1234',
      'SuperSecret123!',
      'Pass@word99',
    ]);
  });

  it('detects password alongside credentials in multi-provider incident manifest', () => {
    const manifest = `# Incident Diagnostic & Multi-Provider Deployment Manifest
# Goal: Diagnose why our multi-model gateway is failing to route requests.

custom_providers:
  - name: "APInex"
    base_url: "https://api.apinex.bond/v1"
    key_env: "cmp438078272436591415144cbd44b149a9Y"
    api_mode: "chat_completions"
    models:
      - "free/glm-5.3-flash"

cloud_api_credentials:
  openai_key: "sk-proj-abc1234567890abcdef1234567890abcdef1234567890"
  anthropic_key: "sk-ant-api03-abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
  google_gemini_key: "AIzaSyB1234567890abcdefghijklmnopqrst"
  aws_access_key_id: "AKIAIOSFODNN7EXAMPLE"
  aws_secret_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
  huggingface_token: "hf_abcdefghijklmnopqrstuvwxyz12345678"
  gitlab_pat: "glpat-abcdef1234567890ABCD"
  stripe_live_key: "sk_live_51Abcd1234EFGH5678IJKL9012mnop3456"

database_configuration:
  primary_db_uri: "postgresql://postgres:SuperSecretPassword123!@db.internal.corp:5432/production_db"

security_certificates:
  auth_jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
  service_private_key: |
    -----BEGIN PRIVATE KEY-----
    MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7VNBXABCDEF123456
    -----END PRIVATE KEY-----

also my password is ex@mple1234

billing_and_compliance:
  lead_engineer_email: "sarah.connor@acme-defense.internal"
  emergency_phone: "+1 (555) 839-2041"
  administrator_ssn: "123-45-6789"

natural_language_context:
  note: "In case the primary gateway goes down, the key is \\"cmp438078272436591415144cbd44b149a9\\" and the internal diagnostic node is at 192.168.1.105."`;

    const entities = detectEntities(manifest);
    const pw = entities.find((e) => e.raw === 'ex@mple1234');
    expect(pw?.type).toBe('PASSWORD');
    expect(entities.some((e) => e.raw.startsWith('sk-proj-'))).toBe(true);
    expect(entities.some((e) => e.raw === 'AKIAIOSFODNN7EXAMPLE')).toBe(true);
    expect(entities.some((e) => e.raw === 'sarah.connor@acme-defense.internal')).toBe(true);
    expect(entities.some((e) => e.raw === '192.168.1.105')).toBe(true);
  });

  it('does not trigger false-positive PASSWORD detections on English prose, hints, or code references', () => {
    const safeInputs = [
      'My password is not working today.',
      'My password is incorrect and expired.',
      'Their password is temporarily compromised.',
      'password: "Please enter password"',
      'db_password: process.env.DB_PASSWORD',
      'password: "[REDACTED]"',
      'password: string',
      'password: this.password',
      'password: "<your-password>"',
    ];

    for (const input of safeInputs) {
      const passwords = detectEntities(input).filter((e) => e.type === 'PASSWORD');
      expect(passwords, `Unexpected PASSWORD in: ${input}`).toHaveLength(0);
    }
  });
});

describe('Pipeline: Overlap Resolution, Redaction & Reversible Unmasking', () => {
  it('prioritizes specific regex over generic entropy when spans conflict', () => {
    const text = 'My OpenAI key is sk-proj-a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0u1V2w3X4y5Z6';
    const entities = detectEntities(text);

    // Should only have 1 entity (OPENAI_API_KEY), not double-flagged as entropy
    expect(entities.length).toBe(1);
    expect(entities[0]!.type).toBe('OPENAI_API_KEY');
  });

  it('redacts multiple mixed entities and accurately builds the vault', () => {
    const prompt = `
      Please review this code for Alice (alice.smith@university.edu).
      Her phone is (555) 432-8765.
      AWS access key: AKIAIOSFODNN7EXAMPLE
      Payment card: 4532-0151-1283-0366
    `;

    const result = redactText(prompt);

    // Verify redaction replaced all entities
    expect(result.redactedText).toContain('[EMAIL_1]');
    expect(result.redactedText).toContain('[PHONE_NUMBER_1]');
    expect(result.redactedText).toContain('[AWS_ACCESS_KEY_1]');
    expect(result.redactedText).toContain('[CREDIT_CARD_1]');

    // Verify raw values are NOT in the redacted text
    expect(result.redactedText).not.toContain('alice.smith@university.edu');
    expect(result.redactedText).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result.redactedText).not.toContain('4532-0151-1283-0366');

    // Verify vault mappings
    expect(result.vault['[EMAIL_1]']).toBe('alice.smith@university.edu');
    expect(result.vault['[AWS_ACCESS_KEY_1]']).toBe('AKIAIOSFODNN7EXAMPLE');
    expect(result.vault['[CREDIT_CARD_1]']).toBe('4532-0151-1283-0366');

    // Verify unmasking reproduces the original prompt with 100% fidelity
    const unmasked = unmaskText(result.redactedText, result.vault);
    expect(unmasked).toBe(prompt);
  });

  it('correctly redacts custom API key assignments like LUCIDITY_API_KEYS=cmp... preserving prompt grammar', () => {
    const prompt = 'LUCIDITY_API_KEYS=cmp438078272436591415144cbd44b149a9 what is this';
    const result = redactText(prompt);

    expect(result.entities.length).toBe(1);
    expect(result.entities[0]!.type).toBe('GENERIC_API_KEY');
    expect(result.entities[0]!.raw).toBe('cmp438078272436591415144cbd44b149a9');
    expect(result.redactedText).toBe('LUCIDITY_API_KEYS=[GENERIC_API_KEY_1] what is this');

    const unmasked = unmaskText(result.redactedText, result.vault);
    expect(unmasked).toBe(prompt);
  });

  it('meets the strict sub-2ms latency budget on a realistic 1,000-word prompt', () => {
    const baseText = `
      Here is a server setup script containing some credentials:
      DATABASE_URL = "postgres://admin:superSecretPass123!@10.0.0.5:5432/production"
      API_KEY = "sk-proj-abcdef1234567890abcdef1234567890abcdef"
      CONTACT = "devops.lead@enterprise-cloud.io"
      SUPPORT_LINE = "1-800-555-0199"
      BILLING = "4532015112830366"
    `;
    // Repeat to simulate a 1,000+ word document
    const longPrompt = baseText.repeat(15);

    // Warmup JIT
    redactText(baseText);

    const start = performance.now();
    const result = redactText(longPrompt);
    const elapsedMs = performance.now() - start;

    expect(result.entities.length).toBeGreaterThan(50);
    // Budget is strictly < 15ms in CI/test environment, typically ~1-3ms
    expect(elapsedMs).toBeLessThan(15);
  });
});

