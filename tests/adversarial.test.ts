import { describe, it, expect, vi } from 'vitest';
import { Window } from 'happy-dom';
import { scanTier1Regex } from '../src/engine/tier1_regex.js';
import { scanTier2Luhn } from '../src/engine/tier2_luhn.js';
import {
  calculateShannonEntropy,
  scanTier3Entropy,
} from '../src/engine/tier3_entropy.js';
import {
  redactText,
  unmaskText,
} from '../src/engine/detector_pipeline.js';
import { SessionVault } from '../src/vault/session_vault.js';
import { DOMUnmasker } from '../src/extension/dom_unmasker.js';

describe('Adversarial Engine Audit: ReDoS, Extreme Lengths & Edge Cases', () => {
  it('handles empty string gracefully across all tiers', () => {
    expect(scanTier1Regex('')).toEqual([]);
    expect(scanTier2Luhn('')).toEqual([]);
    expect(scanTier3Entropy('')).toEqual([]);
    expect(calculateShannonEntropy('')).toBe(0);

    const result = redactText('');
    expect(result.originalText).toBe('');
    expect(result.redactedText).toBe('');
    expect(result.entities).toEqual([]);
    expect(result.vault).toEqual({});
    expect(unmaskText('', {})).toBe('');
  });

  it('handles purely whitespace strings', () => {
    const spaces = '   \t\r\n   ';
    expect(scanTier1Regex(spaces)).toEqual([]);
    expect(scanTier2Luhn(spaces)).toEqual([]);
    expect(scanTier3Entropy(spaces)).toEqual([]);
    const res = redactText(spaces);
    expect(res.redactedText).toBe(spaces);
  });

  it('audits execution timings on 50,000+ char adversarial inputs', () => {
    // 1. Long repetition of digits and hyphens
    const digitsExploit = '1-'.repeat(25000); // 50,000 chars
    const t1 = performance.now();
    scanTier2Luhn(digitsExploit);
    const luhnDuration = performance.now() - t1;
    expect(luhnDuration).toBeLessThan(100);

    // 2. Long repetition of sk- tokens
    const skExploit = 'sk-ant-'.repeat(8000); // 56,000 chars
    const t2 = performance.now();
    scanTier1Regex(skExploit);
    const skDuration = performance.now() - t2;
    console.log(`[Adversarial Audit] 56k sk-ant- scan latency: ${skDuration.toFixed(2)}ms`);
    expect(skDuration).toBeLessThan(2000);

    // 3. Massive prompt (100,000 chars) with repeated potential token delimiters
    const massiveText = 'word '.repeat(20000); // 100,000 chars
    const t3 = performance.now();
    const fullRes = redactText(massiveText);
    const fullDuration = performance.now() - t3;
    expect(fullDuration).toBeLessThan(500);
    expect(fullRes.entities.length).toBe(0);
  });

  it('evaluates mixed casing behavior on credentials and PII', () => {
    // Emails with mixed casing
    const mixedEmail = 'User.Name+TEST@SubDomain.Enterprise.COM';
    const emailRes = scanTier1Regex(mixedEmail);
    expect(emailRes.length).toBe(1);
    expect(emailRes[0]!.type).toBe('EMAIL');
    expect(emailRes[0]!.raw).toBe(mixedEmail);

    // OpenAI key with mixed casing in suffix
    const openaiKey = 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    const openaiRes = scanTier1Regex(openaiKey);
    expect(openaiRes.length).toBe(1);
    expect(openaiRes[0]!.type).toBe('OPENAI_API_KEY');

    // AWS Access Key ID is strictly uppercase in AWS spec
    const lowerAws = 'akiaiosfodnn7example';
    expect(scanTier1Regex(lowerAws)).toEqual([]); // Lowercase is not a valid AWS access key
  });

  it('evaluates multi-entity dense prompts with zero delimiter collisions', () => {
    const densePrompt = [
      'Email: alice@work.com',
      'Card: 4532 0151 1283 0366',
      'OpenAI: sk-proj-1234567890123456789012345678901234567890',
      'Anthropic: sk-ant-abcdef12345678901234567890',
      'AWS: AKIAIOSFODNN7EXAMPLE',
      'IPv4: 192.168.1.1',
      'SSN: 123-45-6789',
    ].join('\n');

    const result = redactText(densePrompt);
    expect(result.entities.length).toBe(7);

    // Verify unmasking reproduces the entire multi-entity prompt with 100% fidelity
    const restored = unmaskText(result.redactedText, result.vault);
    expect(restored).toBe(densePrompt);
  });

  it('correctly captures full phone number including leading + sign', () => {
    const phone1 = 'Call +1-555-234-5678';
    const match1 = scanTier1Regex(phone1);
    expect(match1.length).toBe(1);
    expect(match1[0]!.raw).toBe('+1-555-234-5678');
  });

  it('tests Shannon Entropy extreme inputs', () => {
    expect(calculateShannonEntropy('AAAAAAAAAAAAAAAA')).toBe(0);

    const uniform16 = 'abcdefghijklmnop';
    expect(calculateShannonEntropy(uniform16)).toBeCloseTo(4.0, 2);

    const unicodeText = '🔒🔑🛡️✨🌟⚡🎯🔥';
    expect(calculateShannonEntropy(unicodeText)).toBeGreaterThan(0);
  });
});

