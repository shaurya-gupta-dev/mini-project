/**
 * Inline Secret Annotator
 *
 * Renders individual inline visual indicators for ALL flagged sensitive items simultaneously:
 * 1. Wavy red underline highlight directly over every harmful item in the editor.
 * 2. Independent warning badge directly above every flagged secret.
 * 3. Informative hover tooltip displaying security advice (no buttons).
 * 4. Non-destructive overlay positioning via DOM Range bounding rectangles,
 *    ensuring zero corruption to ProseMirror or Quill editor document state.
 */

import { findAllTextNodeSpans, MatchedSpan } from '../adapters/editor_replacer.js';

export interface DetectedSecretItem {
  type: string;
  raw: string;
  placeholder?: string;
  startIndex?: number;
  endIndex?: number;
}

function formatSecretType(type: string): string {
  switch (type) {
    case 'OPENAI_API_KEY':
      return 'OpenAI Key';
    case 'ANTHROPIC_API_KEY':
      return 'Anthropic Key';
    case 'AWS_ACCESS_KEY':
      return 'AWS Key';
    case 'AWS_SECRET_KEY':
      return 'AWS Secret';
    case 'GOOGLE_API_KEY':
      return 'Gemini Key';
    case 'GITHUB_TOKEN':
      return 'GitHub Token';
    case 'GITLAB_TOKEN':
      return 'GitLab Token';
    case 'HUGGINGFACE_TOKEN':
      return 'HuggingFace Token';
    case 'STRIPE_KEY':
      return 'Stripe Key';
    case 'SLACK_TOKEN':
      return 'Slack Token';
    case 'CREDIT_CARD':
      return 'Credit Card';
    case 'EMAIL':
      return 'Email';
    case 'SSN':
      return 'SSN';
    case 'PHONE_NUMBER':
      return 'Phone';
    case 'HIGH_ENTROPY_SECRET':
      return 'Secret';
    case 'GENERIC_API_KEY':
      return 'API Key';
    case 'JWT_TOKEN':
      return 'JWT Token';
    case 'PASSWORD':
      return 'Password';
    case 'PRIVATE_KEY':
      return 'Private Key';
    case 'DATABASE_URL':
      return 'Database URL';
    case 'IPV4':
      return 'IP Address';
    default:
      return type.replace(/_/g, ' ');
  }
}

export interface VisibleClipRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

/**
 * Computes the visible clipping rectangle for an editor element,
 * taking into account all scrollable or clipping ancestors (overflow: auto|scroll|hidden|clip)
 * as well as the editor's own borders and client dimensions.
 */
export function getVisibleClipRect(editor: HTMLElement): VisibleClipRect | null {
  const rect = editor.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return null;
  }

  let clipTop = rect.top;
  let clipBottom = rect.bottom;
  let clipLeft = rect.left;
  let clipRight = rect.right;

  // Walk up ancestors to find any scrolling or clipping container
  let current: HTMLElement | null = editor.parentElement;
  while (current && current !== document.body && current !== document.documentElement) {
    try {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY || style.overflow;
      const overflowX = style.overflowX || style.overflow;

      if (
        /^(auto|scroll|hidden|clip)$/.test(overflowY) ||
        /^(auto|scroll|hidden|clip)$/.test(overflowX)
      ) {
        const pRect = current.getBoundingClientRect();
        if (pRect.width > 0 || pRect.height > 0) {
          clipTop = Math.max(clipTop, pRect.top);
          clipBottom = Math.min(clipBottom, pRect.bottom);
          clipLeft = Math.max(clipLeft, pRect.left);
          clipRight = Math.min(clipRight, pRect.right);
        }
      }
    } catch {
      // Ignore in mock environments
    }
    current = current.parentElement;
  }

  // Factor in editor's client padding and borders if client dimensions are non-zero
  if (editor.clientHeight > 0) {
    const clientTop = rect.top + (editor.clientTop || 0);
    const clientBottom = clientTop + editor.clientHeight;
    clipTop = Math.max(clipTop, clientTop);
    clipBottom = Math.min(clipBottom, clientBottom);
  }

  if (editor.clientWidth > 0) {
    const clientLeft = rect.left + (editor.clientLeft || 0);
    const clientRight = clientLeft + editor.clientWidth;
    clipLeft = Math.max(clipLeft, clientLeft);
    clipRight = Math.min(clipRight, clientRight);
  }

  if (clipTop >= clipBottom || clipLeft >= clipRight) {
    return null;
  }

  return {
    top: clipTop,
    bottom: clipBottom,
    left: clipLeft,
    right: clipRight,
    width: clipRight - clipLeft,
    height: clipBottom - clipTop,
  };
}

