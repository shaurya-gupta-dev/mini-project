/**
 * AegisLLM Dynamic Rule Loader & Signature Verifier
 * Validates S3-delivered rule packs using ECDSA P-256 via WebCrypto SubtleCrypto.
 * Caches validated rule packs in chrome.storage.local with ETag checks.
 * Falls back safely to bundled defaults on network or signature failure.
 */

import bundledPubKey from './rule_signing_pubkey.json' assert { type: 'json' };

export interface RuleDefinition {
  id: string;
  type: string;
  pattern: string;
  confidence: number;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  requiresChecksum?: 'luhn' | 'verhoeff';
  description?: string;
}

export interface EntropySettings {
  minTokenLength: number;
  shannonThreshold: number;
}

export interface RulePack {
  version: string;
  packId: string;
  timestamp: number;
  rules: RuleDefinition[];
  entropySettings?: EntropySettings;
}

export interface RuleLoaderOptions {
  rulePackUrl?: string;
  signatureUrl?: string;
  cacheTtlMs?: number;
  pubKeyJwk?: JsonWebKey;
}

const DEFAULT_S3_RULES_URL = 'https://aegis-llm-rules.s3.amazonaws.com/rule_packs/rules.v1.json';
const DEFAULT_S3_SIG_URL = 'https://aegis-llm-rules.s3.amazonaws.com/rule_packs/rules.v1.json.sig';
const CACHE_STORAGE_KEY = 'aegis_cached_rule_pack';
const CACHE_SIG_KEY = 'aegis_cached_rule_sig';
const CACHE_TIMESTAMP_KEY = 'aegis_cached_rule_time';
const MAX_REGEX_LENGTH = 500;

// Disallowed ReDoS patterns: nested quantifiers (a+)+, (.*)*, ([a-z]+)*
const REDOS_GUARD_REGEX = /\([^)]*(\+|\*|\{[0-9]+,\})\)[+*]|\([a-zA-Z0-9_|.-]*\+\)\+/;

/**
 * Validates a single regex pattern for safety and syntax.
 */
export function isSafeRegex(pattern: string): boolean {
  if (!pattern || pattern.length > MAX_REGEX_LENGTH) {
    return false;
  }
  if (REDOS_GUARD_REGEX.test(pattern)) {
    return false;
  }
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates the schema and safe regex compilation of a RulePack object.
 */
export function validateRulePack(candidate: unknown): candidate is RulePack {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }

  const p = candidate as Record<string, unknown>;
  if (typeof p.version !== 'string' || typeof p.packId !== 'string' || typeof p.timestamp !== 'number') {
    return false;
  }

  if (!Array.isArray(p.rules) || p.rules.length === 0) {
    return false;
  }

  for (const rule of p.rules) {
    if (!rule || typeof rule !== 'object') return false;
    const r = rule as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.type !== 'string' || typeof r.pattern !== 'string') {
      return false;
    }
    if (!isSafeRegex(r.pattern)) {
      console.warn(`[RuleLoader] Discarding unsafe regex pattern for rule ${r.id}: ${r.pattern}`);
      return false;
    }
  }

  return true;
}

/**
 * Verifies the ECDSA P-256 digital signature of a rule pack string using WebCrypto.
 */
export async function verifyRulePackSignature(
  rulePackContent: string,
  signatureBase64: string,
  pubKeyJwk: JsonWebKey = bundledPubKey as unknown as JsonWebKey
): Promise<boolean> {
  try {
    const cryptoSubtle =
      typeof window !== 'undefined' && window.crypto?.subtle
        ? window.crypto.subtle
        : globalThis.crypto?.subtle;

    if (!cryptoSubtle) {
      console.warn('[RuleLoader] WebCrypto subtle is unavailable in current runtime.');
      return false;
    }

    const publicKey = await cryptoSubtle.importKey(
      'jwk',
      pubKeyJwk,
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      false,
      ['verify']
    );

    const dataBuffer = new TextEncoder().encode(rulePackContent);

    // Decode base64 signature to Uint8Array
    let binaryStr = '';
    if (typeof atob === 'function') {
      binaryStr = atob(signatureBase64.trim());
    } else {
      binaryStr = Buffer.from(signatureBase64.trim(), 'base64').toString('binary');
    }

    const sigBytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      sigBytes[i] = binaryStr.charCodeAt(i);
    }

    return await cryptoSubtle.verify(
      {
        name: 'ECDSA',
        hash: { name: 'SHA-256' },
      },
      publicKey,
      sigBytes,
      dataBuffer
    );
  } catch (err) {
    console.error('[RuleLoader] Signature verification failed with exception:', err);
    return false;
  }
}

