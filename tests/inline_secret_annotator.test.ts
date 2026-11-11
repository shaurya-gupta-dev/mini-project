/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  InlineSecretAnnotator,
  DetectedSecretItem,
} from '../src/extension/ui/inline_secret_annotator.js';

describe('InlineSecretAnnotator Suite', () => {
  let annotator: InlineSecretAnnotator;

  beforeEach(() => {
    document.body.innerHTML = '';
    annotator = new InlineSecretAnnotator();
  });

  afterEach(() => {
    annotator.unmount();
    vi.restoreAllMocks();
  });

  it('mounts into the DOM with shadow root and isolated overlay layer', () => {
    annotator.mount();
    const host = document.getElementById('aegis-inline-annotations-root');
    expect(host).not.toBeNull();
    expect(host!.shadowRoot).not.toBeNull();

    const layer = host!.shadowRoot!.querySelector('.aegis-overlay-layer');
    expect(layer).not.toBeNull();
  });

  it('renders individual underline and warning badge for all unreviewed secrets simultaneously', () => {
    annotator.mount();

    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.innerHTML = '<p>Check key sk-proj-1234567890abcdef and secret ghp_998877665544</p>';
    document.body.appendChild(editor);

    vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      left: 50,
      width: 500,
      height: 60,
      bottom: 160,
      right: 550,
      x: 50,
      y: 100,
      toJSON: () => {},
    });

    vi.spyOn(document, 'createRange').mockImplementation(() => {
      return {
        setStart: vi.fn(),
        setEnd: vi.fn(),
        getBoundingClientRect: () => ({
          top: 120,
          left: 110,
          width: 140,
          height: 18,
          bottom: 138,
          right: 250,
          x: 110,
          y: 120,
          toJSON: () => {},
        }),
      } as unknown as Range;
    });

    annotator.setTargetEditor(editor);

    const items: DetectedSecretItem[] = [
      {
        type: 'OPENAI_API_KEY',
        raw: 'sk-proj-1234567890abcdef',
      },
      {
        type: 'GITHUB_TOKEN',
        raw: 'ghp_998877665544',
      },
    ];

    annotator.updateSecrets(items, new Set());

    const host = document.getElementById('aegis-inline-annotations-root');
    const units = host!.shadowRoot!.querySelectorAll('.aegis-annotation-unit');
    expect(units.length).toBe(2);

    // Verify first unit has underline, badge, and tooltip
    const firstUnit = units[0]!;
    const underline = firstUnit.querySelector('.aegis-secret-underline');
    const badge = firstUnit.querySelector('.aegis-warning-badge');
    const tooltip = firstUnit.querySelector('.aegis-warning-tooltip');
    expect(underline).not.toBeNull();
    expect(badge).not.toBeNull();
    expect(tooltip).not.toBeNull();
    expect(badge!.textContent).toContain('⚠️ Warning: OpenAI Key');
    expect(tooltip!.textContent).toContain('This content may be stored or logged by the AI provider');

    // Verify NO action buttons are present
    expect(firstUnit.querySelector('button')).toBeNull();
  });

  it('renders multiple occurrences of the same secret simultaneously', () => {
    annotator.mount();

    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.innerHTML = '<p>Key 1: cmp438078272436591415144cbd44b149a9 and Key 2: cmp438078272436591415144cbd44b149a9</p>';
    document.body.appendChild(editor);

    vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      left: 50,
      width: 500,
      height: 60,
      bottom: 160,
      right: 550,
      x: 50,
      y: 100,
      toJSON: () => {},
    });

    vi.spyOn(document, 'createRange').mockImplementation(() => {
      return {
        setStart: vi.fn(),
        setEnd: vi.fn(),
        getBoundingClientRect: () => ({
          top: 120,
          left: 110,
          width: 140,
          height: 18,
          bottom: 138,
          right: 250,
          x: 110,
          y: 120,
          toJSON: () => {},
        }),
      } as unknown as Range;
    });

    annotator.setTargetEditor(editor);

    const items: DetectedSecretItem[] = [
      {
        type: 'GENERIC_API_KEY',
        raw: 'cmp438078272436591415144cbd44b149a9',
      },
      {
        type: 'GENERIC_API_KEY',
        raw: 'cmp438078272436591415144cbd44b149a9',
      },
    ];

    annotator.updateSecrets(items, new Set());

    const host = document.getElementById('aegis-inline-annotations-root');
    const units = host!.shadowRoot!.querySelectorAll('.aegis-annotation-unit');
    // Both occurrences are found and annotated simultaneously
    expect(units.length).toBe(2);
  });

  it('filters out allowed secrets and dismisses warnings', () => {
    annotator.mount();

    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.innerHTML = '<p>sk-ant-testsecret99</p>';
    document.body.appendChild(editor);

    vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      left: 50,
      width: 300,
      height: 40,
      bottom: 140,
      right: 350,
      x: 50,
      y: 100,
      toJSON: () => {},
    });

    vi.spyOn(document, 'createRange').mockImplementation(() => {
      return {
        setStart: vi.fn(),
        setEnd: vi.fn(),
        getBoundingClientRect: () => ({
          top: 110,
          left: 60,
          width: 120,
          height: 18,
          bottom: 128,
          right: 180,
          x: 60,
          y: 110,
          toJSON: () => {},
        }),
      } as unknown as Range;
    });

    annotator.setTargetEditor(editor);

    const targetItem: DetectedSecretItem = {
      type: 'ANTHROPIC_API_KEY',
      raw: 'sk-ant-testsecret99',
    };

    annotator.updateSecrets([targetItem], new Set());
    expect(annotator.getActiveAnnotationsCount()).toBe(1);

    annotator.updateSecrets([targetItem], new Set(['sk-ant-testsecret99']));
    expect(annotator.getActiveAnnotationsCount()).toBe(0);

    const host = document.getElementById('aegis-inline-annotations-root');
    const units = host!.shadowRoot!.querySelectorAll('.aegis-annotation-unit');
    expect(units.length).toBe(0);
  });

  it('completely hides annotations when secrets scroll above visible editor boundary', () => {
    annotator.mount();

    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.innerHTML = '<p>Secret at top: sk-proj-topsecret9999</p>';
    document.body.appendChild(editor);

    // Visible editor is between top=100 and bottom=300
    vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      left: 50,
      width: 500,
      height: 200,
      bottom: 300,
      right: 550,
      x: 50,
      y: 100,
      toJSON: () => {},
    });

    // Secret range has scrolled UP out of view: rect.bottom=80 (which is <= editor.top 100)
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      return {
        setStart: vi.fn(),
        setEnd: vi.fn(),
        getBoundingClientRect: () => ({
          top: 60,
          left: 60,
          width: 140,
          height: 20,
          bottom: 80,
          right: 200,
          x: 60,
          y: 60,
          toJSON: () => {},
        }),
      } as unknown as Range;
    });

    annotator.setTargetEditor(editor);

    const targetItem: DetectedSecretItem = {
      type: 'OPENAI_API_KEY',
      raw: 'sk-proj-topsecret9999',
    };

    annotator.updateSecrets([targetItem], new Set());

    // When scrolled out of view, 0 annotation units must be rendered in DOM!
    const host = document.getElementById('aegis-inline-annotations-root');
    const units = host!.shadowRoot!.querySelectorAll('.aegis-annotation-unit');
    expect(units.length).toBe(0);
  });

  it('completely hides annotations when secrets scroll below visible editor boundary', () => {
    annotator.mount();

    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.innerHTML = '<p>Secret at bottom: AKIAIOSFODNN7EXAMPLE</p>';
    document.body.appendChild(editor);

    // Visible editor is between top=100 and bottom=300
    vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      left: 50,
      width: 500,
      height: 200,
      bottom: 300,
      right: 550,
      x: 50,
      y: 100,
      toJSON: () => {},
    });

    // Secret range has scrolled DOWN out of view: rect.top=350 (which is >= editor.bottom 300)
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      return {
        setStart: vi.fn(),
        setEnd: vi.fn(),
        getBoundingClientRect: () => ({
          top: 350,
          left: 60,
          width: 140,
          height: 20,
          bottom: 370,
          right: 200,
          x: 60,
          y: 350,
          toJSON: () => {},
        }),
      } as unknown as Range;
    });

    annotator.setTargetEditor(editor);

    const targetItem: DetectedSecretItem = {
      type: 'AWS_ACCESS_KEY',
      raw: 'AKIAIOSFODNN7EXAMPLE',
    };

    annotator.updateSecrets([targetItem], new Set());

    // When scrolled out below, 0 annotation units must be rendered in DOM!
    const host = document.getElementById('aegis-inline-annotations-root');
    const units = host!.shadowRoot!.querySelectorAll('.aegis-annotation-unit');
    expect(units.length).toBe(0);
  });

  it('clips underlines and positions badges safely without bleeding onto blank page', () => {
    annotator.mount();

    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    editor.innerHTML = '<p>Key: cmp438078272436591415144cbd44b149a9</p>';
    document.body.appendChild(editor);

    // Visible editor: top=100, bottom=300
    vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      left: 50,
      width: 500,
      height: 200,
      bottom: 300,
      right: 550,
      x: 50,
      y: 100,
      toJSON: () => {},
    });

    // Secret is near the very top of editor: top=105, bottom=125.
    // Above placement (top=105 - 18 = 87) would bleed outside top (100).
    // So badge should flip safely below the text (top=125 + 2 = 127) within the 100-300 bounds!
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      return {
        setStart: vi.fn(),
        setEnd: vi.fn(),
        getBoundingClientRect: () => ({
          top: 105,
          left: 60,
          width: 200,
          height: 20,
          bottom: 125,
          right: 260,
          x: 60,
          y: 105,
          toJSON: () => {},
        }),
      } as unknown as Range;
    });

    annotator.setTargetEditor(editor);

    const targetItem: DetectedSecretItem = {
      type: 'GENERIC_API_KEY',
      raw: 'cmp438078272436591415144cbd44b149a9',
    };

    annotator.updateSecrets([targetItem], new Set());

    const host = document.getElementById('aegis-inline-annotations-root');
    const units = host!.shadowRoot!.querySelectorAll('.aegis-annotation-unit');
    expect(units.length).toBe(1);

    const badge = units[0]!.querySelector('.aegis-warning-badge') as HTMLElement;
    expect(badge).not.toBeNull();
    // Badge top is at 127px (below text), which is >= 100 and <= 300
    const topVal = parseFloat(badge.style.top);
    expect(topVal).toBeGreaterThanOrEqual(100);
    expect(topVal).toBeLessThanOrEqual(300);
  });
});
