/**
 * Tier 2: Algorithmic Checksum Validator (Luhn Algorithm - Modulo 10)
 * Validates Credit Cards (Visa, Mastercard, Amex, Discover) while eliminating
 * false-positive 16-digit product IDs, order numbers, and hashes.
 */

import { DetectedEntity } from './types.js';

// Regex capturing candidate digit sequences with optional dashes/spaces (13 to 19 digits)
const CARD_CANDIDATE_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;

/**
 * Validates whether a raw digit string passes the Luhn Modulo 10 checksum.
 */
export function passesLuhnChecksum(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  // Reject repeating single digits like 0000000000000000 or 1111111111111111
  if (/^(\d)\1+$/.test(digits)) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

/**
 * Validates major card brand IIN / BIN prefixes.
 */
function isValidCardBrandPrefix(digits: string): boolean {
  // Visa: starts with 4 (13, 16, 19 digits)
  if (/^4\d{12}(?:\d{3})?(?:\d{3})?$/.test(digits)) return true;
  // Mastercard: 51-55 or 2221-2720 (16 digits)
  if (/^(?:5[1-5]\d{2}|222[1-9]|22[3-9]\d|2[3-6]\d{2}|27[01]\d|2720)\d{12}$/.test(digits)) return true;
  // Amex: 34 or 37 (15 digits)
  if (/^3[47]\d{13}$/.test(digits)) return true;
  // Discover: 6011, 622126-622925, 644-649, 65 (16 digits)
  if (/^(?:6011|65\d{2}|64[4-9]\d)\d{12}$/.test(digits)) return true;

  // Generic fallback if it passes strict Luhn and has 16 digits
  return digits.length === 16;
}

/**
 * Scans input text for credit card candidates and verifies via Luhn algorithm.
 */
export function scanTier2Luhn(text: string): DetectedEntity[] {
  const results: DetectedEntity[] = [];
  CARD_CANDIDATE_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;

  while ((match = CARD_CANDIDATE_REGEX.exec(text)) !== null) {
    const raw = match[0];
    const digitsOnly = raw.replace(/\D/g, '');

    if (passesLuhnChecksum(digitsOnly) && isValidCardBrandPrefix(digitsOnly)) {
      results.push({
        type: 'CREDIT_CARD',
        raw,
        startIndex: match.index,
        endIndex: match.index + raw.length,
        tier: 'TIER2_LUHN',
        confidence: 0.99,
        metadata: {
          digitsLength: digitsOnly.length,
          last4: digitsOnly.slice(-4),
        },
      });
    }
  }

  return results;
}

