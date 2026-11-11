/**
 * Spatial UI & Glassmorphism Privacy Assistant
 * AegisLLM Interactive Shield Component mounted inside Shadow DOM (#aegis-privacy-root).
 *
 * Implements a modern frosted-glass floating assistant with a Navy, Cream, and Coral palette,
 * ambient spatial shadows, and real-time user-choice redaction controls.
 */

export interface DetectedSecretItem {
  type: string;
  raw: string;
  placeholder: string;
}

export interface SpatialPrivacyShieldOptions {
  onRedact?: (item: DetectedSecretItem) => void;
  onAllow?: (raw: string) => void;
  onRedactAll?: () => void;
  targetInputElement?: HTMLElement | null;
}

interface RiskProfile {
  label: string;
  level: 'high' | 'medium';
}

const TYPE_DISPLAY_NAMES: Record<string, string> = {
  OPENAI_API_KEY: 'OpenAI Key',
  ANTHROPIC_API_KEY: 'Anthropic Key',
  AWS_ACCESS_KEY: 'AWS Access Key',
  AWS_SECRET_KEY: 'AWS Secret Key',
  GITHUB_TOKEN: 'GitHub Token',
  GOOGLE_API_KEY: 'Google Key',
  SLACK_TOKEN: 'Slack Token',
  GENERIC_API_KEY: 'Generic API Key',
  EMAIL: 'Email Address',
  PHONE_NUMBER: 'Phone Number',
  IPV4: 'IPv4 Address',
  IPV6: 'IPv6 Address',
  SSN: 'Social Security Number',
  CREDIT_CARD: 'Credit Card',
  PASSWORD: 'Password',
  HIGH_ENTROPY_SECRET: 'High-Entropy Secret',
};