export class InlineSecretAnnotator {
  private hostContainer: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private overlayLayer: HTMLElement | null = null;

  private currentEditor: HTMLElement | null = null;
  private currentItems: DetectedSecretItem[] = [];
  private allowedSecrets: Set<string> = new Set();

  private repositionListener: (() => void) | null = null;
  private attachedScrollTargets: (HTMLElement | Window | Document)[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private isMounted = false;

  constructor() {}

  public mount(): void {
    if (this.isMounted && this.hostContainer && this.hostContainer.isConnected) {
      return;
    }

    // Create or locate top-level host container
    let host = document.getElementById('aegis-inline-annotations-root') as HTMLElement | null;
    if (!host) {
      host = document.createElement('div');
      host.id = 'aegis-inline-annotations-root';
      host.style.position = 'absolute';
      host.style.top = '0';
      host.style.left = '0';
      host.style.width = '100%';
      host.style.height = '100%';
      host.style.pointerEvents = 'none';
      host.style.zIndex = '2147483640';
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
        .aegis-overlay-layer {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
        }
        .aegis-annotation-unit {
          position: absolute;
          pointer-events: none;
        }
        .aegis-secret-underline {
          position: absolute;
          border-bottom: 2px wavy #ff6b5b;
          background: rgba(255, 107, 91, 0.12);
          border-radius: 2px;
          pointer-events: none;
          box-sizing: border-box;
        }
        .aegis-warning-badge {
          position: absolute;
          pointer-events: auto;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 11px;
          font-weight: 600;
          color: #dc2626;
          white-space: nowrap;
          cursor: pointer;
          user-select: none;
          z-index: 2147483642;
          background: transparent;
          padding: 1px 0;
        }
        .aegis-warning-label {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          color: #dc2626;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
        }
        .aegis-warning-tooltip {
          display: none;
          position: absolute;
          bottom: calc(100% + 4px);
          left: 0;
          background: #14213d;
          color: #f4ede0;
          border: 1px solid rgba(255, 107, 91, 0.4);
          border-radius: 6px;
          padding: 8px 12px;
          font-size: 11px;
          font-weight: 400;
          line-height: 1.45;
          white-space: normal;
          width: 250px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
          pointer-events: none;
          z-index: 2147483644;
          backdrop-filter: blur(12px);
        }
        .aegis-warning-tooltip strong {
          color: #ff6b5b;
          display: block;
          margin-bottom: 3px;
          font-weight: 700;
        }
        .aegis-warning-badge:hover .aegis-warning-tooltip {
          display: block;
        }
      </style>
      <div class="aegis-overlay-layer"></div>
    `;

    this.overlayLayer = this.shadowRoot.querySelector('.aegis-overlay-layer');

    // Attach global scroll and resize listeners
    this.repositionListener = () => {
      this.reposition();
    };
    window.addEventListener('scroll', this.repositionListener, { passive: true, capture: true });
    window.addEventListener('resize', this.repositionListener, { passive: true });

    this.isMounted = true;
  }

  public unmount(): void {
    this.detachScrollListeners();

    if (this.repositionListener) {
      window.removeEventListener('scroll', this.repositionListener, true);
      window.removeEventListener('resize', this.repositionListener);
      this.repositionListener = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.hostContainer && this.hostContainer.parentNode) {
      this.hostContainer.parentNode.removeChild(this.hostContainer);
    }

    this.hostContainer = null;
    this.shadowRoot = null;
    this.overlayLayer = null;
    this.currentEditor = null;
    this.isMounted = false;
  }

  private detachScrollListeners(): void {
    if (this.repositionListener) {
      for (const target of this.attachedScrollTargets) {
        try {
          target.removeEventListener('scroll', this.repositionListener as EventListener, true);
          target.removeEventListener('scroll', this.repositionListener as EventListener, false);
        } catch {
          // Ignore
        }
      }
    }
    this.attachedScrollTargets = [];
  }

  private attachScrollListeners(editor: HTMLElement): void {
    this.detachScrollListeners();
    if (!this.repositionListener) return;

    const targets: (HTMLElement | Window | Document)[] = [editor, window, document];
    let parent = editor.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      targets.push(parent);
      parent = parent.parentElement;
    }

    for (const target of targets) {
      try {
        target.addEventListener('scroll', this.repositionListener as EventListener, {
          passive: true,
          capture: true,
        });
        this.attachedScrollTargets.push(target);
      } catch {
        // Ignore
      }
    }

    // Attach ResizeObserver if available
    try {
      if (typeof ResizeObserver !== 'undefined') {
        if (!this.resizeObserver) {
          this.resizeObserver = new ResizeObserver(() => {
            this.reposition();
          });
        }
        this.resizeObserver.observe(editor);
        if (editor.parentElement) {
          this.resizeObserver.observe(editor.parentElement);
        }
      }
    } catch {
      // Ignore
    }
  }

  public setTargetEditor(editor: HTMLElement | null): void {
    if (this.currentEditor !== editor) {
      this.currentEditor = editor;
      if (editor) {
        this.attachScrollListeners(editor);
      } else {
        this.detachScrollListeners();
      }
    }
    this.reposition();
  }

  public updateSecrets(items: DetectedSecretItem[], allowedSecrets: Set<string>): void {
    this.currentItems = items;
    this.allowedSecrets = new Set(allowedSecrets);
    this.reposition();
  }

  public getActiveAnnotationsCount(): number {
    return this.getUnreviewedSecrets().length;
  }

  public getUnreviewedSecrets(): DetectedSecretItem[] {
    return this.currentItems.filter((item) => !this.allowedSecrets.has(item.raw));
  }

  /**
   * Recomputes bounding rects for ALL unreviewed secrets and renders
   * individual underline highlights and warning badges on all of them simultaneously.
   *
   * Crucially:
   * 1. Clips coordinates to the active editor's visible bounding box across all scroll parents.
   * 2. Completely removes annotations that scroll out of view (vertically or horizontally).
   * 3. Prevents warning badges from leaking onto blank screen areas above/below the editor.
   */
  public reposition(): void {
    if (!this.overlayLayer) {
      return;
    }

    this.overlayLayer.innerHTML = '';

    if (!this.currentEditor || !this.currentEditor.isConnected) {
      return;
    }

    const unreviewed = this.getUnreviewedSecrets();
    if (unreviewed.length === 0) {
      return;
    }

    const clipRect = getVisibleClipRect(this.currentEditor);
    if (!clipRect || clipRect.width <= 0 || clipRect.height <= 0) {
      return;
    }

    // Group items by raw text to map multiple occurrences accurately
    const rawToItems = new Map<string, DetectedSecretItem[]>();
    for (const item of unreviewed) {
      const list = rawToItems.get(item.raw) || [];
      list.push(item);
      rawToItems.set(item.raw, list);
    }

    const scrollX = window.pageXOffset || document.documentElement.scrollLeft || 0;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;

    for (const [rawText, items] of rawToItems.entries()) {
      const spans: MatchedSpan[] = findAllTextNodeSpans(this.currentEditor, rawText);
      if (spans.length === 0) {
        continue;
      }

      // Map each occurrence to its respective item
      for (let i = 0; i < spans.length; i++) {
        const span = spans[i]!;
        const item = items[Math.min(i, items.length - 1)]!;

        try {
          const range = document.createRange();
          range.setStart(span.startNode, span.startOffset);
          range.setEnd(span.endNode, span.endOffset);
          const rect = range.getBoundingClientRect();

          if (rect.width === 0 && rect.height === 0) {
            continue;
          }

          // 1. SCROLL BOUNDS CHECK:
          // If the text span has scrolled out above or below the visible editor box, skip it completely!
          if (rect.bottom <= clipRect.top || rect.top >= clipRect.bottom) {
            continue;
          }

          // If the text span is horizontally out of the visible editor box, skip it completely!
          if (rect.right <= clipRect.left || rect.left >= clipRect.right) {
            continue;
          }

          // Compute visible clipped coordinates so underlines never bleed outside the editor
          const visibleTop = Math.max(rect.top, clipRect.top);
          const visibleBottom = Math.min(rect.bottom, clipRect.bottom);
          const visibleHeight = Math.max(0, visibleBottom - visibleTop);

          const visibleLeft = Math.max(rect.left, clipRect.left);
          const visibleRight = Math.min(rect.right, clipRect.right);
          const visibleWidth = Math.max(0, visibleRight - visibleLeft);

          if (visibleHeight === 0 || visibleWidth === 0) {
            continue;
          }

          // Container unit for this specific secret occurrence
          const unit = document.createElement('div');
          unit.className = 'aegis-annotation-unit';

          // 1. Underline highlight directly over the visible secret text
          const underline = document.createElement('div');
          underline.className = 'aegis-secret-underline';
          underline.style.left = `${visibleLeft + scrollX}px`;
          underline.style.top = `${visibleTop + scrollY}px`;
          underline.style.width = `${visibleWidth}px`;
          underline.style.height = `${visibleHeight}px`;
          unit.appendChild(underline);

          // 2. Warning badge positioning:
          // Default: position directly above the flagged secret.
          // Fallback: If above would bleed out of the editor box, position below if it fits.
          // If neither fits inside the editor, do not render badge on blank screen.
          const badgeHeight = 18;
          const badgeTopAbove = rect.top - badgeHeight;
          const fitsAbove = badgeTopAbove >= clipRect.top;

          const badgeTopBelow = rect.bottom + 2;
          const fitsBelow = badgeTopBelow + badgeHeight <= clipRect.bottom;

          let finalBadgeTop: number | null = null;
          if (fitsAbove) {
            finalBadgeTop = badgeTopAbove;
          } else if (fitsBelow) {
            finalBadgeTop = badgeTopBelow;
          }

          if (finalBadgeTop !== null) {
            const badge = document.createElement('div');
            badge.className = 'aegis-warning-badge';
            const badgeLeft = Math.max(clipRect.left, rect.left);
            badge.style.left = `${badgeLeft + scrollX}px`;
            badge.style.top = `${finalBadgeTop + scrollY}px`;

            // Warning Label
            const label = document.createElement('span');
            label.className = 'aegis-warning-label';
            label.textContent = `⚠️ Warning: ${formatSecretType(item.type)}`;
            badge.appendChild(label);

            // Informative Hover Tooltip (no buttons)
            const tooltip = document.createElement('div');
            tooltip.className = 'aegis-warning-tooltip';
            tooltip.innerHTML = `
              <strong>⚠️ Sensitive ${formatSecretType(item.type)} Detected</strong>
              This content may be stored or logged by the AI provider. Please edit or remove it from your prompt before submitting.
            `;
            badge.appendChild(tooltip);

            unit.appendChild(badge);
          }

          this.overlayLayer.appendChild(unit);
        } catch {
          // Skip on positioning error
        }
      }
    }
  }
}
