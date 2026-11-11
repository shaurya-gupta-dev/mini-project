/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SendGatekeeper } from '../src/extension/ui/send_gatekeeper.js';
import { DetectedSecretItem } from '../src/extension/ui/inline_secret_annotator.js';

describe('SendGatekeeper Modal Suite', () => {
  let onAllowAllMock: (secrets: DetectedSecretItem[]) => void;
  let onReviewMock: () => void;
  let gatekeeper: SendGatekeeper;

  beforeEach(() => {
    document.body.innerHTML = '';
    onAllowAllMock = vi.fn();
    onReviewMock = vi.fn();

    gatekeeper = new SendGatekeeper({
      onAllowAll: onAllowAllMock,
      onReview: onReviewMock,
    });
  });

  afterEach(() => {
    gatekeeper.unmount();
    vi.restoreAllMocks();
  });

  it('mounts into DOM with hidden backdrop', () => {
    gatekeeper.mount();
    const host = document.getElementById('aegis-gatekeeper-root');
    expect(host).not.toBeNull();
    expect(host!.shadowRoot).not.toBeNull();

    const backdrop = host!.shadowRoot!.querySelector('.aegis-backdrop');
    expect(backdrop).not.toBeNull();
    expect(backdrop!.classList.contains('aegis-visible')).toBe(false);
    expect(gatekeeper.isOpen()).toBe(false);
  });

  it('displays dialog with secrets list on show()', () => {
    const secrets: DetectedSecretItem[] = [
      {
        type: 'OPENAI_API_KEY',
        raw: 'sk-proj-1234567890abcdef',
        placeholder: '[OPENAI_API_KEY_1]',
      },
      {
        type: 'CREDIT_CARD',
        raw: '4532015112830366',
        placeholder: '[CREDIT_CARD_1]',
      },
    ];

    gatekeeper.show(secrets);
    expect(gatekeeper.isOpen()).toBe(true);

    const host = document.getElementById('aegis-gatekeeper-root');
    const backdrop = host!.shadowRoot!.querySelector('.aegis-backdrop');
    expect(backdrop!.classList.contains('aegis-visible')).toBe(true);

    const rows = host!.shadowRoot!.querySelectorAll('.aegis-secret-item');
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toContain('OPENAI API KEY');
    expect(rows[1]!.textContent).toContain('CREDIT CARD');
  });

  it('triggers onReview callback and closes modal on Review button click', () => {
    const secrets: DetectedSecretItem[] = [
      {
        type: 'OPENAI_API_KEY',
        raw: 'sk-proj-test12345',
        placeholder: '[OPENAI_API_KEY_1]',
      },
    ];

    gatekeeper.show(secrets);

    const host = document.getElementById('aegis-gatekeeper-root');
    const reviewBtn = host!.shadowRoot!.querySelector<HTMLButtonElement>('.aegis-btn-review');
    expect(reviewBtn).not.toBeNull();

    reviewBtn!.click();
    expect(onReviewMock).toHaveBeenCalledTimes(1);
    expect(gatekeeper.isOpen()).toBe(false);
  });

  it('triggers onAllowAll callback with secrets on Allow button click', () => {
    const secrets: DetectedSecretItem[] = [
      {
        type: 'ANTHROPIC_API_KEY',
        raw: 'sk-ant-testsecret99',
        placeholder: '[ANTHROPIC_API_KEY_1]',
      },
    ];

    gatekeeper.show(secrets);

    const host = document.getElementById('aegis-gatekeeper-root');
    const allowBtn = host!.shadowRoot!.querySelector<HTMLButtonElement>('.aegis-btn-allow');
    expect(allowBtn).not.toBeNull();

    allowBtn!.click();
    expect(onAllowAllMock).toHaveBeenCalledTimes(1);
    expect(onAllowAllMock).toHaveBeenCalledWith(secrets);
    expect(gatekeeper.isOpen()).toBe(false);
  });
});

