/**
 * AegisLLM MAIN World Network Interceptor
 * Injected into the page's execution context (world: "MAIN") at document_start.
 * Intercepts window.fetch and XMLHttpRequest to guarantee that zero secrets or API keys
 * reach cloud LLMs, even if rich-text DOM state lagged or bypassed DOM event listeners.
 *
 * SCOPING:
 * - Gemini:  gemini.google.com batchexecute and StreamGenerate — only f.req is sanitized
 * - Claude:  /chat_conversations/ + /completion or /append_message — JSON field-level
 * - ChatGPT: /backend-api/conversation — JSON field-level
 * All other requests pass straight through with zero overhead.
 */

import { redactText } from '../engine/detector_pipeline.js';
import { DetectedEntity } from '../engine/types.js';

declare global {
  interface Window {
    __AEGIS_INTERCEPTOR_ACTIVE__?: boolean;
  }
}

/**
 * User-approved secrets set. Secrets in this set are permitted through to the LLM
 * without redaction when the user explicitly chooses "Leave as is" / Allow.
 */
export const allowedSecrets = new Set<string>();

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'AEGIS_ISOLATED_WORLD') return;

    if (event.data.type === 'SECRET_ALLOWED' && typeof event.data.raw === 'string') {
      allowedSecrets.add(event.data.raw);
      console.log('[AegisLLM] Secret marked as allowed by user:', event.data.raw.slice(0, 10) + '...');
    } else if (event.data.type === 'SECRET_REVOKED' && typeof event.data.raw === 'string') {
      allowedSecrets.delete(event.data.raw);
      console.log('[AegisLLM] Secret permission revoked:', event.data.raw.slice(0, 10) + '...');
    }
  });
}

/**
 * Returns true only for URLs that carry the user's chat message to an LLM backend.
 * Handles both relative and absolute URLs across Gemini, Claude, and ChatGPT.
 */
export function isLLMConversationEndpoint(url: string): boolean {
  if (!url) return false;

  const currentHost = typeof window !== 'undefined' && window.location ? window.location.hostname : '';

  // 1. Gemini — chat messages go through batchexecute or StreamGenerate (relative or absolute)
  const isOtherGoogleDomain = url.startsWith('http') && url.includes('google.com') && !url.includes('gemini.google.com');
  if (!isOtherGoogleDomain) {
    if (
      url.includes('batchexecute') ||
      url.includes('StreamGenerate') ||
      url.includes('BardFrontendService') ||
      url.includes('BardChatUi') ||
      (currentHost.includes('gemini.google.com') && url.includes('/data/'))
    ) {
      return true;
    }
  }

  // 2. Claude — user completions / message additions
  if (
    url.includes('/chat_conversations/') ||
    url.includes('/completion') ||
    url.includes('/append_message') ||
    (currentHost.includes('claude.ai') && url.includes('/messages'))
  ) {
    return true;
  }

  // 3. ChatGPT — user message submission
  if (url.includes('/backend-api/conversation')) {
    return true;
  }

  return false;
}

/**
 * Notifies the isolated world content script via window.postMessage so that
 * the ephemeral session vault and telemetry store stay synchronized.
 */
function notifyInterception(entities: DetectedEntity[]): void {
  if (entities.length === 0 || typeof window === 'undefined') return;
  try {
    window.postMessage(
      {
        source: 'AEGIS_MAIN_WORLD',
        type: 'SECRETS_INTERCEPTED',
        entityTypes: entities.map((e) => e.type),
        mappings: entities.map((e) => ({
          raw: e.raw,
          type: e.type,
        })),
      },
      '*'
    );
  } catch {
    // Ignore cross-origin postMessage restrictions if any
  }
}

/**
 * Surgically sanitizes ONLY the `f.req` parameter in Gemini URL-encoded RPC bodies.
 * NEVER touches Google's 'at' (XSRF token), 'f.sid', or other session parameters.
 */
export function sanitizeGeminiFreq(input: string): {
  sanitized: string;
  modified: boolean;
  entities: DetectedEntity[];
} {
  const match = input.match(/(?:^|&)f\.req=([^&]*)/);
  if (!match) {
    return { sanitized: input, modified: false, entities: [] };
  }

  const rawFreqEncoded = match[1]!;
  let decodedFreq: string;
  let isEncoded = false;
  try {
    decodedFreq = decodeURIComponent(rawFreqEncoded.replace(/\+/g, ' '));
    isEncoded = true;
  } catch {
    decodedFreq = rawFreqEncoded;
  }

  const res = redactText(decodedFreq, { allowedSecrets });
  if (res.entities.length === 0) {
    return { sanitized: input, modified: false, entities: [] };
  }

  const newEncodedFreq = isEncoded ? encodeURIComponent(res.redactedText) : res.redactedText;
  const prefix = match[0].startsWith('&') ? '&f.req=' : 'f.req=';

  const sanitized =
    input.slice(0, match.index!) +
    prefix +
    newEncodedFreq +
    input.slice(match.index! + match[0].length);

  return { sanitized, modified: true, entities: res.entities };
}

