import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  isSafeRegex,
  validateRulePack,
  verifyRulePackSignature,
  loadRulePack,
  getBundledDefaultRulePack,
} from '../src/engine/rule_loader.js';
import pubKeyJwk from '../src/engine/rule_signing_pubkey.json' assert { type: 'json' };

describe('AWS S3 Signed Dynamic Rule Packs (ECDSA P-256 WebCrypto)', () => {
  const rulesPath = path.resolve('rule_packs/rules.v1.json');
  const sigPath = path.resolve('rule_packs/rules.v1.json.sig');

  const validRulesText = fs.readFileSync(rulesPath, 'utf-8');
  const validSigBase64 = fs.readFileSync(sigPath, 'utf-8').trim();

  describe('ReDoS and Regex Safety Guards', () => {
    it('accepts valid, safe regular expressions', () => {
      expect(isSafeRegex('sk-(?:proj-)?[A-Za-z0-9_-]{20,}')).toBe(true);
      expect(isSafeRegex('[A-Z]{5}[0-9]{4}[A-Z]{1}')).toBe(true);
      expect(isSafeRegex('AIza[0-9A-Za-z-_]{35}')).toBe(true);
    });

    it('rejects regex patterns that exceed maximum allowed length (> 500 chars)', () => {
      const hugePattern = 'a'.repeat(501);
      expect(isSafeRegex(hugePattern)).toBe(false);
    });

    it('rejects dangerous ReDoS patterns with nested quantifiers like (a+)+', () => {
      expect(isSafeRegex('(a+)+')).toBe(false);
      expect(isSafeRegex('(.*)*')).toBe(false);
    });

    it('rejects invalid regex syntax', () => {
      expect(isSafeRegex('[a-z')).toBe(false);
      expect(isSafeRegex('(?<invalid')).toBe(false);
    });
  });

  describe('Rule Pack Schema Validation', () => {
    it('validates a well-formed rule pack', () => {
      const parsed = JSON.parse(validRulesText);
      expect(validateRulePack(parsed)).toBe(true);
    });

    it('rejects malformed rule pack objects', () => {
      expect(validateRulePack(null)).toBe(false);
      expect(validateRulePack({})).toBe(false);
      expect(validateRulePack({ version: '1.0' })).toBe(false);
      expect(
        validateRulePack({
          version: '1.0',
          packId: 'test',
          timestamp: 1234,
          rules: [{ id: 'R1', type: 'KEY', pattern: '(a+)+' }], // Unsafe regex
        })
      ).toBe(false);
    });
  });

  describe('WebCrypto Digital Signature Verification', () => {
    it('validates authentic rule pack signed with private ECDSA key', async () => {
      const isValid = await verifyRulePackSignature(
        validRulesText,
        validSigBase64,
        pubKeyJwk as unknown as JsonWebKey
      );
      expect(isValid).toBe(true);
    });

    it('REJECTS tampered rule pack (even 1 character modified)', async () => {
      const tamperedRulesText = validRulesText.replace('"1.0.0"', '"1.0.1-hacked"');
      const isValid = await verifyRulePackSignature(
        tamperedRulesText,
        validSigBase64,
        pubKeyJwk as unknown as JsonWebKey
      );
      expect(isValid).toBe(false);
    });

    it('REJECTS payload with corrupted or invalid signature', async () => {
      const corruptedSig = 'AAAA' + validSigBase64.slice(4);
      const isValid = await verifyRulePackSignature(
        validRulesText,
        corruptedSig,
        pubKeyJwk as unknown as JsonWebKey
      );
      expect(isValid).toBe(false);
    });
  });

  describe('Dynamic Rule Loader & Fallback Hierarchy', () => {
    it('provides bundled default rule pack when offline', () => {
      const bundled = getBundledDefaultRulePack();
      expect(bundled.rules.length).toBeGreaterThanOrEqual(5);
      expect(bundled.packId).toBe('bundled-default-patterns');
    });

    it('falls back to bundled defaults when signature verification fails', async () => {
      // Mock global fetch returning tampered content
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (url: RequestInfo | URL) => {
          const urlStr = url.toString();
          if (urlStr.endsWith('.sig')) {
            return new Response(validSigBase64, { status: 200 });
          }
          // Return tampered rules
          return new Response(
            JSON.stringify({
              version: '9.9.9',
              packId: 'tampered-pack',
              timestamp: Date.now(),
              rules: [{ id: 'MALICIOUS', type: 'MALICIOUS', pattern: '.*', confidence: 1, severity: 'HIGH' }],
            }),
            { status: 200 }
          );
        };

        const loaded = await loadRulePack({
          rulePackUrl: 'https://test.s3.amazonaws.com/rules.json',
          signatureUrl: 'https://test.s3.amazonaws.com/rules.json.sig',
          pubKeyJwk: pubKeyJwk as unknown as JsonWebKey,
        });

        // Should NOT load the tampered pack — falls back to bundled defaults
        expect(loaded.packId).toBe('bundled-default-patterns');
        expect(loaded.version).toBe('1.0.0-bundled');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('successfully loads remote rule pack when signature is valid', async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (url: RequestInfo | URL) => {
          const urlStr = url.toString();
          if (urlStr.endsWith('.sig')) {
            return new Response(validSigBase64, { status: 200 });
          }
          return new Response(validRulesText, { status: 200 });
        };

        const loaded = await loadRulePack({
          rulePackUrl: 'https://test.s3.amazonaws.com/rules.json',
          signatureUrl: 'https://test.s3.amazonaws.com/rules.json.sig',
          pubKeyJwk: pubKeyJwk as unknown as JsonWebKey,
        });

        expect(loaded.packId).toBe('aegis-core-patterns');
        expect(loaded.version).toBe('1.0.0');
        expect(loaded.rules.length).toBe(9);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
