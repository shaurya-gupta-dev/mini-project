/**
 * Unified Detection & Redaction Pipeline
 * Coordinates Tier 1 (Regex), Tier 2 (Luhn), and Tier 3 (Entropy),
 * resolves overlapping spans, and generates reversible redactions.
 */

import { scanTier1Regex } from './tier1_regex.js';
import { scanTier2Luhn } from './tier2_luhn.js';
import { scanTier3Entropy } from './tier3_entropy.js';
import {
  DetectedEntity,
  DetectionOptions,
  RedactionResult,
} from './types.js';

/**
 * Resolves overlapping entity spans, prioritizing specific semantic types
 * and higher confidence scores.
 */
function resolveOverlaps(entities: DetectedEntity[]): DetectedEntity[] {
  if (entities.length <= 1) return entities;

  // Tier priority: TIER1_REGEX (highest specificity) > TIER2_LUHN > TIER3_ENTROPY
  const tierWeight = {
    TIER1_REGEX: 3,
    TIER2_LUHN: 2,
    TIER3_ENTROPY: 1,
    TIER4_NER: 0,
  };

  // Sort by start index ascending, then by span length descending
  const sorted = [...entities].sort((a, b) => {
    if (a.startIndex !== b.startIndex) {
      return a.startIndex - b.startIndex;
    }
    return (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex);
  });

  const resolved: DetectedEntity[] = [];

  for (const candidate of sorted) {
    if (resolved.length === 0) {
      resolved.push(candidate);
      continue;
    }

    const last = resolved[resolved.length - 1]!;

    // Check for overlap: candidate starts before the last entity ends
    if (candidate.startIndex < last.endIndex) {
      const lastWeight = tierWeight[last.tier];
      const candWeight = tierWeight[candidate.tier];

      // If candidate has strictly higher tier weight, replace last
      if (candWeight > lastWeight) {
        resolved[resolved.length - 1] = candidate;
      }
      // If same tier, pick the one with higher confidence or longer span
      else if (candWeight === lastWeight) {
        const lastLen = last.endIndex - last.startIndex;
        const candLen = candidate.endIndex - candidate.startIndex;
        if (candidate.confidence > last.confidence || candLen > lastLen) {
          resolved[resolved.length - 1] = candidate;
        }
      }
      // Otherwise, keep existing and ignore overlapping candidate
    } else {
      resolved.push(candidate);
    }
  }

  return resolved;
}

/**
 * Scans input text across all active detection tiers and returns sorted,
 * non-overlapping detected entities.
 */
export function detectEntities(
  text: string,
  options: DetectionOptions = {}
): DetectedEntity[] {
  const allEntities: DetectedEntity[] = [];

  // Tier 1: Deterministic Regex
  const tier1 = scanTier1Regex(text);
  allEntities.push(...tier1);

  // Tier 2: Checksum (Credit Cards)
  const tier2 = scanTier2Luhn(text);
  allEntities.push(...tier2);

  // Tier 3: Shannon Entropy (if enabled)
  if (options.enableEntropy !== false) {
    const tier3 = scanTier3Entropy(text, options.minEntropyThreshold ?? 3.5);
    allEntities.push(...tier3);
  }

  // Filter out any explicitly excluded entity types
  let filtered = options.excludedTypes
    ? allEntities.filter((e) => !options.excludedTypes!.includes(e.type))
    : allEntities;

  // Filter out user-approved allowed secrets
  if (options.allowedSecrets && options.allowedSecrets.size > 0) {
    filtered = filtered.filter((e) => !options.allowedSecrets!.has(e.raw));
  }

  return resolveOverlaps(filtered);
}

/**
 * Performs end-to-end redaction on text, returning sanitized text,
 * the detected entities, and the reversible in-memory vault.
 */
export function redactText(
  text: string,
  options: DetectionOptions = {}
): RedactionResult {
  const startTime = performance.now();

  const entities = detectEntities(text, options);
  const vault: Record<string, string> = {};
  const typeCounters: Record<string, number> = {};

  // Build redacted text by replacing spans from left to right
  let redactedText = '';
  let lastIndex = 0;

  for (const entity of entities) {
    // Append unchanged text prior to entity
    redactedText += text.substring(lastIndex, entity.startIndex);

    // Generate canonical placeholder: e.g. [OPENAI_API_KEY_1], [EMAIL_1]
    const count = (typeCounters[entity.type] ?? 0) + 1;
    typeCounters[entity.type] = count;
    const placeholder = `[${entity.type}_${count}]`;

    // Store in ephemeral vault
    vault[placeholder] = entity.raw;

    // Append placeholder
    redactedText += placeholder;
    lastIndex = entity.endIndex;
  }

  // Append remaining text after the final entity
  redactedText += text.substring(lastIndex);

  const durationMs = Number((performance.now() - startTime).toFixed(3));

  return {
    originalText: text,
    redactedText,
    entities,
    vault,
    durationMs,
  };
}

/**
 * Reversibly unmasks a completion text by substituting placeholders
 * with their original values from the vault.
 */
export function unmaskText(
  redactedCompletion: string,
  vault: Record<string, string>
): string {
  if (!redactedCompletion.includes('[')) return redactedCompletion;

  // Single-pass regex substitution prevents second-order placeholder replacement
  return redactedCompletion.replace(/\[(?:[A-Z0-9_]+)_[0-9]+\]/g, (match) => {
    return vault[match] ?? match;
  });
}