/**
 * Extracts ONLY user-authored text fields from a parsed JSON payload and redacts them.
 * Tool definitions, model names, metadata, and all non-content fields are NEVER touched.
 * Handles Claude prompt/messages (with array of text blocks) and ChatGPT conversation formats.
 */
export function sanitizeJsonPayload(parsed: Record<string, unknown>): {
  sanitized: string;
  modified: boolean;
  entities: DetectedEntity[];
} {
  const allEntities: DetectedEntity[] = [];
  let modified = false;

  const sanitizeStr = (val: string): string => {
    const res = redactText(val, { allowedSecrets });
    if (res.entities.length > 0) {
      allEntities.push(...res.entities);
      modified = true;
      return res.redactedText;
    }
    return val;
  };

  // 1. Claude: top-level "prompt" string
  if (typeof parsed.prompt === 'string' && parsed.prompt.length > 0) {
    parsed.prompt = sanitizeStr(parsed.prompt);
  }

  // 2. Direct text / input fields
  if (typeof parsed.text === 'string' && parsed.text.length > 0) {
    parsed.text = sanitizeStr(parsed.text);
  }
  if (typeof parsed.input === 'string' && parsed.input.length > 0) {
    parsed.input = sanitizeStr(parsed.input);
  }

  // 3. Messages array (Claude Messages API, ChatGPT backend API, etc.)
  if (Array.isArray(parsed.messages)) {
    for (const msg of parsed.messages) {
      if (!msg || typeof msg !== 'object') continue;
      const m = msg as Record<string, unknown>;

      // Determine role: default to user if not specified or role === 'user'
      const role =
        (typeof m.role === 'string' ? m.role : '') ||
        (m.author && typeof m.author === 'object' && typeof (m.author as Record<string, unknown>).role === 'string'
          ? ((m.author as Record<string, unknown>).role as string)
          : '');

      // Never touch system, assistant, or tool messages
      if (role && role !== 'user') continue;

      // Case A: content is a plain string
      if (typeof m.content === 'string') {
        m.content = sanitizeStr(m.content);
      }
      // Case B: content is an array of content blocks (Claude official format: [{ type: "text", text: "..." }])
      else if (Array.isArray(m.content)) {
        for (const block of m.content) {
          if (!block) continue;
          if (typeof block === 'string') {
            const idx = m.content.indexOf(block);
            m.content[idx] = sanitizeStr(block);
          } else if (typeof block === 'object') {
            const b = block as Record<string, unknown>;
            if (typeof b.text === 'string') {
              b.text = sanitizeStr(b.text);
            }
          }
        }
      }
      // Case C: content is an object with parts array (ChatGPT nested format: { content_type: "text", parts: ["..."] })
      else if (m.content && typeof m.content === 'object' && !Array.isArray(m.content)) {
        const contentObj = m.content as Record<string, unknown>;
        if (Array.isArray(contentObj.parts)) {
          for (let i = 0; i < contentObj.parts.length; i++) {
            if (typeof contentObj.parts[i] === 'string') {
              contentObj.parts[i] = sanitizeStr(contentObj.parts[i] as string);
            }
          }
        }
      }
    }
  }

  if (modified) {
    notifyInterception(allEntities);
    return { sanitized: JSON.stringify(parsed), modified: true, entities: allEntities };
  }

  return { sanitized: JSON.stringify(parsed), modified: false, entities: [] };
}

/**
 * Sanitizes LLM prompt payloads:
 * - Gemini: surgically sanitizes only f.req parameter (safe for batchexecute)
 * - Claude & ChatGPT: parses JSON, sanitizes ONLY user message text, never touches tools/model/metadata
 */
export function processPayloadString(input: string): {
  sanitized: string;
  modified: boolean;
  entities: DetectedEntity[];
} {
  // 1. Gemini URL-encoded form data: only sanitize f.req
  if (input.includes('f.req=')) {
    const geminiRes = sanitizeGeminiFreq(input);
    if (geminiRes.modified) {
      notifyInterception(geminiRes.entities);
    }
    return geminiRes;
  }

  // 2. JSON payloads (Claude / ChatGPT): parse and sanitize only user message fields
  if (input.length > 1 && (input[0] === '{' || input[0] === '[')) {
    try {
      const parsed = JSON.parse(input);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return sanitizeJsonPayload(parsed as Record<string, unknown>);
      }
    } catch {
      // Not valid JSON — fall through to raw scan
    }
  }

  // 3. Fallback: raw text scan (non-JSON, non-form-data payloads)
  const directRes = redactText(input, { allowedSecrets });
  if (directRes.entities.length > 0) {
    notifyInterception(directRes.entities);
    return { sanitized: directRes.redactedText, modified: true, entities: directRes.entities };
  }

  return { sanitized: input, modified: false, entities: [] };
}