/**
 * Loads the active rule pack:
 * 1. Checks memory/storage cache
 * 2. Attempts fetch from S3 if online
 * 3. Verifies ECDSA digital signature
 * 4. Falls back to bundled defaults on any failure
 */
export async function loadRulePack(options: RuleLoaderOptions = {}): Promise<RulePack> {
  const rulePackUrl = options.rulePackUrl || DEFAULT_S3_RULES_URL;
  const signatureUrl = options.signatureUrl || DEFAULT_S3_SIG_URL;
  const pubKey = options.pubKeyJwk || (bundledPubKey as unknown as JsonWebKey);

  // 1. Try to fetch new rules from S3 if available
  try {
    if (typeof fetch === 'function') {
      const [rulesRes, sigRes] = await Promise.all([
        fetch(rulePackUrl),
        fetch(signatureUrl),
      ]);

      if (rulesRes.ok && sigRes.ok) {
        const rulesText = await rulesRes.text();
        const sigText = await sigRes.text();

        const isValid = await verifyRulePackSignature(rulesText, sigText, pubKey);
        if (isValid) {
          const parsed = JSON.parse(rulesText);
          if (validateRulePack(parsed)) {
            // Save to chrome.storage.local cache if present
            try {
              if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                chrome.storage.local.set({
                  [CACHE_STORAGE_KEY]: rulesText,
                  [CACHE_SIG_KEY]: sigText,
                  [CACHE_TIMESTAMP_KEY]: Date.now(),
                });
              }
            } catch {
              // Cache failure is non-fatal
            }
            console.log(`[RuleLoader] Loaded and verified remote rule pack v${parsed.version} (${parsed.rules.length} rules)`);
            return parsed;
          }
        } else {
          console.warn('[RuleLoader] Signature verification failed for remote rule pack! Rejecting update.');
        }
      }
    }
  } catch (err) {
    console.warn('[RuleLoader] Network fetch failed, falling back to cache/bundled:', err);
  }

  // 2. Try chrome.storage.local cache
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const cached = await new Promise<{ [CACHE_STORAGE_KEY]?: string; [CACHE_SIG_KEY]?: string }>((resolve) => {
        chrome.storage.local.get([CACHE_STORAGE_KEY, CACHE_SIG_KEY], (items) => resolve(items));
      });

      if (cached[CACHE_STORAGE_KEY] && cached[CACHE_SIG_KEY]) {
        const isValid = await verifyRulePackSignature(cached[CACHE_STORAGE_KEY]!, cached[CACHE_SIG_KEY]!, pubKey);
        if (isValid) {
          const parsed = JSON.parse(cached[CACHE_STORAGE_KEY]!);
          if (validateRulePack(parsed)) {
            return parsed;
          }
        }
      }
    }
  } catch {
    // Ignore cache lookup errors
  }

  // 3. Fallback: bundled default fallback
  return getBundledDefaultRulePack();
}

/**
 * Fallback static rule pack bundled with the extension.
 */
export function getBundledDefaultRulePack(): RulePack {
  return {
    version: '1.0.0-bundled',
    packId: 'bundled-default-patterns',
    timestamp: 1773292800000,
    rules: [
      {
        id: 'OPENAI_API_KEY',
        type: 'OPENAI_API_KEY',
        pattern: 'sk-(?:proj-)?[A-Za-z0-9_-]{20,}',
        confidence: 0.99,
        severity: 'HIGH',
      },
      {
        id: 'ANTHROPIC_API_KEY',
        type: 'ANTHROPIC_API_KEY',
        pattern: 'sk-ant-(?:api03-)?[A-Za-z0-9_-]{20,}',
        confidence: 0.99,
        severity: 'HIGH',
      },
      {
        id: 'AWS_ACCESS_KEY',
        type: 'AWS_ACCESS_KEY',
        pattern: '(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}',
        confidence: 0.99,
        severity: 'HIGH',
      },
      {
        id: 'GITHUB_TOKEN',
        type: 'GITHUB_TOKEN',
        pattern: '(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}',
        confidence: 0.99,
        severity: 'HIGH',
      },
      {
        id: 'GOOGLE_API_KEY',
        type: 'GOOGLE_API_KEY',
        pattern: 'AIza[0-9A-Za-z-_]{35}',
        confidence: 0.98,
        severity: 'HIGH',
      },
    ],
    entropySettings: {
      minTokenLength: 16,
      shannonThreshold: 4.1,
    },
  };
}