describe('Adversarial Vault Audit: Concurrency, TTL & Memory', () => {
  it('handles 1,000 concurrent sessions without cross-talk', () => {
    const vault = new SessionVault(300);
    const sessionCount = 1000;

    for (let i = 0; i < sessionCount; i++) {
      const sessId = `session_${i}`;
      const secret = `secret_value_for_session_${i}_${Math.random()}`;
      vault.registerSecret(sessId, secret, 'HIGH_ENTROPY_SECRET');
    }

    const stats = vault.getStats();
    expect(stats.activeSessions).toBe(sessionCount);
    expect(stats.totalSecretsProtected).toBe(sessionCount);

    for (let i = 0; i < 50; i++) {
      const sessId = `session_${i}`;
      const map = vault.getSessionMap(sessId);
      expect(map['[HIGH_ENTROPY_SECRET_1]']).toContain(`secret_value_for_session_${i}_`);
    }

    vault.clearAll();
    expect(vault.getStats().activeSessions).toBe(0);
  });

  it('reschedules TTL timer on access, preventing premature eviction', () => {
    vi.useFakeTimers();
    const vault = new SessionVault(5);

    vault.registerSecret('active_chat', 'secret_token_123', 'GENERIC_API_KEY');

    vi.advanceTimersByTime(3000);
    expect(vault.getStats().activeSessions).toBe(1);

    const resolved = vault.resolvePlaceholder('active_chat', '[GENERIC_API_KEY_1]');
    expect(resolved).toBe('secret_token_123');

    vi.advanceTimersByTime(3000);
    expect(vault.getStats().activeSessions).toBe(1);

    vi.advanceTimersByTime(3000);
    expect(vault.getStats().activeSessions).toBe(0);

    vi.useRealTimers();
  });

  it('purges timers cleanly on clearAll without memory leakage', () => {
    const vault = new SessionVault(300);
    for (let i = 0; i < 100; i++) {
      vault.registerSecret(`temp_${i}`, `val_${i}`, 'EMAIL');
    }
    expect(vault.getStats().activeSessions).toBe(100);

    vault.clearAll();
    expect(vault.getStats().activeSessions).toBe(0);
  });
});

describe('Adversarial DOM Unmasker Audit: Infinite Loop & Mutation Resilience', () => {
  it('prevents infinite mutation loops when replacing placeholders in DOM text nodes', async () => {
    const window = new Window();
    const document = window.document;
    const vault = new SessionVault(300);

    vault.registerSecret('test_dom_sess', 'sk-ant-real-secret-12345', 'ANTHROPIC_API_KEY');

    const originalNode = globalThis.Node;
    const originalDocument = globalThis.document;
    const originalNodeFilter = globalThis.NodeFilter;
    const originalMutationObserver = globalThis.MutationObserver;

    globalThis.Node = window.Node as unknown as typeof Node;
    globalThis.document = document as unknown as Document;
    globalThis.NodeFilter = window.NodeFilter as unknown as typeof NodeFilter;
    globalThis.MutationObserver = window.MutationObserver as unknown as typeof MutationObserver;

    try {
      const container = document.createElement('div') as unknown as Node;
      document.body.appendChild(container as unknown as typeof window.Element.prototype);

      const unmasker = new DOMUnmasker(vault, 'test_dom_sess');
      unmasker.startObserving(container);

      let mutationCount = 0;
      const testObserver = new window.MutationObserver(() => {
        mutationCount++;
      });
      testObserver.observe(container as unknown as typeof window.Element.prototype, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      const p = document.createElement('p');
      const textNode = document.createTextNode('Here is your key: [ANTHROPIC_API_KEY_1]');
      p.appendChild(textNode);
      (container as unknown as typeof window.Element.prototype).appendChild(p);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(textNode.nodeValue).toBe('Here is your key: sk-ant-real-secret-12345');
      expect(mutationCount).toBeLessThan(10);

      unmasker.stopObserving();
      testObserver.disconnect();
    } finally {
      globalThis.Node = originalNode;
      globalThis.document = originalDocument;
      globalThis.NodeFilter = originalNodeFilter;
      globalThis.MutationObserver = originalMutationObserver;
    }
  });

  it('handles streaming chunks where placeholder arrives split across mutations', async () => {
    const window = new Window();
    const document = window.document;
    const vault = new SessionVault(300);

    vault.registerSecret('stream_sess', 'my_secret_token', 'GENERIC_API_KEY');

    const originalNode = globalThis.Node;
    const originalDocument = globalThis.document;
    const originalNodeFilter = globalThis.NodeFilter;
    const originalMutationObserver = globalThis.MutationObserver;

    globalThis.Node = window.Node as unknown as typeof Node;
    globalThis.document = document as unknown as Document;
    globalThis.NodeFilter = window.NodeFilter as unknown as typeof NodeFilter;
    globalThis.MutationObserver = window.MutationObserver as unknown as typeof MutationObserver;

    try {
      const container = document.createElement('div') as unknown as Node;
      document.body.appendChild(container as unknown as typeof window.Element.prototype);

      const unmasker = new DOMUnmasker(vault, 'stream_sess');
      unmasker.startObserving(container);

      const p = document.createElement('p');
      const textNode = document.createTextNode('Key is: [GENERIC_');
      p.appendChild(textNode);
      (container as unknown as typeof window.Element.prototype).appendChild(p);

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(textNode.nodeValue).toBe('Key is: [GENERIC_');

      textNode.nodeValue = 'Key is: [GENERIC_API_KEY_1]';
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(textNode.nodeValue).toBe('Key is: my_secret_token');

      unmasker.stopObserving();
    } finally {
      globalThis.Node = originalNode;
      globalThis.document = originalDocument;
      globalThis.NodeFilter = originalNodeFilter;
      globalThis.MutationObserver = originalMutationObserver;
    }
  });
});