function formatTypeBadge(type: string): string {
  if (TYPE_DISPLAY_NAMES[type]) {
    return TYPE_DISPLAY_NAMES[type];
  }
  return type
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getRiskProfile(type: string): RiskProfile {
  const upper = type.toUpperCase();
  if (
    upper.includes('KEY') ||
    upper.includes('TOKEN') ||
    upper.includes('SECRET') ||
    upper.includes('PASSWORD') ||
    upper.includes('DATABASE') ||
    upper.includes('PRIVATE') ||
    upper.includes('CARD') ||
    upper.includes('SSN')
  ) {
    return { label: 'High Risk', level: 'high' };
  }
  return { label: 'Medium Risk', level: 'medium' };
}

function maskSecretPreview(raw: string): string {
  if (raw.length <= 6) {
    return '***';
  }
  if (raw.includes('@')) {
    const parts = raw.split('@');
    const user = parts[0] ?? '';
    const domain = parts[1] ?? '';
    const maskedUser = user.length > 2 ? `${user.slice(0, 2)}***` : '***';
    return `${maskedUser}@${domain}`;
  }
  // Check for semantic delimiters (e.g. LUCIDITY_API_..., sk-proj-...)
  const secondUnderscore = raw.indexOf('_', 9);
  if (secondUnderscore > 0 && secondUnderscore <= 16) {
    return `${raw.slice(0, secondUnderscore + 1)}...`;
  }
  const secondDash = raw.indexOf('-', 3);
  if (secondDash > 0 && secondDash <= 12) {
    return `${raw.slice(0, secondDash + 1)}...`;
  }
  // Default prefix truncation
  const prefixLength = Math.min(13, Math.max(4, Math.floor(raw.length * 0.45)));
  return `${raw.slice(0, prefixLength)}...`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export class SpatialPrivacyShield {
  public onRedact: ((item: DetectedSecretItem) => void) | null = null;
  public onAllow: ((raw: string) => void) | null = null;
  public onRedactAll: (() => void) | null = null;

  private hostElement: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private targetInput: HTMLElement | null = null;

  private secrets: DetectedSecretItem[] = [];
  private allowedSet: Set<string> = new Set();

  private isMounted = false;
  private isCardVisible = false;
  private isPinned = false;
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;

  // DOM node references inside Shadow Root
  private wrapperEl: HTMLElement | null = null;
  private pillBtn: HTMLButtonElement | null = null;
  private pillTextEl: HTMLElement | null = null;
  private pillIndicatorEl: HTMLElement | null = null;
  private pillBadgeEl: HTMLElement | null = null;
  private cardEl: HTMLElement | null = null;
  private cardBodyEl: HTMLElement | null = null;
  private redactAllBtn: HTMLButtonElement | null = null;
  private closeBtn: HTMLButtonElement | null = null;

  // Bound event handlers for clean unmounting
  private boundHandleOutsideClick: (e: MouseEvent) => void;
  private boundHandleWindowReposition: () => void;
  private boundPillClick: (e: MouseEvent) => void;
  private boundPillMouseEnter: () => void;
  private boundPillMouseLeave: () => void;
  private boundCardMouseEnter: () => void;
  private boundCardMouseLeave: () => void;
  private boundCloseClick: (e: MouseEvent) => void;
  private boundRedactAllClick: (e: MouseEvent) => void;
  private boundCardBodyClick: (e: MouseEvent) => void;

  constructor(options?: SpatialPrivacyShieldOptions) {
    if (options?.onRedact) this.onRedact = options.onRedact;
    if (options?.onAllow) this.onAllow = options.onAllow;
    if (options?.onRedactAll) this.onRedactAll = options.onRedactAll;
    if (options?.targetInputElement) this.targetInput = options.targetInputElement;

    this.boundHandleOutsideClick = this.handleOutsideClick.bind(this);
    this.boundHandleWindowReposition = this.repositionPill.bind(this);
    this.boundPillClick = this.handlePillClick.bind(this);
    this.boundPillMouseEnter = this.handlePillMouseEnter.bind(this);
    this.boundPillMouseLeave = this.handlePillMouseLeave.bind(this);
    this.boundCardMouseEnter = this.handleCardMouseEnter.bind(this);
    this.boundCardMouseLeave = this.handleCardMouseLeave.bind(this);
    this.boundCloseClick = this.handleCloseClick.bind(this);
    this.boundRedactAllClick = this.handleRedactAllClick.bind(this);
    this.boundCardBodyClick = this.handleCardBodyClick.bind(this);
  }

  public getShadowRoot(): ShadowRoot | null {
    return this.shadowRoot;
  }

  public getHostElement(): HTMLElement | null {
    return this.hostElement;
  }

  /**
   * Mounts the Spatial Privacy Shield into the document body inside a Shadow DOM root.
   */
  public mount(): void {
    if (this.isMounted || typeof document === 'undefined') {
      return;
    }

    let host = document.getElementById('aegis-privacy-root');
    if (!host) {
      host = document.createElement('div');
      host.id = 'aegis-privacy-root';
      document.body.appendChild(host);
    }
    this.hostElement = host;

    const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    this.shadowRoot = shadow;

    // Render CSS & HTML template into shadow root
    shadow.innerHTML = `
      <style>${this.getStyles()}</style>
      <div class="aegis-spatial-wrapper" id="aegis-wrapper">
        <!-- Review Card -->
        <div class="aegis-card aegis-card-hidden" id="aegis-card" role="dialog" aria-label="Aegis Privacy Assistant" aria-modal="false">
          <div class="aegis-card-header">
            <div class="aegis-header-title">
              <span class="aegis-header-shield">🛡️</span>
              <div class="aegis-header-text">
                <span class="aegis-title">Aegis Privacy Shield</span>
                <span class="aegis-subtitle">Spatial Client-Side Guardian</span>
              </div>
            </div>
            <div class="aegis-header-actions">
              <button class="aegis-btn-redact-all" id="aegis-btn-redact-all" type="button" style="display: none;">
                🔒 Redact All
              </button>
              <button class="aegis-btn-close" id="aegis-btn-close" type="button" aria-label="Close review card">✕</button>
            </div>
          </div>
          <div class="aegis-card-body" id="aegis-card-body"></div>
          <div class="aegis-card-footer">
            <span class="aegis-footer-pill">Ephemeral Session Vault</span>
            <span class="aegis-footer-note">Client-Side Zero Transmission</span>
          </div>
        </div>

        <!-- Floating Pill -->
        <button class="aegis-pill aegis-pill-quiet" id="aegis-pill" type="button" aria-label="Aegis Privacy Shield Status" aria-expanded="false">
          <span class="aegis-pill-indicator" id="aegis-indicator"></span>
          <span class="aegis-pill-icon">🛡️</span>
          <span class="aegis-pill-text" id="aegis-pill-text">Shield Active</span>
          <span class="aegis-pill-badge" id="aegis-pill-badge" style="display: none;">0</span>
        </button>
      </div>
    `;

    // Query node references
    this.wrapperEl = shadow.getElementById('aegis-wrapper');
    this.pillBtn = shadow.getElementById('aegis-pill') as HTMLButtonElement | null;
    this.pillTextEl = shadow.getElementById('aegis-pill-text');
    this.pillIndicatorEl = shadow.getElementById('aegis-indicator');
    this.pillBadgeEl = shadow.getElementById('aegis-pill-badge');
    this.cardEl = shadow.getElementById('aegis-card');
    this.cardBodyEl = shadow.getElementById('aegis-card-body');
    this.redactAllBtn = shadow.getElementById('aegis-btn-redact-all') as HTMLButtonElement | null;
    this.closeBtn = shadow.getElementById('aegis-btn-close') as HTMLButtonElement | null;

    // Attach listeners
    this.pillBtn?.addEventListener('click', this.boundPillClick);
    this.pillBtn?.addEventListener('mouseenter', this.boundPillMouseEnter);
    this.pillBtn?.addEventListener('mouseleave', this.boundPillMouseLeave);

    this.cardEl?.addEventListener('mouseenter', this.boundCardMouseEnter);
    this.cardEl?.addEventListener('mouseleave', this.boundCardMouseLeave);

    this.closeBtn?.addEventListener('click', this.boundCloseClick);
    this.redactAllBtn?.addEventListener('click', this.boundRedactAllClick);
    this.cardBodyEl?.addEventListener('click', this.boundCardBodyClick);

    document.addEventListener('pointerdown', this.boundHandleOutsideClick, true);
    window.addEventListener('resize', this.boundHandleWindowReposition, { passive: true });
    window.addEventListener('scroll', this.boundHandleWindowReposition, { passive: true });

    this.isMounted = true;
    this.renderState();
    this.repositionPill();
  }

  /**
   * Unmounts the component and thoroughly cleans up all listeners and DOM references.
   */
  public unmount(): void {
    if (!this.isMounted) {
      return;
    }

    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }

    // Detach document & window listeners
    document.removeEventListener('pointerdown', this.boundHandleOutsideClick, true);
    window.removeEventListener('resize', this.boundHandleWindowReposition);
    window.removeEventListener('scroll', this.boundHandleWindowReposition);

    // Detach shadow listeners
    this.pillBtn?.removeEventListener('click', this.boundPillClick);
    this.pillBtn?.removeEventListener('mouseenter', this.boundPillMouseEnter);
    this.pillBtn?.removeEventListener('mouseleave', this.boundPillMouseLeave);

    this.cardEl?.removeEventListener('mouseenter', this.boundCardMouseEnter);
    this.cardEl?.removeEventListener('mouseleave', this.boundCardMouseLeave);

    this.closeBtn?.removeEventListener('click', this.boundCloseClick);
    this.redactAllBtn?.removeEventListener('click', this.boundRedactAllClick);
    this.cardBodyEl?.removeEventListener('click', this.boundCardBodyClick);

    // Remove host element from DOM
    if (this.hostElement && this.hostElement.parentNode) {
      this.hostElement.parentNode.removeChild(this.hostElement);
    }

    this.hostElement = null;
    this.shadowRoot = null;
    this.wrapperEl = null;
    this.pillBtn = null;
    this.pillTextEl = null;
    this.pillIndicatorEl = null;
    this.pillBadgeEl = null;
    this.cardEl = null;
    this.cardBodyEl = null;
    this.redactAllBtn = null;
    this.closeBtn = null;

    this.isMounted = false;
    this.isCardVisible = false;
    this.isPinned = false;
  }

  /**
   * Updates detected secrets and re-renders the floating pill and review card.
   */
  public updateSecrets(
    secrets: Array<{ type: string; raw: string; placeholder: string }>,
    allowedSet?: Set<string>
  ): void {
    this.secrets = [...secrets];
    this.allowedSet = allowedSet ? new Set(allowedSet) : new Set();
    this.renderState();
  }

  /**
   * Associates a specific prompt input container to dock the floating pill next to.
   */
  public setTargetInputElement(el: HTMLElement | null): void {
    this.targetInput = el;
    this.repositionPill();
  }

  public isCardOpen(): boolean {
    return this.isCardVisible;
  }

  public isCardPinned(): boolean {
    return this.isPinned;
  }

  public openCard(): void {
    if (!this.cardEl) return;
    this.isCardVisible = true;
    this.cardEl.classList.remove('aegis-card-hidden');
    this.pillBtn?.setAttribute('aria-expanded', 'true');
  }

  public closeCard(): void {
    if (!this.cardEl) return;
    this.isCardVisible = false;
    this.isPinned = false;
    this.cardEl.classList.add('aegis-card-hidden');
    this.pillBtn?.setAttribute('aria-expanded', 'false');
  }

  public toggleCard(): void {
    if (this.isCardVisible) {
      this.closeCard();
    } else {
      this.isPinned = true;
      this.openCard();
    }
  }

  // ---------------------------------------------------------------------------
  // Internal Event Handlers
  // ---------------------------------------------------------------------------

  private handlePillClick(e: MouseEvent): void {
    e.stopPropagation();
    this.toggleCard();
  }

  private handlePillMouseEnter(): void {
    if (!this.isCardVisible) {
      this.openCard();
    }
  }

  private handlePillMouseLeave(): void {
    // Intentionally keep card open so the user can freely move mouse to click
    // [🔒 Redact] or [✕ Leave as is] without premature hover-collapse.
  }

  private handleCardMouseEnter(): void {
    // Stable card hover
  }

  private handleCardMouseLeave(): void {
    // Intentionally keep card open until user clicks outside or clicks [✕]
  }

  private handleCloseClick(e: MouseEvent): void {
    e.stopPropagation();
    this.closeCard();
  }

  private handleRedactAllClick(e: MouseEvent): void {
    e.stopPropagation();
    e.preventDefault();
    if (this.onRedactAll) {
      this.onRedactAll();
    }
  }

  private handleCardBodyClick(e: MouseEvent): void {
    e.stopPropagation();
    e.preventDefault();
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const actionBtn = target.closest('button[data-action]') as HTMLButtonElement | null;
    if (!actionBtn) return;

    const action = actionBtn.getAttribute('data-action');
    const indexStr = actionBtn.getAttribute('data-index');
    if (indexStr === null) return;

    const index = parseInt(indexStr, 10);
    const item = this.secrets[index];
    if (!item) return;

    if (action === 'redact') {
      if (this.onRedact) {
        this.onRedact(item);
      }
    } else if (action === 'allow') {
      if (this.onAllow) {
        this.onAllow(item.raw);
      }
    }
  }

  private handleOutsideClick(e: MouseEvent): void {
    if (!this.isCardVisible) return;
    const path = e.composedPath();
    if (this.hostElement && path.includes(this.hostElement)) {
      return;
    }
    this.closeCard();
  }

  /**
   * Repositions the floating pill relative to the chat input element or viewport corner.
   */
  private repositionPill(): void {
    if (!this.wrapperEl || typeof window === 'undefined') return;

    if (this.targetInput && document.body.contains(this.targetInput)) {
      const rect = this.targetInput.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const rightOffset = Math.max(16, window.innerWidth - rect.right + 12);
        const bottomOffset = Math.max(16, window.innerHeight - rect.bottom + 12);
        this.wrapperEl.style.right = `${rightOffset}px`;
        this.wrapperEl.style.bottom = `${bottomOffset}px`;
        return;
      }
    }

    // Default viewport dock: bottom-right corner
    this.wrapperEl.style.right = '24px';
    this.wrapperEl.style.bottom = '24px';
  }

  /**
   * Synchronizes UI state with the current secrets and allowed set.
   */
  private renderState(): void {
    if (!this.isMounted) return;

    const count = this.secrets.length;
    const unallowedCount = this.secrets.filter((s) => !this.allowedSet.has(s.raw)).length;

    // 1. Update Floating Pill
    if (this.pillBtn && this.pillTextEl && this.pillIndicatorEl && this.pillBadgeEl) {
      if (count === 0) {
        this.pillBtn.className = 'aegis-pill aegis-pill-quiet';
        this.pillTextEl.textContent = 'Shield Active';
        this.pillBadgeEl.style.display = 'none';
      } else {
        this.pillBtn.className = 'aegis-pill aegis-pill-active';
        this.pillTextEl.textContent =
          count === 1 ? '1 Secret Detected' : `${count} Secrets Detected`;
        this.pillBadgeEl.textContent = String(count);
        this.pillBadgeEl.style.display = 'inline-block';
      }
    }

    // 2. Update Redact All Header Button
    if (this.redactAllBtn) {
      if (unallowedCount > 1) {
        this.redactAllBtn.style.display = 'inline-flex';
      } else {
        this.redactAllBtn.style.display = 'none';
      }
    }

    // 3. Update Review Card Body
    if (this.cardBodyEl) {
      if (count === 0) {
        this.cardBodyEl.innerHTML = `
          <div class="aegis-empty-state">
            <div class="aegis-empty-icon">🛡️</div>
            <div class="aegis-empty-title">All Clear</div>
            <div class="aegis-empty-desc">No sensitive credentials or private tokens detected in prompt.</div>
          </div>
        `;
        return;
      }

      const itemsHtml = this.secrets
        .map((secret, index) => {
          const isAllowed = this.allowedSet.has(secret.raw);
          const risk = getRiskProfile(secret.type);
          const typeBadge = formatTypeBadge(secret.type);
          const masked = maskSecretPreview(secret.raw);

          const actionHtml = isAllowed
            ? `
              <div class="aegis-item-actions">
                <span class="aegis-badge-allowed">✓ Allowed</span>
                <button class="aegis-btn-action aegis-btn-relock" type="button" data-action="redact" data-index="${index}" title="Revoke allowance and redact secret">
                  🔒 Re-lock
                </button>
              </div>
            `
            : `
              <div class="aegis-item-actions">
                <button class="aegis-btn-action aegis-btn-redact" type="button" data-action="redact" data-index="${index}" title="Replace with deterministic placeholder">
                  🔒 Redact
                </button>
                <button class="aegis-btn-action aegis-btn-allow" type="button" data-action="allow" data-index="${index}" title="Transmit raw secret without redaction">
                  ✕ Leave as is
                </button>
              </div>
            `;

          return `
            <div class="aegis-secret-card ${isAllowed ? 'aegis-card-allowed' : ''}">
              <div class="aegis-secret-header">
                <span class="aegis-type-badge">${escapeHtml(typeBadge)}</span>
                <span class="aegis-risk-badge aegis-risk-${risk.level}">${risk.label}</span>
              </div>
              <div class="aegis-secret-preview-row">
                <code class="aegis-secret-code" title="${escapeHtml(masked)}">${escapeHtml(masked)}</code>
                <span class="aegis-placeholder-tag" title="Vault Replacement Token">${escapeHtml(secret.placeholder)}</span>
              </div>
              ${actionHtml}
            </div>
          `;
        })
        .join('');

      this.cardBodyEl.innerHTML = `
        <div class="aegis-secrets-list">
          ${itemsHtml}
        </div>
      `;
    }
  }

  /**
   * Self-contained Spatial & Glassmorphic CSS stylesheet.
   */
  private getStyles(): string {
    return `
      :host {
        all: initial;
        position: fixed;
        z-index: 2147483647;
        pointer-events: none;
      }

      *, *::before, *::after {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      .aegis-spatial-wrapper {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        pointer-events: auto;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        color: #fdfaf6;
      }

      /* ----------------------------------------------------------------------- */
      /* Floating Pill (Glassmorphic Button)                                     */
      /* ----------------------------------------------------------------------- */
      .aegis-pill {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        border-radius: 9999px;
        cursor: pointer;
        user-select: none;
        outline: none;
        font-family: inherit;
        font-size: 13px;
        font-weight: 500;
        color: #fdfaf6;
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        background: rgba(11, 19, 43, 0.85);
        border: 1px solid rgba(253, 250, 246, 0.14);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(255, 107, 107, 0.15);
        transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
                    background-color 0.2s ease,
                    box-shadow 0.2s ease,
                    border-color 0.2s ease;
      }

      .aegis-pill:hover {
        transform: translateY(-2px);
        background: rgba(17, 28, 60, 0.92);
        border-color: rgba(253, 250, 246, 0.25);
        box-shadow: 0 16px 36px rgba(0, 0, 0, 0.42), 0 4px 12px rgba(255, 107, 107, 0.22);
      }

      .aegis-pill:active {
        transform: translateY(0);
      }

      .aegis-pill-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        display: inline-block;
        flex-shrink: 0;
        transition: background-color 0.3s ease, box-shadow 0.3s ease;
      }

      /* Quiet State (0 secrets) */
      .aegis-pill-quiet .aegis-pill-indicator {
        background: #10b981;
        box-shadow: 0 0 8px rgba(16, 185, 129, 0.7);
      }

      /* Detection State (1+ secrets) */
      .aegis-pill-active {
        border-color: rgba(255, 107, 107, 0.5);
        animation: aegis-coral-pulse 2s infinite cubic-bezier(0.4, 0, 0.6, 1);
      }

      .aegis-pill-active .aegis-pill-indicator {
        background: #ff6b6b;
        box-shadow: 0 0 10px rgba(255, 107, 107, 0.9);
      }

      .aegis-pill-icon {
        font-size: 14px;
        line-height: 1;
      }

      .aegis-pill-text {
        letter-spacing: 0.2px;
      }

      .aegis-pill-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: 9px;
        background: #ff6b6b;
        color: #0b132b;
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
        margin-left: 2px;
      }

      @keyframes aegis-coral-pulse {
        0%, 100% {
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35), 0 0 0 0 rgba(255, 107, 107, 0.55);
          border-color: rgba(255, 107, 107, 0.55);
        }
        50% {
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35), 0 0 0 7px rgba(255, 107, 107, 0);
          border-color: rgba(255, 107, 107, 0.25);
        }
      }

      /* ----------------------------------------------------------------------- */
      /* Spatial Review Card (Frosted Glass Panel)                               */
      /* ----------------------------------------------------------------------- */
      .aegis-card {
        position: absolute;
        bottom: calc(100% + 12px);
        right: 0;
        width: 380px;
        max-width: calc(100vw - 32px);
        max-height: 480px;
        display: flex;
        flex-direction: column;
        border-radius: 16px;
        overflow: hidden;
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        background: rgba(11, 19, 43, 0.92);
        border: 1px solid rgba(253, 250, 246, 0.15);
        box-shadow: 0 24px 48px rgba(0, 0, 0, 0.55),
                    0 0 1px 1px rgba(253, 250, 246, 0.12),
                    0 8px 24px rgba(255, 107, 107, 0.12);
        opacity: 1;
        transform: translateY(0) scale(1);
        transform-origin: bottom right;
        transition: opacity 0.24s cubic-bezier(0.16, 1, 0.3, 1),
                    transform 0.24s cubic-bezier(0.16, 1, 0.3, 1);
        pointer-events: auto;
      }

      .aegis-card.aegis-card-hidden {
        opacity: 0;
        transform: translateY(12px) scale(0.96);
        pointer-events: none;
      }

      /* Card Header */
      .aegis-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        border-bottom: 1px solid rgba(253, 250, 246, 0.1);
        background: rgba(28, 37, 65, 0.4);
      }

      .aegis-header-title {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .aegis-header-shield {
        font-size: 18px;
        line-height: 1;
      }

      .aegis-header-text {
        display: flex;
        flex-direction: column;
      }

      .aegis-title {
        font-size: 13px;
        font-weight: 600;
        color: #fdfaf6;
        letter-spacing: 0.2px;
      }

      .aegis-subtitle {
        font-size: 10px;
        font-weight: 400;
        color: rgba(253, 250, 246, 0.55);
        letter-spacing: 0.3px;
      }

      .aegis-header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .aegis-btn-redact-all {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 5px 10px;
        border-radius: 8px;
        border: none;
        outline: none;
        cursor: pointer;
        font-family: inherit;
        font-size: 11px;
        font-weight: 600;
        color: #ffffff;
        background: linear-gradient(135deg, #ff6b6b 0%, #f05d5e 100%);
        box-shadow: 0 2px 8px rgba(255, 107, 107, 0.35);
        transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
      }

      .aegis-btn-redact-all:hover {
        transform: translateY(-1px);
        filter: brightness(1.08);
        box-shadow: 0 4px 12px rgba(255, 107, 107, 0.5);
      }

      .aegis-btn-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 1px solid rgba(253, 250, 246, 0.12);
        background: rgba(253, 250, 246, 0.06);
        color: rgba(253, 250, 246, 0.7);
        font-size: 12px;
        cursor: pointer;
        outline: none;
        transition: background-color 0.15s ease, color 0.15s ease;
      }

      .aegis-btn-close:hover {
        background: rgba(253, 250, 246, 0.15);
        color: #fdfaf6;
      }

      /* Card Body & Scroll Area */
      .aegis-card-body {
        padding: 12px 14px;
        overflow-y: auto;
        max-height: 320px;
      }

      .aegis-card-body::-webkit-scrollbar {
        width: 5px;
      }

      .aegis-card-body::-webkit-scrollbar-thumb {
        background: rgba(253, 250, 246, 0.18);
        border-radius: 4px;
      }

      .aegis-card-body::-webkit-scrollbar-track {
        background: transparent;
      }

      /* Empty State */
      .aegis-empty-state {
        text-align: center;
        padding: 24px 12px;
      }

      .aegis-empty-icon {
        font-size: 28px;
        margin-bottom: 8px;
      }

      .aegis-empty-title {
        font-size: 14px;
        font-weight: 600;
        color: #fdfaf6;
        margin-bottom: 4px;
      }

      .aegis-empty-desc {
        font-size: 11px;
        color: rgba(253, 250, 246, 0.6);
        line-height: 1.4;
      }

      /* Secret Cards List */
      .aegis-secrets-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .aegis-secret-card {
        padding: 10px 12px;
        border-radius: 10px;
        background: rgba(28, 37, 65, 0.65);
        border: 1px solid rgba(253, 250, 246, 0.1);
        transition: border-color 0.2s ease, background-color 0.2s ease;
      }

      .aegis-secret-card:hover {
        background: rgba(28, 37, 65, 0.85);
        border-color: rgba(253, 250, 246, 0.2);
      }

      .aegis-secret-card.aegis-card-allowed {
        border-left: 3px solid #10b981;
      }

      .aegis-secret-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
      }

      .aegis-type-badge {
        font-size: 11px;
        font-weight: 600;
        color: #fdfaf6;
        background: rgba(253, 250, 246, 0.1);
        padding: 2px 7px;
        border-radius: 5px;
      }

      .aegis-risk-badge {
        font-size: 10px;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 5px;
        letter-spacing: 0.2px;
      }

      .aegis-risk-high {
        color: #ff6b6b;
        background: rgba(255, 107, 107, 0.16);
        border: 1px solid rgba(255, 107, 107, 0.3);
      }

      .aegis-risk-medium {
        color: #fbbf24;
        background: rgba(245, 158, 11, 0.16);
        border: 1px solid rgba(245, 158, 11, 0.3);
      }

      .aegis-secret-preview-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 10px;
      }

      .aegis-secret-code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 12px;
        color: #fdfaf6;
        background: rgba(11, 19, 43, 0.7);
        padding: 3px 6px;
        border-radius: 4px;
        border: 1px solid rgba(253, 250, 246, 0.08);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 190px;
      }

      .aegis-placeholder-tag {
        font-size: 11px;
        color: rgba(253, 250, 246, 0.6);
        font-family: ui-monospace, SFMono-Regular, monospace;
        letter-spacing: 0.2px;
      }

      .aegis-item-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: flex-end;
      }

      .aegis-badge-allowed {
        font-size: 11px;
        font-weight: 600;
        color: #10b981;
        background: rgba(16, 185, 129, 0.15);
        border: 1px solid rgba(16, 185, 129, 0.3);
        padding: 3px 8px;
        border-radius: 6px;
      }

      .aegis-btn-action {
        font-family: inherit;
        font-size: 11px;
        font-weight: 600;
        padding: 5px 12px;
        border-radius: 7px;
        cursor: pointer;
        outline: none;
        transition: transform 0.15s ease, background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
      }

      .aegis-btn-action:hover {
        transform: translateY(-1px);
      }

      .aegis-btn-redact {
        border: none;
        color: #ffffff;
        background: linear-gradient(135deg, #ff6b6b 0%, #f05d5e 100%);
        box-shadow: 0 2px 6px rgba(255, 107, 107, 0.35);
      }

      .aegis-btn-redact:hover {
        box-shadow: 0 4px 10px rgba(255, 107, 107, 0.5);
      }

      .aegis-btn-allow {
        border: 1px solid rgba(253, 250, 246, 0.18);
        background: rgba(253, 250, 246, 0.08);
        color: #fdfaf6;
      }

      .aegis-btn-allow:hover {
        background: rgba(253, 250, 246, 0.16);
        border-color: rgba(253, 250, 246, 0.3);
      }

      .aegis-btn-relock {
        border: 1px solid rgba(255, 107, 107, 0.3);
        background: rgba(255, 107, 107, 0.12);
        color: #ff6b6b;
      }

      .aegis-btn-relock:hover {
        background: rgba(255, 107, 107, 0.22);
      }

      /* Card Footer */
      .aegis-card-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        border-top: 1px solid rgba(253, 250, 246, 0.08);
        background: rgba(11, 19, 43, 0.6);
      }

      .aegis-footer-pill {
        font-size: 10px;
        font-weight: 500;
        color: rgba(253, 250, 246, 0.55);
        background: rgba(253, 250, 246, 0.06);
        padding: 2px 6px;
        border-radius: 4px;
      }

      .aegis-footer-note {
        font-size: 10px;
        color: rgba(253, 250, 246, 0.4);
      }
    `;
  }
}
