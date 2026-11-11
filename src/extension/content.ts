/**
 * AegisLLM Content Script
 *
 * Orchestrates:
 * 1. Platform adapters (Claude ProseMirror, Gemini Quill/Wiz).
 * 2. Per-secret Inline Annotations (wavy underline + individual warning badges with informative hover tooltip).
 * 3. Send Gatekeeper Modal (intercepts submission if unreviewed warnings remain).
 * 4. Reversible real-time unmasking for streaming LLM responses.
 * 5. Integration with AWS DynamoDB/Lambda telemetry & S3 dynamic rule packs.
 */

import { resolveAdapter } from './adapters/registry.js';
import { DOMUnmasker } from './dom_unmasker.js';
import { defaultSessionVault } from '../vault/session_vault.js';
import { detectEntities } from '../engine/detector_pipeline.js';
import { extractEditorText } from './adapters/editor_replacer.js';
import {
  InlineSecretAnnotator,
  DetectedSecretItem,
} from './ui/inline_secret_annotator.js';
import { SendGatekeeper } from './ui/send_gatekeeper.js';

const SESSION_ID = 'tab_' + Math.random().toString(36).substring(2, 10);
const adapter = resolveAdapter(window.location.href);
const unmasker = new DOMUnmasker(defaultSessionVault, SESSION_ID);

console.log(`[AegisLLM] Content script active for ${adapter.name} (Session: ${SESSION_ID})`);

// 1. User-Approved Secrets Set
const allowedSecretsSet = new Set<string>();

// 2. Instantiate Inline Secret Annotator
const annotator = new InlineSecretAnnotator();

// 3. Instantiate Send Gatekeeper Modal
let lastAttemptedSendButton: HTMLElement | null = null;
const gatekeeper = new SendGatekeeper({
  onAllowAll: (secrets: DetectedSecretItem[]) => {
    handleGatekeeperAllowAll(secrets);
  },
  onReview: () => {
    handleGatekeeperReview();
  },
});

// Mount UI components once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    annotator.mount();
    gatekeeper.mount();
    scanEditorPrompt();
  });
} else {
  annotator.mount();
  gatekeeper.mount();
}

// 4. Listen for messages from MAIN world interceptor to sync session vault & telemetry
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || event.data.source !== 'AEGIS_MAIN_WORLD') return;

  if (event.data.type === 'SECRETS_INTERCEPTED') {
    const { mappings, entityTypes } = event.data;
    if (Array.isArray(mappings)) {
      for (const m of mappings) {
        if (m && m.raw && m.type) {
          defaultSessionVault.registerSecret(SESSION_ID, m.raw, m.type);
        }
      }
    }
    if (Array.isArray(entityTypes) && entityTypes.length > 0) {
      notifyBackground(entityTypes);
    }
  }
});

// 5. Start DOM unmasking observer on document body
unmasker.startObserving(document.body);

// 6. Real-Time Debounced Scanner for Chat Prompt Input & Target Locking
let scanDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentDetectedItems: DetectedSecretItem[] = [];
let currentTargetInput: HTMLElement | null = null;
let lastFocusedEditor: HTMLElement | null = null;

function updateLastFocusedEditor(target: EventTarget | null): void {
  if (target && target instanceof Element) {
    if (
      target.closest('#aegis-inline-annotations-root') ||
      target.closest('#aegis-gatekeeper-root')
    ) {
      return;
    }
    const editable = target.closest<HTMLElement>(
      '[contenteditable="true"], rich-textarea, textarea, input'
    );
    if (editable) {
      lastFocusedEditor = editable;
      currentTargetInput = editable;
    }
  }
}

function schedulePromptScan(delayMs = 100): void {
  if (scanDebounceTimer) {
    clearTimeout(scanDebounceTimer);
  }
  scanDebounceTimer = setTimeout(() => {
    scanEditorPrompt();
  }, delayMs);
}

function resolveActiveEditor(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  if (
    active &&
    !active.closest('#aegis-inline-annotations-root') &&
    !active.closest('#aegis-gatekeeper-root')
  ) {
    const editable = active.closest<HTMLElement>(
      '[contenteditable="true"], rich-textarea, textarea, input'
    );
    if (editable) {
      lastFocusedEditor = editable;
      return editable;
    }
  }

  // If last focused editor is still connected to DOM, maintain lock!
  if (lastFocusedEditor && lastFocusedEditor.isConnected) {
    return lastFocusedEditor;
  }

  // Fallback to platform adapter resolution
  const fallback = adapter.findInputElement();
  if (fallback) {
    lastFocusedEditor = fallback;
    return fallback;
  }

  return null;
}

