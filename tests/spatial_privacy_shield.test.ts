/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SpatialPrivacyShield,
  DetectedSecretItem,
} from '../src/extension/ui/spatial_privacy_shield.js';

describe('SpatialPrivacyShield Component', () => {
  let shield: SpatialPrivacyShield;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    shield?.unmount();
    document.body.innerHTML = '';
  });

  it('mounts inside Shadow DOM (#aegis-privacy-root) and provides style isolation', () => {
    shield = new SpatialPrivacyShield();
    shield.mount();

    const host = document.getElementById('aegis-privacy-root');
    expect(host).not.toBeNull();
    expect(shield.getHostElement()).toBe(host);

    const shadow = shield.getShadowRoot();
    expect(shadow).not.toBeNull();

    // Verify host page cannot query internal classes directly
    expect(document.querySelector('.aegis-pill')).toBeNull();

    // Verify elements are present inside shadow root
    const pill = shadow?.getElementById('aegis-pill');
    expect(pill).not.toBeNull();
    expect(shadow?.getElementById('aegis-card')).not.toBeNull();

    // Verify styles are injected inside shadow root
    const styleEl = shadow?.querySelector('style');
    expect(styleEl).not.toBeNull();
    expect(styleEl?.textContent).toContain('backdrop-filter: blur(16px)');
    expect(styleEl?.textContent).toContain('rgba(11, 19, 43, 0.85)');
    expect(styleEl?.textContent).toContain('#ff6b6b');
  });

  it('thoroughly cleans up DOM elements on unmount()', () => {
    shield = new SpatialPrivacyShield();
    shield.mount();

    expect(document.getElementById('aegis-privacy-root')).not.toBeNull();
    shield.unmount();
    expect(document.getElementById('aegis-privacy-root')).toBeNull();
    expect(shield.getShadowRoot()).toBeNull();
    expect(shield.getHostElement()).toBeNull();
  });

  it('renders quiet state when 0 secrets detected ("Shield Active")', () => {
    shield = new SpatialPrivacyShield();
    shield.mount();

    const shadow = shield.getShadowRoot()!;
    const pill = shadow.getElementById('aegis-pill')!;
    const pillText = shadow.getElementById('aegis-pill-text')!;
    const cardBody = shadow.getElementById('aegis-card-body')!;

    expect(pill.classList.contains('aegis-pill-quiet')).toBe(true);
    expect(pillText.textContent).toBe('Shield Active');
    expect(cardBody.textContent).toContain('All Clear');
  });

  it('renders warning pulse and badge count when secrets are detected', () => {
    shield = new SpatialPrivacyShield();
    shield.mount();

    const secrets: DetectedSecretItem[] = [
      {
        type: 'OPENAI_API_KEY',
        raw: 'sk-proj-1234567890abcdef12345678',
        placeholder: '[OPENAI_API_KEY_1]',
      },
    ];

    shield.updateSecrets(secrets);

    const shadow = shield.getShadowRoot()!;
    const pill = shadow.getElementById('aegis-pill')!;
    const pillText = shadow.getElementById('aegis-pill-text')!;
    const badge = shadow.getElementById('aegis-pill-badge')!;

    expect(pill.classList.contains('aegis-pill-active')).toBe(true);
    expect(pillText.textContent).toBe('1 Secret Detected');
    expect(badge.textContent).toBe('1');
    expect(badge.style.display).not.toBe('none');

    // Update with multiple secrets
    const multipleSecrets: DetectedSecretItem[] = [
      ...secrets,
      {
        type: 'GENERIC_API_KEY',
        raw: 'LUCIDITY_API_KEY_987654321',
        placeholder: '[GENERIC_API_KEY_1]',
      },
      {
        type: 'EMAIL',
        raw: 'alice@company.com',
        placeholder: '[EMAIL_1]',
      },
    ];

    shield.updateSecrets(multipleSecrets);
    expect(pillText.textContent).toBe('3 Secrets Detected');
    expect(badge.textContent).toBe('3');
  });

  it('renders type badge, masked preview (e.g. LUCIDITY_API_...), and risk indicators', () => {
    shield = new SpatialPrivacyShield();
    shield.mount();

    const secrets: DetectedSecretItem[] = [
      {
        type: 'GENERIC_API_KEY',
        raw: 'LUCIDITY_API_KEY_9876543210',
        placeholder: '[GENERIC_API_KEY_1]',
      },
      {
        type: 'EMAIL',
        raw: 'developer@example.com',
        placeholder: '[EMAIL_1]',
      },
    ];

    shield.updateSecrets(secrets);

    const shadow = shield.getShadowRoot()!;
    const cardBody = shadow.getElementById('aegis-card-body')!;

    // Type Badges
    expect(cardBody.textContent).toContain('Generic API Key');
    expect(cardBody.textContent).toContain('Email Address');

    // Risk indicators
    expect(cardBody.innerHTML).toContain('aegis-risk-high');
    expect(cardBody.innerHTML).toContain('High Risk');
    expect(cardBody.innerHTML).toContain('aegis-risk-medium');
    expect(cardBody.innerHTML).toContain('Medium Risk');

    // Masked Previews
    expect(cardBody.textContent).toContain('LUCIDITY_API_...');
    expect(cardBody.textContent).toContain('de***@example.com');

    // Placeholders
    expect(cardBody.textContent).toContain('[GENERIC_API_KEY_1]');
    expect(cardBody.textContent).toContain('[EMAIL_1]');
  });

  it('fires onRedact callback when user clicks [🔒 Redact]', () => {
    const onRedact = vi.fn();
    shield = new SpatialPrivacyShield({ onRedact });
    shield.mount();

    const secret: DetectedSecretItem = {
      type: 'OPENAI_API_KEY',
      raw: 'sk-proj-abc123456789xyz',
      placeholder: '[OPENAI_API_KEY_1]',
    };

    shield.updateSecrets([secret]);

    const shadow = shield.getShadowRoot()!;
    const redactBtn = shadow.querySelector('button.aegis-btn-redact') as HTMLButtonElement;
    expect(redactBtn).not.toBeNull();

    redactBtn.click();
    expect(onRedact).toHaveBeenCalledTimes(1);
    expect(onRedact).toHaveBeenCalledWith(secret);
  });

  it('fires onAllow callback when user clicks [✕ Leave as is]', () => {
    const onAllow = vi.fn();
    shield = new SpatialPrivacyShield({ onAllow });
    shield.mount();

    const secret: DetectedSecretItem = {
      type: 'OPENAI_API_KEY',
      raw: 'sk-proj-abc123456789xyz',
      placeholder: '[OPENAI_API_KEY_1]',
    };

    shield.updateSecrets([secret]);

    const shadow = shield.getShadowRoot()!;
    const allowBtn = shadow.querySelector('button.aegis-btn-allow') as HTMLButtonElement;
    expect(allowBtn).not.toBeNull();

    allowBtn.click();
    expect(onAllow).toHaveBeenCalledTimes(1);
    expect(onAllow).toHaveBeenCalledWith('sk-proj-abc123456789xyz');
  });

  it('displays "✓ Allowed" badge and [🔒 Re-lock] for allowed secrets', () => {
    const onRedact = vi.fn();
    shield = new SpatialPrivacyShield({ onRedact });
    shield.mount();

    const secret: DetectedSecretItem = {
      type: 'OPENAI_API_KEY',
      raw: 'sk-proj-abc123456789xyz',
      placeholder: '[OPENAI_API_KEY_1]',
    };

    const allowedSet = new Set(['sk-proj-abc123456789xyz']);
    shield.updateSecrets([secret], allowedSet);

    const shadow = shield.getShadowRoot()!;
    expect(shadow.querySelector('.aegis-badge-allowed')).not.toBeNull();
    expect(shadow.querySelector('.aegis-badge-allowed')?.textContent).toBe('✓ Allowed');

    const relockBtn = shadow.querySelector('button.aegis-btn-relock') as HTMLButtonElement;
    expect(relockBtn).not.toBeNull();

    relockBtn.click();
    expect(onRedact).toHaveBeenCalledWith(secret);
  });

  it('shows and handles [🔒 Redact All] when multiple unallowed secrets exist', () => {
    const onRedactAll = vi.fn();
    shield = new SpatialPrivacyShield({ onRedactAll });
    shield.mount();

    const secrets: DetectedSecretItem[] = [
      { type: 'OPENAI_API_KEY', raw: 'sk-1', placeholder: '[OPENAI_API_KEY_1]' },
      { type: 'ANTHROPIC_API_KEY', raw: 'sk-ant-2', placeholder: '[ANTHROPIC_API_KEY_1]' },
    ];

    shield.updateSecrets(secrets);

    const shadow = shield.getShadowRoot()!;
    const redactAllBtn = shadow.getElementById('aegis-btn-redact-all') as HTMLButtonElement;
    expect(redactAllBtn.style.display).not.toBe('none');

    redactAllBtn.click();
    expect(onRedactAll).toHaveBeenCalledTimes(1);
  });

  it('toggles review card open and closed on pill click and close button', () => {
    shield = new SpatialPrivacyShield();
    shield.mount();

    expect(shield.isCardOpen()).toBe(false);

    const shadow = shield.getShadowRoot()!;
    const pill = shadow.getElementById('aegis-pill')!;
    const closeBtn = shadow.getElementById('aegis-btn-close')!;
    const card = shadow.getElementById('aegis-card')!;

    // Click pill to open
    pill.click();
    expect(shield.isCardOpen()).toBe(true);
    expect(card.classList.contains('aegis-card-hidden')).toBe(false);

    // Click close button to close
    closeBtn.click();
    expect(shield.isCardOpen()).toBe(false);
    expect(card.classList.contains('aegis-card-hidden')).toBe(true);

    // Toggle card directly
    shield.toggleCard();
    expect(shield.isCardOpen()).toBe(true);
    expect(shield.isCardPinned()).toBe(true);
    shield.toggleCard();
    expect(shield.isCardOpen()).toBe(false);
    expect(shield.isCardPinned()).toBe(false);
  });

  it('keeps review card open on mouseleave to prevent premature collapse', () => {
    shield = new SpatialPrivacyShield();
    shield.mount();

    shield.openCard();
    expect(shield.isCardOpen()).toBe(true);

    const shadow = shield.getShadowRoot()!;
    const pill = shadow.getElementById('aegis-pill')!;
    const card = shadow.getElementById('aegis-card')!;

    // Dispatch mouseleave on pill and card
    pill.dispatchEvent(new MouseEvent('mouseleave'));
    expect(shield.isCardOpen()).toBe(true);

    card.dispatchEvent(new MouseEvent('mouseleave'));
    expect(shield.isCardOpen()).toBe(true);
  });

  it('positions floating pill near target input element when provided', () => {
    const inputContainer = document.createElement('div');
    inputContainer.id = 'chat-input-box';
    document.body.appendChild(inputContainer);

    // Mock getBoundingClientRect
    vi.spyOn(inputContainer, 'getBoundingClientRect').mockReturnValue({
      top: 500,
      bottom: 560,
      left: 100,
      right: 800,
      width: 700,
      height: 60,
      x: 100,
      y: 500,
      toJSON: () => {},
    });

    shield = new SpatialPrivacyShield();
    shield.mount();
    shield.setTargetInputElement(inputContainer);

    const shadow = shield.getShadowRoot()!;
    const wrapper = shadow.getElementById('aegis-wrapper')!;
    expect(wrapper.style.right).toBeTruthy();
    expect(wrapper.style.bottom).toBeTruthy();
  });
});
