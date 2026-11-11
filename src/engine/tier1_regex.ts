/**
 * Tier 1: Deterministic Pattern Matcher (Regex)
 * Executes in sub-millisecond time. Zero external dependencies.
 */

import { DetectedEntity, EntityType } from './types.js';

interface RegexPatternDef {
  type: EntityType;
  regex: RegExp;
  confidence: number;
  priority: number; // Higher number = higher priority when resolving internal overlaps
  captureGroupIndex?: number;
  validator?: (raw: string, match: RegExpExecArray, text: string) => string | null;
}

const PASSWORD_STOPWORDS = new Set([
  'string', 'number', 'boolean', 'object', 'array', 'null', 'undefined', 'true', 'false',
  'required', 'optional', 'none', 'empty', 'blank', 'default', 'inherit', 'password',
  'passwd', 'passphrase', 'passcode', 'unknown', 'redacted', 'hidden', 'masked',
  'encrypted', 'hashed', 'stored', 'wrong', 'incorrect', 'invalid', 'expired',
  'missing', 'working', 'broken', 'failing', 'failed', 'forgotten', 'changed',
  'updated', 'reset', 'locked', 'unlocked', 'blocked', 'disabled', 'enabled',
  'verified', 'accepted', 'rejected', 'strong', 'stronger', 'strongest', 'weak',
  'weaker', 'weakest', 'secure', 'insecure', 'same', 'different', 'identical',
  'duplicate', 'compromised', 'leaked', 'exposed', 'nullable', 'secret',
  'placeholder', 'username', 'userid', 'account', 'login',
]);

const CODE_REF_PREFIX_REGEX = /^(?:process\.env|import\.meta|os\.environ|env|config|cfg|settings|user|account|req|request|body|input|form|payload|data|props|state|this|self|vault|secrets?|args)\.[A-Za-z0-9_.]+$/i;

/**
 * Validates candidate password captures from natural-language statements or config assignments,
 * trimming unquoted sentence punctuation and filtering common English prose/code false positives.
 */
