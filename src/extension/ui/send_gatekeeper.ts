/**
 * Send Gatekeeper Modal
 *
 * Intercepts prompt submission attempts when unreviewed sensitive items remain:
 * Prompts the user: "Do you really want to allow these contents?"
 * Offers two unambiguous options:
 * 1. "Allow" - marks items as user-approved and permits submission.
 * 2. "Review" - dismisses modal and returns focus to the editor so the user can review warnings.
 */

import { DetectedSecretItem } from './inline_secret_annotator.js';

export interface SendGatekeeperOptions {
  onAllowAll: (secrets: DetectedSecretItem[]) => void;
  onReview: () => void;
}

export class SendGatekeeper {
  private hostContainer: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private modalElement: HTMLElement | null = null;
  private isVisible = false;
  private currentSecrets: DetectedSecretItem[] = [];
  private options: SendGatekeeperOptions;

  constructor(options: SendGatekeeperOptions) {
    this.options = options;
  }

  public mount(): void {
    if (this.hostContainer && this.hostContainer.isConnected) {
      return;
    }

    let host = document.getElementById('aegis-gatekeeper-root') as HTMLElement | null;
    if (!host) {
      host = document.createElement('div');
      host.id = 'aegis-gatekeeper-root';
      host.style.position = 'fixed';
      host.style.top = '0';
      host.style.left = '0';
      host.style.width = '100vw';
      host.style.height = '100vh';
      host.style.pointerEvents = 'none';
      host.style.zIndex = '2147483645';
      document.body.appendChild(host);
    }

    this.hostContainer = host;
    if (!host.shadowRoot) {
      this.shadowRoot = host.attachShadow({ mode: 'open' });
    } else {
      this.shadowRoot = host.shadowRoot;
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          all: initial;
        }
        .aegis-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(11, 19, 43, 0.45);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.18s ease;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }
        .aegis-backdrop.aegis-visible {
          opacity: 1;
          pointer-events: auto;
        }
        .aegis-modal {
          background: #ffffff;
          border-radius: 12px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.22), 0 1px 3px rgba(0, 0, 0, 0.1);
          width: 90%;
          max-width: 440px;
          padding: 24px;
          box-sizing: border-box;
          transform: scale(0.95);
          transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .aegis-backdrop.aegis-visible .aegis-modal {
          transform: scale(1);
        }
        .aegis-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
        }
        .aegis-header-icon {
          font-size: 22px;
          line-height: 1;
        }
        .aegis-title {
          font-size: 16px;
          font-weight: 700;
          color: #0f172a;
          margin: 0;
        }
        .aegis-body-text {
          font-size: 13.5px;
          color: #334155;
          line-height: 1.5;
          margin: 0 0 16px 0;
        }
        .aegis-secrets-list {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 10px 14px;
          margin-bottom: 20px;
          max-height: 120px;
          overflow-y: auto;
        }
        .aegis-secret-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 12px;
          color: #475569;
          padding: 4px 0;
          border-bottom: 1px solid #f1f5f9;
        }
        .aegis-secret-item:last-child {
          border-bottom: none;
        }
        .aegis-secret-type {
          font-weight: 600;
          color: #dc2626;
        }
        .aegis-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
        }
        .aegis-btn {
          font-family: inherit;
          font-size: 13px;
          font-weight: 600;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          border: 1px solid transparent;
          transition: all 0.15s ease;
          outline: none;
        }
        .aegis-btn-review {
          background: #f1f5f9;
          color: #334155;
          border-color: #cbd5e1;
        }
        .aegis-btn-review:hover {
          background: #e2e8f0;
          color: #0f172a;
        }
        .aegis-btn-allow {
          background: #2563eb;
          color: #ffffff;
        }
        .aegis-btn-allow:hover {
          background: #1d4ed8;
        }
      </style>
      <div class="aegis-backdrop">
        <div class="aegis-modal" role="dialog" aria-modal="true" aria-labelledby="aegis-dialog-title">
          <div class="aegis-header">
            <span class="aegis-header-icon">⚠️</span>
            <h3 class="aegis-title" id="aegis-dialog-title">Unreviewed Sensitive Content</h3>
          </div>
          <p class="aegis-body-text">
            Your prompt contains unreviewed sensitive items. Do you want to allow these contents to be submitted to the AI, or review and redact them?
          </p>
          <div class="aegis-secrets-list"></div>
          <div class="aegis-actions">
            <button class="aegis-btn aegis-btn-review" type="button">Review</button>
            <button class="aegis-btn aegis-btn-allow" type="button">Allow</button>
          </div>
        </div>
      </div>
    `;

    this.modalElement = this.shadowRoot.querySelector('.aegis-backdrop');

    const reviewBtn = this.shadowRoot.querySelector('.aegis-btn-review');
    const allowBtn = this.shadowRoot.querySelector('.aegis-btn-allow');

    reviewBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.hide();
      this.options.onReview();
    });

    allowBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const secretsToAllow = [...this.currentSecrets];
      this.hide();
      this.options.onAllowAll(secretsToAllow);
    });

    // Close on backdrop click
    this.modalElement?.addEventListener('click', (e) => {
      if (e.target === this.modalElement) {
        this.hide();
        this.options.onReview();
      }
    });
  }

  public unmount(): void {
    if (this.hostContainer && this.hostContainer.parentNode) {
      this.hostContainer.parentNode.removeChild(this.hostContainer);
    }
    this.hostContainer = null;
    this.shadowRoot = null;
    this.modalElement = null;
    this.isVisible = false;
  }

  public show(secrets: DetectedSecretItem[]): void {
    this.mount();
    this.currentSecrets = secrets;

    if (!this.shadowRoot || !this.modalElement) {
      return;
    }

    const listContainer = this.shadowRoot.querySelector('.aegis-secrets-list');
    if (listContainer) {
      listContainer.innerHTML = '';
      for (const item of secrets) {
        const row = document.createElement('div');
        row.className = 'aegis-secret-item';

        const typeSpan = document.createElement('span');
        typeSpan.className = 'aegis-secret-type';
        typeSpan.textContent = item.type.replace(/_/g, ' ');

        const previewSpan = document.createElement('span');
        const masked = item.raw.length > 8
          ? item.raw.slice(0, 4) + '...' + item.raw.slice(-4)
          : '••••••••';
        previewSpan.textContent = masked;

        row.appendChild(typeSpan);
        row.appendChild(previewSpan);
        listContainer.appendChild(row);
      }
    }

    this.modalElement.classList.add('aegis-visible');
    this.isVisible = true;

    // Focus Review button by default
    const reviewBtn = this.shadowRoot.querySelector<HTMLButtonElement>('.aegis-btn-review');
    reviewBtn?.focus();
  }

  public hide(): void {
    if (this.modalElement) {
      this.modalElement.classList.remove('aegis-visible');
    }
    this.isVisible = false;
  }

  public isOpen(): boolean {
    return this.isVisible;
  }
}

