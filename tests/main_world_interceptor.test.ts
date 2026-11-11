import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isLLMConversationEndpoint,
  sanitizeGeminiFreq,
  processPayloadString,
  sanitizeJsonPayload,
  allowedSecrets,
} from '../src/extension/interceptor.js';

describe('MAIN World Network & Payload Interceptor Invariants', () => {
  describe('Strict URL Filtering (isLLMConversationEndpoint)', () => {
    it('accepts verified Gemini conversation endpoints', () => {
      expect(
        isLLMConversationEndpoint(
          'https://gemini.google.com/_/BardFrontendService/StreamGenerate?bl=boq_assistant'
        )
      ).toBe(true);
      expect(
        isLLMConversationEndpoint(
          'https://gemini.google.com/assistant.lamda.BardFrontendService/StreamGenerate'
        )
      ).toBe(true);
    });

    it('accepts Gemini batchexecute endpoints (actual message submission path)', () => {
      expect(
        isLLMConversationEndpoint(
          'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=gbrRHe&source-path=%2F'
        )
      ).toBe(true);
      expect(
        isLLMConversationEndpoint(
          'https://gemini.google.com/_/BardChatUi/data/batchexecute'
        )
      ).toBe(true);
    });

    it('accepts verified Claude conversation endpoints', () => {
      expect(
        isLLMConversationEndpoint(
          'https://claude.ai/api/organizations/org_123/chat_conversations/conv_456/completion'
        )
      ).toBe(true);
      expect(
        isLLMConversationEndpoint(
          'https://claude.ai/api/organizations/org_123/chat_conversations/conv_456/append_message'
        )
      ).toBe(true);
    });

    it('accepts verified ChatGPT conversation endpoints', () => {
      expect(
        isLLMConversationEndpoint('https://chatgpt.com/backend-api/conversation')
      ).toBe(true);
      expect(isLLMConversationEndpoint('/backend-api/conversation')).toBe(true);
    });

    it('REJECTS non-Gemini sites with batchexecute', () => {
      // batchexecute is only matched when on gemini.google.com
      expect(isLLMConversationEndpoint('https://mail.google.com/_/data/batchexecute')).toBe(false);
      expect(isLLMConversationEndpoint('https://drive.google.com/_/batchexecute')).toBe(false);
    });

    it('REJECTS non-conversation endpoints', () => {
      expect(isLLMConversationEndpoint('https://gemini.google.com/client-telemetry')).toBe(false);
      expect(isLLMConversationEndpoint('https://gemini.google.com/_/ss/k=bard.web.bundle.js')).toBe(false);
      expect(isLLMConversationEndpoint('https://accounts.google.com/o/oauth2/v2/auth')).toBe(false);
      expect(isLLMConversationEndpoint('https://claude.ai/api/organizations')).toBe(false);
      expect(isLLMConversationEndpoint('https://claude.ai/api/auth/session')).toBe(false);
      expect(isLLMConversationEndpoint('https://claude.ai/api/organizations/org_123/chat_conversations')).toBe(false);
      expect(isLLMConversationEndpoint('https://chatgpt.com/api/auth/session')).toBe(false);
      expect(isLLMConversationEndpoint('https://chatgpt.com/backend-api/models')).toBe(false);
      expect(isLLMConversationEndpoint('')).toBe(false);
      expect(isLLMConversationEndpoint('https://google.com')).toBe(false);
    });
  });

  describe('Gemini f.req Parameter Surgical Sanitization', () => {
    it('sanitizes ONLY f.req and leaves at/f.sid 100% UNTOUCHED', () => {
      const rawAtToken = 'AB1234CD+XyZ%3D%3D';
      const rawSessionId = 'sess_1234567890abcdef';
      const promptWithSecret = 'Check this AWS key: AKIAIOSFODNN7EXAMPLE';
      const innerJson = JSON.stringify([[null, promptWithSecret]]);
      const rawBody = `f.req=${encodeURIComponent(innerJson)}&at=${rawAtToken}&f.sid=${rawSessionId}`;

      const res = sanitizeGeminiFreq(rawBody);

      expect(res.modified).toBe(true);
      expect(res.entities.length).toBe(1);
      expect(res.entities[0].type).toBe('AWS_ACCESS_KEY');
      expect(res.sanitized).not.toContain('AKIAIOSFODNN7EXAMPLE');
      expect(res.sanitized).toContain('%5BAWS_ACCESS_KEY_1%5D');
      expect(res.sanitized).toContain(`&at=${rawAtToken}`);
      expect(res.sanitized).toContain(`&f.sid=${rawSessionId}`);
    });

    it('returns modified=false when f.req contains no secrets', () => {
      const safeBody = `f.req=${encodeURIComponent(JSON.stringify('Hello, how is the weather?'))}&at=SAFE_TOKEN`;
      const res = sanitizeGeminiFreq(safeBody);
      expect(res.modified).toBe(false);
      expect(res.sanitized).toBe(safeBody);
    });
  });

  describe('JSON Payload Sanitization (sanitizeJsonPayload)', () => {
    it('sanitizes Claude prompt field containing secrets', () => {
      const payload = {
        prompt: 'Check this key: sk-proj-1234567890abcdef1234567890abcdef please',
        timezone: 'Asia/Kolkata',
        model: 'claude-sonnet-4-20250514',
        tools: [
          { type: 'computer_20250124', name: 'computer' },
          { type: 'text_editor_20250124', name: 'text_editor' },
          { type: 'web_search_20250305', name: 'web_search' },
        ],
      };

      const res = sanitizeJsonPayload(payload as Record<string, unknown>);

      expect(res.modified).toBe(true);
      expect(res.entities.length).toBe(1);
      expect(res.entities[0].type).toBe('OPENAI_API_KEY');

      const sanitizedObj = JSON.parse(res.sanitized);
      // User content IS sanitized
      expect(sanitizedObj.prompt).toContain('[OPENAI_API_KEY_1]');
      expect(sanitizedObj.prompt).not.toContain('sk-proj-1234567890abcdef1234567890abcdef');

      // Tool definitions are NEVER corrupted
      expect(sanitizedObj.tools).toHaveLength(3);
      expect(sanitizedObj.tools[0].type).toBe('computer_20250124');
      expect(sanitizedObj.tools[0].name).toBe('computer');
      expect(sanitizedObj.tools[1].type).toBe('text_editor_20250124');
      expect(sanitizedObj.tools[1].name).toBe('text_editor');
      expect(sanitizedObj.tools[2].type).toBe('web_search_20250305');
      expect(sanitizedObj.tools[2].name).toBe('web_search');

      // Metadata is NEVER corrupted
      expect(sanitizedObj.model).toBe('claude-sonnet-4-20250514');
      expect(sanitizedObj.timezone).toBe('Asia/Kolkata');
    });

    it('sanitizes Claude official Messages API format with content blocks array', () => {
      const payload = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'LUCIDITY_API_KEYS=cmp438078272436591415144cbd44b149a9 what is this',
              },
            ],
          },
        ],
        tools: [
          {
            name: 'web_search',
            type: 'web_search_20250101',
          },
        ],
      };

      const res = sanitizeJsonPayload(payload as Record<string, unknown>);
      expect(res.modified).toBe(true);
      expect(res.entities.length).toBe(1);
      expect(res.entities[0].type).toBe('GENERIC_API_KEY');

      const sanitizedObj = JSON.parse(res.sanitized);
      // The secret inside content block IS sanitized
      expect(sanitizedObj.messages[0].content[0].text).toBe(
        'LUCIDITY_API_KEYS=[GENERIC_API_KEY_1] what is this'
      );
      expect(sanitizedObj.messages[0].content[0].text).not.toContain(
        'cmp438078272436591415144cbd44b149a9'
      );

      // Tools remain untouched
      expect(sanitizedObj.tools[0].name).toBe('web_search');
      expect(sanitizedObj.tools[0].type).toBe('web_search_20250101');
    });

    it('sanitizes ChatGPT messages array with nested content.parts', () => {
      const payload = {
        action: 'next',
        messages: [
          {
            id: 'msg_abc123',
            author: { role: 'user' },
            content: {
              content_type: 'text',
              parts: ['LUCIDITY_API_KEYS=cmp438078272436591415144cbd44b149a9 what is this'],
            },
          },
        ],
        model: 'gpt-4o',
        parent_message_id: 'msg_parent',
      };

      const res = sanitizeJsonPayload(payload as Record<string, unknown>);

      expect(res.modified).toBe(true);
      const sanitizedObj = JSON.parse(res.sanitized);

      // User content IS sanitized
      expect(sanitizedObj.messages[0].content.parts[0]).toContain('[GENERIC_API_KEY_1]');
      expect(sanitizedObj.messages[0].content.parts[0]).not.toContain('cmp438078272436591415144cbd44b149a9');

      // Metadata is NEVER corrupted
      expect(sanitizedObj.model).toBe('gpt-4o');
      expect(sanitizedObj.action).toBe('next');
      expect(sanitizedObj.messages[0].id).toBe('msg_abc123');
    });

    it('NEVER sanitizes assistant or system messages', () => {
      const payload = {
        messages: [
          { role: 'system', content: 'You are a helpful assistant. API_KEY=system_level_config_123456' },
          { role: 'assistant', content: 'Here is your key: sk-proj-assistantreplytoken12345678' },
          { role: 'user', content: 'sk-proj-1234567890abcdef1234567890abcdef' },
        ],
      };

      const res = sanitizeJsonPayload(payload as Record<string, unknown>);

      expect(res.modified).toBe(true);
      const sanitizedObj = JSON.parse(res.sanitized);

      // Only user message is sanitized
      expect(sanitizedObj.messages[2].content).toContain('[OPENAI_API_KEY');
      // System and assistant messages are untouched
      expect(sanitizedObj.messages[0].content).toContain('system_level_config_123456');
      expect(sanitizedObj.messages[1].content).toContain('sk-proj-assistantreplytoken12345678');
    });

    it('returns modified=false when user content has no secrets', () => {
      const payload = {
        prompt: 'What is the speed of light in vacuum?',
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      };

      const res = sanitizeJsonPayload(payload as Record<string, unknown>);
      expect(res.modified).toBe(false);
    });
  });

  describe('processPayloadString routing', () => {
    it('routes Gemini f.req payloads through sanitizeGeminiFreq', () => {
      const rawGeminiBody =
        'f.req=%5B%5Bnull%2C%22Debug%20AWS%20Key%3A%20AKIAIOSFODNN7EXAMPLE%22%5D%5D&at=AB1234CD';

      const res = processPayloadString(rawGeminiBody);
      expect(res.modified).toBe(true);
      expect(res.sanitized).toContain('%5BAWS_ACCESS_KEY_1%5D');
      expect(res.sanitized).not.toContain('AKIAIOSFODNN7EXAMPLE');
      expect(res.sanitized).toContain('&at=AB1234CD');
    });

    it('routes Claude/ChatGPT JSON payloads through sanitizeJsonPayload', () => {
      const claudePayload = JSON.stringify({
        prompt: 'Please check this key: sk-proj-1234567890abcdef1234567890abcdef',
        model: 'claude-3-5-sonnet',
        tools: [{ type: 'computer_20250124', name: 'computer' }],
      });

      const res = processPayloadString(claudePayload);
      expect(res.modified).toBe(true);
      expect(res.sanitized).not.toContain('sk-proj-1234567890abcdef1234567890abcdef');
      expect(res.sanitized).toContain('[OPENAI_API_KEY_1]');

      // Tool must NOT be corrupted
      const parsed = JSON.parse(res.sanitized);
      expect(parsed.tools[0].type).toBe('computer_20250124');
      expect(parsed.tools[0].name).toBe('computer');
      expect(parsed.model).toBe('claude-3-5-sonnet');
    });

    it('preserves safe payloads without modification', () => {
      const safePayload = JSON.stringify({
        messages: [{ role: 'user', content: 'What is the speed of light in vacuum?' }],
      });

      const res = processPayloadString(safePayload);
      expect(res.modified).toBe(false);
    });
  });

  describe('User-Allowed Secret Exceptions (Leave as is)', () => {
    const intentionalKey = 'sk-proj-INTENTIONALKEY1234567890abcdef123';

    beforeEach(() => {
      allowedSecrets.clear();
    });

    afterEach(() => {
      allowedSecrets.clear();
    });

    it('redacts secret when NOT in allowedSecrets', () => {
      const payload = {
        messages: [{ role: 'user', content: `Please use ${intentionalKey}` }],
      };
      const res = sanitizeJsonPayload(payload);
      expect(res.modified).toBe(true);
      expect(res.sanitized).toContain('[OPENAI_API_KEY_1]');
      expect(res.sanitized).not.toContain(intentionalKey);
    });

    it('permits secret through completely untouched when registered in allowedSecrets', () => {
      allowedSecrets.add(intentionalKey);

      const payload = {
        messages: [{ role: 'user', content: `Please use ${intentionalKey}` }],
      };
      const res = sanitizeJsonPayload(payload);
      expect(res.modified).toBe(false);
      expect(res.sanitized).toContain(intentionalKey);
      expect(res.sanitized).not.toContain('[OPENAI_API_KEY_1]');
    });

    it('permits allowed secret in Gemini f.req bodies without altering it', () => {
      allowedSecrets.add('AKIAIOSFODNN7EXAMPLE');
      const rawGeminiBody =
        'f.req=%5B%5Bnull%2C%22Debug%20AWS%20Key%3A%20AKIAIOSFODNN7EXAMPLE%22%5D%5D&at=AB1234CD';

      const res = sanitizeGeminiFreq(rawGeminiBody);
      expect(res.modified).toBe(false);
      expect(res.sanitized).toBe(rawGeminiBody);
    });

    it('redacts unallowed secret while preserving allowed secret in the same payload', () => {
      const unallowedKey = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      allowedSecrets.add(intentionalKey);

      const payload = {
        messages: [
          { role: 'user', content: `Allowed: ${intentionalKey} and Blocked: ${unallowedKey}` },
        ],
      };
      const res = sanitizeJsonPayload(payload);
      expect(res.modified).toBe(true);
      expect(res.sanitized).toContain(intentionalKey);
      expect(res.sanitized).toContain('[GITHUB_TOKEN_1]');
      expect(res.sanitized).not.toContain(unallowedKey);
    });

    it('honors allowedSecrets in URLSearchParams bodies', () => {
      allowedSecrets.add('AKIAIOSFODNN7EXAMPLE');
      const params = new URLSearchParams();
      params.set('f.req', 'Deploy with AKIAIOSFODNN7EXAMPLE and secret ghp_11223344556677889900aabbccddeeff1234');
      
      const freq = params.get('f.req')!;
      const res = processPayloadString('f.req=' + encodeURIComponent(freq));
      
      expect(res.modified).toBe(true);
      // Allowed AWS key is retained
      expect(decodeURIComponent(res.sanitized)).toContain('AKIAIOSFODNN7EXAMPLE');
      // Unallowed GitHub token is redacted
      expect(decodeURIComponent(res.sanitized)).toContain('[GITHUB_TOKEN_1]');
      expect(decodeURIComponent(res.sanitized)).not.toContain('ghp_11223344556677889900aabbccddeeff1234');
    });
  });
});
