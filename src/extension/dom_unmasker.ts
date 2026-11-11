/**
 * Real-time DOM Unmasker
 * Uses MutationObserver to watch streaming responses from ChatGPT, Claude, and Gemini,
 * dynamically replacing placeholders with original values in the user's browser view.
 * 
 * CRITICAL INVARIANT: NEVER unmask user input fields, textareas, or contenteditable editors!
 * Placeholders MUST remain in input fields so they get dispatched to cloud LLMs.
 */

import { SessionVault } from '../vault/session_vault.js';

// Matches placeholder patterns: [OPENAI_API_KEY_1], [EMAIL_2], [HIGH_ENTROPY_SECRET_1]
const PLACEHOLDER_PATTERN = /\[(?:[A-Z0-9_]+)_[0-9]+\]/g;

export class DOMUnmasker {
  private observer: MutationObserver | null = null;
  private vault: SessionVault;
  private sessionId: string;
  private isProcessing = false;

  constructor(vault: SessionVault, sessionId: string) {
    this.vault = vault;
    this.sessionId = sessionId;
  }

  public setSessionId(newSessionId: string): void {
    this.sessionId = newSessionId;
  }

  /**
   * Checks whether a node resides inside an input element, active prompt box,
   * contenteditable editor, OR a user-authored message bubble in the chat history.
   * User messages must permanently keep their placeholders so secrets remain redacted!
   */
  public isInsideInputElement(node: Node | null): boolean {
    if (!node) return false;
    let current: Node | null = node.nodeType === 1 ? node : (node.parentElement || node.parentNode);

    while (current) {
      const el = current as any;
      const tag = (el.tagName || '').toUpperCase();
      if (
        tag === 'TEXTAREA' ||
        tag === 'INPUT' ||
        tag === 'RICH-TEXTAREA' ||
        el.isContentEditable === true ||
        (el.getAttribute && (
          el.getAttribute('contenteditable') === 'true' ||
          el.getAttribute('contenteditable') === '' ||
          el.getAttribute('contenteditable') === 'plaintext-only' ||
          el.getAttribute('role') === 'textbox'
        )) ||
        el.id === 'prompt-textarea' ||
        (el.classList && typeof el.classList.contains === 'function' && (
          el.classList.contains('ProseMirror') ||
          el.classList.contains('ql-editor')
        )) ||
        (el.hasAttribute && typeof el.hasAttribute === 'function' && el.hasAttribute('data-lexical-editor'))
      ) {
        return true;
      }

      // User-authored message bubbles in chat history (Gemini, Claude, ChatGPT)
      // These must KEEP their placeholders so the user sees that their prompt was sanitized!
      if (
        tag === 'USER-QUERY' ||
        tag === 'USER-MESSAGE' ||
        (el.getAttribute && (
          el.getAttribute('data-message-author-role') === 'user' ||
          el.getAttribute('data-author') === 'user' ||
          el.getAttribute('data-is-user') === 'true'
        )) ||
        (el.classList && typeof el.classList.contains === 'function' && (
          el.classList.contains('font-user-message') ||
          el.classList.contains('user-message') ||
          el.classList.contains('user-query-container') ||
          el.classList.contains('query-content') ||
          el.classList.contains('user-query')
        ))
      ) {
        return true;
      }

      current = current.parentElement || (current.parentNode as Node | null) || (el.host as Node | null) || null;
    }
    return false;
  }

  /**
   * Starts observing target element or document body for streaming completions.
   */
  public startObserving(targetNode: Node = document.body): void {
    if (this.observer) {
      this.stopObserving();
    }

    const doc = targetNode.ownerDocument || document;
    const ObsClass = doc?.defaultView?.MutationObserver || MutationObserver;

    this.observer = new ObsClass((mutations: MutationRecord[]) => {
      if (this.isProcessing) return;
      // High-performance short-circuit: do zero DOM traversal if no secrets have been registered yet
      if (!this.vault.hasActiveSecrets(this.sessionId)) return;

      for (const mutation of mutations) {
        if (mutation.type === 'characterData' && mutation.target.nodeType === 3) {
          this.processTextNode(mutation.target as Text);
        } else if (mutation.type === 'childList') {
          for (let i = 0; i < mutation.addedNodes.length; i++) {
            const added = mutation.addedNodes[i];
            if (added) {
              this.scanAndUnmaskSubtree(added);
            }
          }
        }
      }
    });

    this.observer.observe(targetNode, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  public stopObserving(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  /**
   * Scans a DOM subtree and unmasks all text nodes containing placeholders,
   * skipping any user input fields or editors.
   */
  public scanAndUnmaskSubtree(rootNode: Node): void {
    if (!this.vault.hasActiveSecrets(this.sessionId)) return;
    if (this.isInsideInputElement(rootNode)) return;

    if (rootNode.nodeType === 3) {
      this.processTextNode(rootNode as Text);
      return;
    }

    // Traverse all child text nodes recursively, skipping input element subtrees
    const traverse = (node: Node) => {
      if (this.isInsideInputElement(node)) return;

      if (node.nodeType === 3) {
        this.processTextNode(node as Text);
      } else {
        const children = node.childNodes;
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (child) traverse(child);
        }
      }
    };

    traverse(rootNode);
  }

  public processTextNode(node: Text): void {
    // Critical: If inside an input element or active editor, return immediately!
    if (this.isInsideInputElement(node)) return;

    if (!this.vault.hasActiveSecrets(this.sessionId)) return;

    const text = node.nodeValue;
    if (!text || !text.includes('[')) return;

    PLACEHOLDER_PATTERN.lastIndex = 0;
    if (!PLACEHOLDER_PATTERN.test(text)) return;

    const unmasked = this.vault.unmask(this.sessionId, text);
    if (unmasked !== text) {
      try {
        this.isProcessing = true;
        node.nodeValue = unmasked;
      } finally {
        this.isProcessing = false;
      }
    }
  }
}