function getUrlString(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return '';
}

export function initMainWorldInterceptor(): void {
  if (typeof window === 'undefined') return;
  if (window.__AEGIS_INTERCEPTOR_ACTIVE__) return;
  window.__AEGIS_INTERCEPTOR_ACTIVE__ = true;

  console.log('[AegisLLM] MAIN World Network Interceptor initialized (Strictly Scoped).');

  // 1. Monkeypatch window.fetch
  if (window.fetch) {
    const originalFetch = window.fetch;

    // Standard synchronous function: passes non-conversation and GET requests straight to originalFetch with ZERO overhead
    window.fetch = function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const url = getUrlString(input);
      const isReqWithFreq = Boolean(init && typeof init.body === 'string' && init.body.includes('f.req='));

      // FAST PATH 1: Strict URL scoping (or Gemini f.req body check)
      if (!isLLMConversationEndpoint(url) && !isReqWithFreq) {
        return originalFetch.call(this, input, init);
      }

      // FAST PATH 2: Non-payload HTTP methods (GET, HEAD, OPTIONS) - pass straight synchronously
      const method = (
        init?.method ||
        (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
      ).toUpperCase();

      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
        return originalFetch.call(this, input, init);
      }

      // SLOW PATH: Verified LLM conversation endpoint with POST/PUT/PATCH payload
      try {
        // Case 1: init options passed directly with string, URLSearchParams, or FormData body
        if (init && init.body) {
          if (typeof init.body === 'string') {
            const { sanitized, modified } = processPayloadString(init.body);
            if (modified) {
              init.body = sanitized;
            }
          } else if (init.body instanceof URLSearchParams) {
            const freq = init.body.get('f.req');
            if (freq) {
              const res = redactText(freq, { allowedSecrets });
              if (res.entities.length > 0) {
                init.body.set('f.req', res.redactedText);
                notifyInterception(res.entities);
              }
            }
          } else if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
            const freq = init.body.get('f.req');
            if (typeof freq === 'string') {
              const res = redactText(freq, { allowedSecrets });
              if (res.entities.length > 0) {
                init.body.set('f.req', res.redactedText);
                notifyInterception(res.entities);
              }
            }
          }
          return originalFetch.call(this, input, init);
        }

        // Case 2: input is a Request instance with payload body
        if (typeof Request !== 'undefined' && input instanceof Request) {
          return (async () => {
            try {
              const cloned = input.clone();
              const bodyText = await cloned.text();
              if (bodyText) {
                const { sanitized, modified } = processPayloadString(bodyText);
                if (modified) {
                  const newReq = new Request(input, { body: sanitized });
                  return originalFetch.call(this, newReq, init);
                }
              }
            } catch {
              // Fail open if body is locked stream
            }
            return originalFetch.call(this, input, init);
          })();
        }
      } catch (err) {
        console.error('[AegisLLM] Error intercepting fetch payload:', err);
      }

      return originalFetch.call(this, input, init);
    };
  }

  // 2. Monkeypatch XMLHttpRequest (strictly scoped to conversation endpoints)
  if (typeof XMLHttpRequest !== 'undefined') {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      ...args: any[]
    ): void {
      const urlStr = typeof url === 'string' ? url : url?.toString() || '';
      (this as any).__aegis_url = urlStr;
      // Flag for interception if targeting a verified conversation endpoint
      if (isLLMConversationEndpoint(urlStr)) {
        (this as any).__aegis_intercept = true;
      }
      return (originalOpen as any).apply(this, [method, url, ...args]);
    };

    XMLHttpRequest.prototype.send = function (
      body?: Document | XMLHttpRequestBodyInit | null
    ): void {
      const urlStr = (this as any).__aegis_url || '';
      const hasFreq = Boolean(body && typeof body === 'string' && body.includes('f.req='));
      const shouldIntercept = (this as any).__aegis_intercept || isLLMConversationEndpoint(urlStr) || hasFreq;

      if (shouldIntercept && body && typeof body === 'string') {
        try {
          const { sanitized, modified } = processPayloadString(body);
          if (modified) {
            return originalSend.call(this, sanitized);
          }
        } catch {
          // Send original on error
        }
      }
      return originalSend.call(this, body);
    };
  }
}

// Auto-initialize when loaded
initMainWorldInterceptor();
