import { describe, it, expect } from 'vitest';
import { ChatGPTAdapter } from '../src/extension/adapters/chatgpt.js';
import { ClaudeAdapter } from '../src/extension/adapters/claude.js';
import { GeminiAdapter } from '../src/extension/adapters/gemini.js';
import { resolveAdapter } from '../src/extension/adapters/registry.js';
import { DOMUnmasker } from '../src/extension/dom_unmasker.js';
import { SessionVault } from '../src/vault/session_vault.js';

describe('Web LLM Platform Adapters', () => {
  it('correctly identifies ChatGPT URLs', () => {
    const adapter = new ChatGPTAdapter();
    expect(adapter.matches('https://chatgpt.com/c/12345')).toBe(true);
    expect(adapter.matches('https://chat.openai.com/')).toBe(true);
    expect(adapter.matches('https://claude.ai/')).toBe(false);
  });

  it('correctly identifies Claude URLs', () => {
    const adapter = new ClaudeAdapter();
    expect(adapter.matches('https://claude.ai/chat/abc')).toBe(true);
    expect(adapter.matches('https://chatgpt.com/')).toBe(false);
  });

  it('correctly identifies Gemini URLs', () => {
    const adapter = new GeminiAdapter();
    expect(adapter.matches('https://gemini.google.com/app')).toBe(true);
    expect(adapter.matches('https://claude.ai/')).toBe(false);
  });

  it('resolves correct adapter via registry matching', () => {
    expect(resolveAdapter('https://chatgpt.com/').name).toBe('ChatGPT');
    expect(resolveAdapter('https://claude.ai/').name).toBe('Claude');
    expect(resolveAdapter('https://gemini.google.com/').name).toBe('Gemini');
    expect(resolveAdapter('https://some-custom-llm-host.local/').name).toBe('Generic');
  });
});

describe('DOM Unmasker Core Logic', () => {
  it('instantiates and manages active session ID', () => {
    const vault = new SessionVault();
    vault.registerSecret('test_session', 'my-secret-key-123', 'HIGH_ENTROPY_SECRET');

    const unmasker = new DOMUnmasker(vault, 'test_session');
    expect(unmasker).toBeDefined();

    // Verify unmasking text directly from the vault bound to this unmasker
    const text = 'Result: [HIGH_ENTROPY_SECRET_1] was applied.';
    expect(vault.unmask('test_session', text)).toBe('Result: my-secret-key-123 was applied.');
  });
});

