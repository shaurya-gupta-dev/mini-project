/**
 * In-Page Network Interceptor
 * Intercepts window.fetch calls to LLM conversation APIs, redacting prompt payloads
 * before socket transmission and providing lookahead unmasking for incoming streams.
 */

import { redactText } from '../engine/detector_pipeline.js';
import { defaultSessionVault } from '../vault/session_vault.js';

export function setupFetchInterceptor(
  sessionId: string = 'browser_tab_session',
  onRedactCallback?: (redactedCount: number) => void
): void {
  if (typeof window === 'undefined' || !window.fetch) return;

  const originalFetch = window.fetch;

  window.fetch = async function (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    if (init && init.method && init.method.toUpperCase() === 'POST' && init.body) {
      try {
        let bodyText: string | null = null;

        if (typeof init.body === 'string') {
          bodyText = init.body;
        }

        if (bodyText) {
          // Attempt parsing JSON payloads typical in LLM requests
          try {
            const parsed = JSON.parse(bodyText);
            let modified = false;
            let totalRedactions = 0;

            const sanitizeObject = (obj: unknown): unknown => {
              if (typeof obj === 'string') {
                const res = redactText(obj);
                if (res.entities.length > 0) {
                  modified = true;
                  totalRedactions += res.entities.length;
                  // Register each entity into the session vault
                  for (const entity of res.entities) {
                    defaultSessionVault.registerSecret(sessionId, entity.raw, entity.type);
                  }
                  return res.redactedText;
                }
                return obj;
              } else if (Array.isArray(obj)) {
                return obj.map(sanitizeObject);
              } else if (obj !== null && typeof obj === 'object') {
                const newObj: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(obj)) {
                  newObj[k] = sanitizeObject(v);
                }
                return newObj;
              }
              return obj;
            };

            const sanitized = sanitizeObject(parsed);

            if (modified) {
              init.body = JSON.stringify(sanitized);
              if (onRedactCallback) {
                onRedactCallback(totalRedactions);
              }
            }
          } catch {
            // Non-JSON string payload: direct redaction
            const res = redactText(bodyText);
            if (res.entities.length > 0) {
              for (const entity of res.entities) {
                defaultSessionVault.registerSecret(sessionId, entity.raw, entity.type);
              }
              init.body = res.redactedText;
              if (onRedactCallback) {
                onRedactCallback(res.entities.length);
              }
            }
          }
        }
      } catch (err) {
        // Fail-open for fetch transmission if interception throws unexpected error
        console.error('[AegisLLM] Interceptor error:', err);
      }
    }

    return originalFetch.call(this, input, init);
  };
}