function validatePasswordCandidate(
  raw: string,
  match: RegExpExecArray,
  text: string,
  isAssignment: boolean,
): string | null {
  const prefix = match[1] ?? '';
  let expectedClosing: string | null = null;
  if (prefix.endsWith('\\"')) {
    expectedClosing = '\\"';
  } else if (prefix.endsWith('"')) {
    expectedClosing = '"';
  } else if (prefix.endsWith("'")) {
    expectedClosing = "'";
  }

  let candidate = raw;
  if (expectedClosing !== null) {
    const closingOffset = match.index + prefix.length + candidate.length;
    if (!text.startsWith(expectedClosing, closingOffset)) {
      return null;
    }
  } else {
    candidate = candidate.replace(/[.,;]+$/, '');
    if (candidate.endsWith(')') && !candidate.includes('(')) {
      candidate = candidate.slice(0, -1);
    }
  }

  if (candidate.length < 6 || candidate.length > 128) {
    return null;
  }

  if (/^\[[A-Z0-9_]+\]$/.test(candidate)) {
    return null;
  }
  if (/^[*\u2022xX._-]{4,}$/.test(candidate)) {
    return null;
  }
  if (/^<[^>]+>$/.test(candidate) || candidate.includes('{{') || candidate.includes('${')) {
    return null;
  }
  if (PASSWORD_STOPWORDS.has(candidate.toLowerCase())) {
    return null;
  }
  if (CODE_REF_PREFIX_REGEX.test(candidate)) {
    return null;
  }

  if (!expectedClosing && !isAssignment) {
    const hasDigit = /[0-9]/.test(candidate);
    const hasSymbol = /[!@#$%^&*()_+\-=[\]{}|:;<>?/~]/.test(candidate);
    const hasMixedCamel = /[a-z][A-Z]/.test(candidate);
    if (!hasDigit && !hasSymbol && !hasMixedCamel) {
      return null;
    }
  }

  return candidate;
}

const COMPILED_PATTERNS: RegexPatternDef[] = [
  // 0. Generic API Keys & Config Assignments (e.g. LUCIDITY_API_KEYS=..., key_env: "...", MY_SECRET_KEY=...)
  {
    type: 'GENERIC_API_KEY',
    regex: /\b([A-Za-z0-9_]*(?:API_KEY|API_KEYS|SECRET_KEY|api_key|api_keys|secret_key|AUTH_KEY|auth_key|PRIVATE_KEY|private_key|KEY_ENV|key_env|api_env|token_env|secret_token|auth_token)\s*[:=]\s*["']?)([A-Za-z0-9_\-\.]{16,128})(["']?)/g,
    confidence: 0.95,
    priority: 8,
    captureGroupIndex: 2,
  },
  // 0b. Natural Language Key Introductions (e.g. "the key is '...' ", "my token is ...", "provider key is '...' ")
  {
    type: 'GENERIC_API_KEY',
    regex: /\b((?:the|my)\s+(?:api[_\s-]?key|secret[_\s-]?key|access[_\s-]?token|auth[_\s-]?token|provider[_\s-]?key|token|key)\s*(?:is\s*[:=]?|[:=])\s*["']?)([A-Za-z0-9_\-\.]{16,128})(["']?)/gi,
    confidence: 0.95,
    priority: 8,
    captureGroupIndex: 2,
  },
  // 0c. Natural Language Password Statements (e.g. "also my password is ex@mple1234", "admin password is '...'")
  {
    type: 'PASSWORD',
    regex: /\b((?:(?:the|my|our|your|his|her|their|an?|admin|root|user|login|account|db|database|wifi|server|service)\s+)?(?:password|passcode|passphrase|passwd)\s+(?:is(?:\s*[:=])?\s*|was\s+)(?:["']|\\")?|(?:the|my|our|your|his|her)\s+pass\s+(?:is(?:\s*[:=])?\s*)(?:["']|\\")?)([^\s"'\\]{6,128})/gi,
    confidence: 0.92,
    priority: 9,
    captureGroupIndex: 2,
    validator: (raw, match, text) => validatePasswordCandidate(raw, match, text, false),
  },
  // 0d. Config / YAML / JSON / .env Password Assignments (e.g. db_password: "...", DB_PASSWORD=...)
  {
    type: 'PASSWORD',
    regex: /((?:["'])?(?:\b[A-Za-z0-9_]*(?:password|passwd|passphrase|passcode)|\b(?:db|admin|root|user|login|auth|wifi|secret|sudo|ssh|vpn|smtp|ftp|mysql|postgres|pg|redis|mongo)_?pass)(?:["'])?\s*[:=]\s*(?:["']|\\")?)([^\s"'\\]{6,128})/gi,
    confidence: 0.93,
    priority: 9,
    captureGroupIndex: 2,
    validator: (raw, match, text) => validatePasswordCandidate(raw, match, text, true),
  },
  // 1. Anthropic API Keys (Higher priority than general sk- keys)
  {
    type: 'ANTHROPIC_API_KEY',
    regex: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/g,
    confidence: 0.99,
    priority: 10,
  },
  // 2. OpenAI API Keys (Negative lookahead for ant-)
  {
    type: 'OPENAI_API_KEY',
    regex: /\bsk-(?!ant-)(?:proj-|admin-|None-)?[a-zA-Z0-9_-]{20,}\b/g,
    confidence: 0.99,
    priority: 10,
  },
  // 3. AWS Access Key IDs
  {
    type: 'AWS_ACCESS_KEY',
    regex: /\b(?:AKIA|ASIA|AROA)[0-9A-Z]{16}\b/g,
    confidence: 0.98,
    priority: 10,
  },
  // 4. GitHub Tokens (Personal Access Token, OAuth, App, etc.)
  {
    type: 'GITHUB_TOKEN',
    regex: /\b(?:ghp_[0-9a-zA-Z]{36}|github_pat_[0-9a-zA-Z_]{22,}|gho_[0-9a-zA-Z]{36}|ghs_[0-9a-zA-Z]{36}|ghr_[0-9a-zA-Z]{36})\b/g,
    confidence: 0.99,
    priority: 10,
  },
  // 5. Google / Gemini API Keys (typically AIza + 35 chars = 39 total, accept 30-45)
  {
    type: 'GOOGLE_API_KEY',
    regex: /\bAIza[0-9A-Za-z-_]{30,45}\b/g,
    confidence: 0.99,
    priority: 10,
  },
  // 6. Slack API Tokens
  {
    type: 'SLACK_TOKEN',
    regex: /\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,32}\b/g,
    confidence: 0.99,
    priority: 10,
  },
  // 6b. Hugging Face Tokens
  {
    type: 'HUGGINGFACE_TOKEN',
    regex: /\bhf_[a-zA-Z0-9]{34,}\b/g,
    confidence: 0.99,
    priority: 10,
  },
  // 6c. GitLab Personal Access Tokens
  {
    type: 'GITLAB_TOKEN',
    regex: /\bglpat-[0-9a-zA-Z_-]{20,}\b/g,
    confidence: 0.99,
    priority: 10,
  },
  // 6d. Stripe API Keys (Live / Test Secret & Restricted Keys)
  {
    type: 'STRIPE_KEY',
    regex: /\b(?:sk|pk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}\b/g,
    confidence: 0.99,
    priority: 10,
  },
  // 6e. Custom AI / Cloud Provider Tokens (e.g. cmp438078272436591415144cbd44b149a9, cmp438078272436591415144cbd44b149a9Y)
  {
    type: 'GENERIC_API_KEY',
    regex: /\b(?:cmp)[0-9a-zA-Z]{20,64}\b/g,
    confidence: 0.98,
    priority: 9,
  },
  // 6f. JSON Web Tokens (JWT)
  {
    type: 'JWT_TOKEN',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    confidence: 0.99,
    priority: 9,
  },
  // 6g. Private Keys (RSA, EC, DSA, OPENSSH, PGP)
  {
    type: 'PRIVATE_KEY',
    regex: /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/g,
    confidence: 0.99,
    priority: 10,
  },
  // 6h. Database Connection Strings with Credentials (captures secret password)
  {
    type: 'DATABASE_URL',
    regex: /\b((?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^\s:]+:)([^\s@]{4,})(@[^\s]+\b)/gi,
    confidence: 0.98,
    priority: 9,
    captureGroupIndex: 2,
  },
  // 7. Email Addresses (RFC 5321 length-bounded, ReDoS immune)
  {
    type: 'EMAIL',
    regex: /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}\b/g,
    confidence: 0.95,
    priority: 5,
  },
  // 8. US Social Security Numbers (SSN)
  {
    type: 'SSN',
    regex: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
    confidence: 0.95,
    priority: 5,
  },
  // 9. IPv4 Addresses (with octet validation)
  {
    type: 'IPV4',
    regex: /\b(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\b/g,
    confidence: 0.90,
    priority: 4,
    validator: (raw) => (raw === '0.0.0.0' ? null : raw),
  },
  // 10. Phone Numbers (US standard & Indian mobile, lookbehind bounded to prevent digit sub-matching)
  {
    type: 'PHONE_NUMBER',
    regex: /(?<!\d)(?:(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?[2-9]\d{2}[-.\s]?\d{4}|(?:\+?91[-.\s]?)?[6-9]\d{9})(?!\d)/g,
    confidence: 0.88,
    priority: 4,
  },
];

/**
 * Resolves overlapping spans within Tier 1 matches using rule priorities.
 */
function resolveTier1Overlaps(
  matches: Array<DetectedEntity & { priority: number }>
): DetectedEntity[] {
  if (matches.length <= 1) {
    return matches.map(({ priority: _, ...rest }) => rest);
  }

  // Sort by start index, then higher priority, then longer span
  const sorted = [...matches].sort((a, b) => {
    if (a.startIndex !== b.startIndex) {
      return a.startIndex - b.startIndex;
    }
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex);
  });

  const resolved: Array<DetectedEntity & { priority: number }> = [];

  for (const candidate of sorted) {
    if (resolved.length === 0) {
      resolved.push(candidate);
      continue;
    }

    const last = resolved[resolved.length - 1]!;

    // Check overlap
    if (candidate.startIndex < last.endIndex) {
      if (candidate.priority > last.priority) {
        resolved[resolved.length - 1] = candidate;
      }
      // If same priority, keep longer span
      else if (
        candidate.priority === last.priority &&
        candidate.endIndex - candidate.startIndex > last.endIndex - last.startIndex
      ) {
        resolved[resolved.length - 1] = candidate;
      }
    } else {
      resolved.push(candidate);
    }
  }

  return resolved.map(({ priority: _, ...rest }) => rest);
}

/**
 * Executes Tier-1 deterministic regex scanning across input text.
 */
export function scanTier1Regex(text: string): DetectedEntity[] {
  const rawMatches: Array<DetectedEntity & { priority: number }> = [];

  for (const def of COMPILED_PATTERNS) {
    def.regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = def.regex.exec(text)) !== null) {
      let raw = def.captureGroupIndex ? match[def.captureGroupIndex]! : match[0];
      if (def.validator) {
        const validated = def.validator(raw, match, text);
        if (validated === null) {
          continue;
        }
        raw = validated;
      }
      const prefixOffset = def.captureGroupIndex ? match[1]!.length : 0;
      const startIndex = match.index + prefixOffset;
      const endIndex = startIndex + raw.length;

      rawMatches.push({
        type: def.type,
        raw,
        startIndex,
        endIndex,
        tier: 'TIER1_REGEX',
        confidence: def.confidence,
        priority: def.priority,
      });
    }
  }

  return resolveTier1Overlaps(rawMatches);
}
