/**
 * Tier 3: Shannon Information Entropy Analyzer
 * Identifies raw passwords, hashes, JWT tokens, and cryptographic keys
 * lacking fixed vendor prefixes.
 */

import { DetectedEntity } from './types.js';

// Matches potential secret tokens: either enclosed in quotes or clean unquoted tokens
const QUOTED_TOKEN_REGEX = /(?<=["'])([^"'\r\n\t ]{16,128})(?=["'])/g;
const UNQUOTED_TOKEN_REGEX = /(?<=[\s=:({[,"'])([A-Za-z0-9+/=_.~!@#$%^&*-]{16,128})(?=[\s=:)\]},"']|$)/g;

/**
 * Calculates Shannon Information Entropy: H(S) = - sum(P(c) * log2(P(c)))
 */
export function calculateShannonEntropy(str: string): number {
  if (str.length === 0) return 0;

  const charFrequencies = new Map<string, number>();
  for (let i = 0; i < str.length; i++) {
    const char = str[i]!;
    charFrequencies.set(char, (charFrequencies.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  const len = str.length;

  for (const count of charFrequencies.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

/**
 * Checks whether a candidate string has a realistic character distribution
 * for a cryptographically secure key or secret.
 */
function isCryptographicSecret(token: string, entropy: number): boolean {
  // Check length
  if (token.length < 16) return false;

  // Ignore standard UUIDs (e.g. 550e8400-e29b-41d4-a716-446655440000)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return false;
  }

  // Ignore standard 40-character Git commit SHAs
  if (/^[0-9a-f]{40}$/i.test(token)) {
    return false;
  }

  // Ignore URLs, URIs, and endpoints (e.g. https://api.apinex.bond/v1, ws://..., ftp://...)
  if (
    /^(?:https?|ftp|file|ws|wss):\/\//i.test(token) ||
    token.includes('://') ||
    /^[a-z0-9_.-]+\.[a-z]{2,}(?::[0-9]+)?(?:\/.*)?$/i.test(token)
  ) {
    return false;
  }

  // Slashes and backslashes indicate file paths, model slugs, or URLs
  // Only valid Base64 (A-Za-z0-9+/=) can contain slashes as part of a cryptographic secret
  if (token.includes('/') || token.includes('\\')) {
    // If it contains hyphens or dots alongside slashes, it is a path/model slug (e.g. free/gemini-3.8-flash)
    if (/[.-]/.test(token) || !/^[A-Za-z0-9+/=]+$/.test(token)) {
      return false;
    }
  }

  // Count character classes: lowercase, uppercase, digits, symbols
  const hasLower = /[a-z]/.test(token);
  const hasUpper = /[A-Z]/.test(token);
  const hasDigit = /[0-9]/.test(token);
  const isHexOnly = /^[0-9a-fA-F]+$/.test(token);

  // Hexadecimal secrets (e.g. MD5/SHA256 hashes, private keys)
  if (isHexOnly) {
    // Max entropy for hex alphabet is log2(16) = 4.0
    // Real random hex has entropy >= 3.2 (for length >= 32)
    return token.length >= 32 && entropy >= 3.25;
  }

  // Pure continuous alphanumeric tokens without any path/slug separators (e.g. cmp438078272436591415144cbd44b149a9)
  // These represent vendor-less API keys, tokens, or random secrets
  const isPureAlphanumeric = /^[A-Za-z0-9]+$/.test(token);
  if (
    isPureAlphanumeric &&
    token.length >= 24 &&
    hasDigit &&
    hasLower &&
    entropy >= 3.4
  ) {
    return true;
  }

  // Cryptographic passwords and tokens have true secret symbols (!@#$%^&*()+=~`[]{}|\:;"'<>,?)
  // Common path/identifier delimiters (-_./) do not indicate secret complexity
  const hasSecretSymbols = /[!@#$%^&*()+=~`[\]{}|\\:;"'<>,?]/.test(token);

  // Without uppercase letters, pure alphanumeric keys, or secret symbols, standard identifiers cannot be secrets
  if (!hasUpper && !hasSecretSymbols) {
    return false;
  }

  // Count character classes present
  const classCount =
    (hasLower ? 1 : 0) +
    (hasUpper ? 1 : 0) +
    (hasDigit ? 1 : 0) +
    (hasSecretSymbols ? 1 : 0);

  // Must mix at least two classes (e.g. uppercase + lowercase + digits, or letters + secret symbols)
  if (classCount < 2) {
    return false;
  }

  // Tokens with 3+ classes (e.g. upper, lower, digits, symbols)
  if (classCount >= 3 && entropy >= 3.6) {
    return true;
  }

  // Base64 or mixed alphanumeric secrets (requires mixed case and digits)
  if (token.length >= 24 && entropy >= 4.0 && hasUpper && hasLower && hasDigit) {
    return true;
  }

  // Shorter tokens (16-23 chars) need high density and mixed case
  if (token.length >= 16 && entropy >= 3.8 && classCount >= 3) {
    return true;
  }

  return false;
}

/**
 * Scans input text for high-entropy secret strings.
 */
export function scanTier3Entropy(
  text: string,
  minEntropyThreshold: number = 3.6
): DetectedEntity[] {
  const results: DetectedEntity[] = [];
  const seenSpans = new Set<string>();

  const scanWithPattern = (regex: RegExp) => {
    regex.lastIndex = 0;
    const paddedText = ' ' + text + ' ';
    let match: RegExpExecArray | null;

    while ((match = regex.exec(paddedText)) !== null) {
      const raw = match[1]!;
      const startIndex = match.index + match[0].indexOf(raw) - 1;
      const endIndex = startIndex + raw.length;

      if (startIndex < 0 || endIndex > text.length) {
        continue;
      }

      const spanKey = `${startIndex}:${endIndex}`;
      if (seenSpans.has(spanKey)) continue;

      const entropy = calculateShannonEntropy(raw);

      if (entropy >= minEntropyThreshold && isCryptographicSecret(raw, entropy)) {
        seenSpans.add(spanKey);
        results.push({
          type: 'HIGH_ENTROPY_SECRET',
          raw,
          startIndex,
          endIndex,
          tier: 'TIER3_ENTROPY',
          confidence: Math.min(0.99, Number((entropy / 5.0).toFixed(2))),
          metadata: {
            entropy: Number(entropy.toFixed(3)),
            length: raw.length,
          },
        });
      }
    }
  };

  scanWithPattern(QUOTED_TOKEN_REGEX);
  scanWithPattern(UNQUOTED_TOKEN_REGEX);

  return results;
}