function scanEditorPrompt(): void {
  const inputEl = resolveActiveEditor();
  currentTargetInput = inputEl;

  if (!inputEl) {
    annotator.setTargetEditor(null);
    annotator.updateSecrets([], allowedSecretsSet);
    return;
  }

  annotator.setTargetEditor(inputEl);

  const rawPrompt = extractEditorText(inputEl) || adapter.extractPrompt(inputEl);
  if (!rawPrompt || !rawPrompt.trim()) {
    currentDetectedItems = [];
    annotator.updateSecrets([], allowedSecretsSet);
    return;
  }

  // Scan with all active detection tiers
  const entities = detectEntities(rawPrompt);

  // Map to DetectedSecretItem with precise character boundaries
  const items: DetectedSecretItem[] = entities.map((entity) => ({
    type: entity.type,
    raw: entity.raw,
    startIndex: entity.startIndex,
    endIndex: entity.endIndex,
  }));

  currentDetectedItems = items;
  annotator.updateSecrets(items, allowedSecretsSet);
}

// 7. Gatekeeper Action Handlers
function handleGatekeeperAllowAll(secrets: DetectedSecretItem[]): void {
  for (const s of secrets) {
    allowedSecretsSet.add(s.raw);
    try {
      window.postMessage(
        { source: 'AEGIS_ISOLATED_WORLD', type: 'SECRET_ALLOWED', raw: s.raw },
        '*'
      );
    } catch {
      // Ignore
    }
  }

  annotator.updateSecrets(currentDetectedItems, allowedSecretsSet);

  // Resume submission
  if (lastAttemptedSendButton && lastAttemptedSendButton.isConnected) {
    const btn = lastAttemptedSendButton;
    lastAttemptedSendButton = null;
    btn.click();
  } else {
    const inputEl = resolveActiveEditor() || currentTargetInput;
    if (inputEl) {
      inputEl.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        })
      );
    }
  }
}

function handleGatekeeperReview(): void {
  lastAttemptedSendButton = null;
  const inputEl = resolveActiveEditor() || currentTargetInput;
  if (inputEl && typeof inputEl.focus === 'function') {
    inputEl.focus();
  }
}

// 8. Event Listeners for Editor Focus, Input, and Scrolling
document.addEventListener('focusin', (e) => {
  updateLastFocusedEditor(e.target);
  schedulePromptScan(50);
}, true);

document.addEventListener('pointerdown', (e) => {
  updateLastFocusedEditor(e.target);
}, true);

document.addEventListener('beforeinput', (e) => {
  updateLastFocusedEditor(e.target);
}, true);

document.addEventListener('input', (e) => {
  updateLastFocusedEditor(e.target);
  schedulePromptScan(100);
}, true);

document.addEventListener('keyup', (e) => {
  updateLastFocusedEditor(e.target);
  schedulePromptScan(120);
}, true);

document.addEventListener('paste', (e) => {
  updateLastFocusedEditor(e.target);
  schedulePromptScan(50);
}, true);

// Fast-path repositioning on scroll across all in-page containers
document.addEventListener('scroll', () => {
  annotator.reposition();
}, { passive: true, capture: true });

// 9. Send Gatekeeper Interceptor
// Intercepts Enter key and Send button clicks when unreviewed warnings exist
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.isComposing) {
      const unreviewed = annotator.getUnreviewedSecrets();
      if (unreviewed.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        lastAttemptedSendButton = null;
        gatekeeper.show(unreviewed);
      }
    }
  },
  true
);

// Intercept clicks on send buttons
document.addEventListener(
  'click',
  (e) => {
    const target = e.target as Element | null;
    if (!target) return;

    if (
      target.closest('#aegis-inline-annotations-root') ||
      target.closest('#aegis-gatekeeper-root')
    ) {
      return;
    }

    const sendBtn = target.closest<HTMLElement>(
      'button[aria-label*="send" i], button[aria-label*="Submit" i], button.send-button, button.send-btn, [data-testid="send-button"], fieldset button[type="submit"], send-button button, [id*="send" i]'
    ) || (target.tagName === 'BUTTON' && /send|submit/i.test((target as HTMLElement).textContent || '') ? (target as HTMLElement) : null);

    if (sendBtn) {
      const unreviewed = annotator.getUnreviewedSecrets();
      if (unreviewed.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        lastAttemptedSendButton = sendBtn;
        gatekeeper.show(unreviewed);
      }
    }
  },
  true
);

// Periodic light poll to detect when editor changes via navigation or refocus
setInterval(() => {
  const inputEl = resolveActiveEditor();
  if (inputEl) {
    annotator.setTargetEditor(inputEl);
  }
}, 1200);

function notifyBackground(entityTypes: string[]): void {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'AEGIS_SECRETS_REDACTED',
        count: entityTypes.length,
        platform: adapter.name,
        entityTypes,
        sessionId: SESSION_ID,
      });
    }
  } catch {
    // Background worker may be cycling
  }
}
