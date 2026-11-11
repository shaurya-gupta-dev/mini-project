/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  replaceSecretInEditor,
  extractEditorText,
  findTextNodeSpan,
  findAllTextNodeSpans,
} from '../src/extension/adapters/editor_replacer.js';

describe('Editor Replacer & DOM Integration Suite', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('extractEditorText', () => {
    it('extracts plain text from standard textarea and input', () => {
      const textarea = document.createElement('textarea');
      textarea.value = 'Textarea prompt content';
      expect(extractEditorText(textarea)).toBe('Textarea prompt content');

      const input = document.createElement('input');
      input.value = 'Input prompt content';
      expect(extractEditorText(input)).toBe('Input prompt content');
    });

    it('extracts text from nested <p> tags with newline separation (Gemini structure)', () => {
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      editor.innerHTML = `
        <p>First paragraph</p>
        <p>Second paragraph with details</p>
        <p>Third paragraph</p>
      `;
      expect(extractEditorText(editor)).toBe(
        'First paragraph\nSecond paragraph with details\nThird paragraph'
      );
    });

    it('extracts text from ProseMirror div with <br> tags (Claude structure)', () => {
      const editor = document.createElement('div');
      editor.className = 'ProseMirror';
      editor.setAttribute('contenteditable', 'true');
      editor.innerHTML = `
        <p>Line 1<br>Line 1 continued</p>
        <p>Line 2</p>
      `;
      expect(extractEditorText(editor)).toBe('Line 1\nLine 1 continued\nLine 2');
    });

    it('extracts text from shadow DOM elements', () => {
      const host = document.createElement('div');
      const shadow = host.attachShadow({ mode: 'open' });
      const inner = document.createElement('div');
      inner.innerHTML = '<p>Shadow text line 1</p><p>Shadow text line 2</p>';
      shadow.appendChild(inner);

      expect(extractEditorText(host)).toBe('Shadow text line 1\nShadow text line 2');
    });

    it('handles empty or null elements gracefully', () => {
      // @ts-expect-error Testing null defensively
      expect(extractEditorText(null)).toBe('');
      const emptyDiv = document.createElement('div');
      expect(extractEditorText(emptyDiv)).toBe('');
    });
  });

  describe('replaceSecretInEditor - Strategy C (Textarea & Input)', () => {
    it('replaces secret in HTMLTextAreaElement and dispatches input/change events', () => {
      const textarea = document.createElement('textarea');
      textarea.value = 'Prompt with sk-proj-1234567890abcdef and more context';
      document.body.appendChild(textarea);

      let inputDispatched = false;
      let changeDispatched = false;
      let inputType = '';
      let eventData = '';

      textarea.addEventListener('input', (e) => {
        inputDispatched = true;
        if (e instanceof InputEvent) {
          inputType = e.inputType;
          eventData = e.data ?? '';
        }
      });
      textarea.addEventListener('change', () => {
        changeDispatched = true;
      });

      const success = replaceSecretInEditor(
        textarea,
        'sk-proj-1234567890abcdef',
        '[OPENAI_API_KEY_1]'
      );

      expect(success).toBe(true);
      expect(textarea.value).toBe(
        'Prompt with [OPENAI_API_KEY_1] and more context'
      );
      expect(inputDispatched).toBe(true);
      expect(changeDispatched).toBe(true);
      expect(inputType).toBe('insertText');
      expect(eventData).toBe('[OPENAI_API_KEY_1]');
    });

    it('replaces secret in HTMLInputElement', () => {
      const input = document.createElement('input');
      input.value = 'Bearer my-secret-token-12345';
      document.body.appendChild(input);

      const success = replaceSecretInEditor(
        input,
        'my-secret-token-12345',
        '[AUTH_TOKEN_1]'
      );

      expect(success).toBe(true);
      expect(input.value).toBe('Bearer [AUTH_TOKEN_1]');
    });

    it('replaces secret when target is inside a wrapper without contenteditable', () => {
      const wrapper = document.createElement('div');
      wrapper.id = 'prompt-wrapper';
      const textarea = document.createElement('textarea');
      textarea.value = 'Secret in wrapper: ghp_1234567890abcdef';
      wrapper.appendChild(textarea);
      document.body.appendChild(wrapper);

      let wrapperEventFired = false;
      wrapper.addEventListener('input', () => {
        wrapperEventFired = true;
      });

      const success = replaceSecretInEditor(
        wrapper,
        'ghp_1234567890abcdef',
        '[GITHUB_TOKEN_1]'
      );

      expect(success).toBe(true);
      expect(textarea.value).toBe('Secret in wrapper: [GITHUB_TOKEN_1]');
      expect(wrapperEventFired).toBe(true);
    });
  });

  describe('replaceSecretInEditor - Nested <p> in contenteditable (Gemini)', () => {
    it('locates and replaces secret inside nested <p> tag and dispatches bubbling events', () => {
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      editor.innerHTML = `
        <p>Hello Gemini, please inspect my database config:</p>
        <p>Connection string: postgresql://admin:SuperSecretPass123@db.example.com:5432/main</p>
        <p>Thanks for checking.</p>
      `;
      document.body.appendChild(editor);

      let editorInputFired = false;
      let editorChangeFired = false;
      editor.addEventListener('input', () => {
        editorInputFired = true;
      });
      editor.addEventListener('change', () => {
        editorChangeFired = true;
      });

      const rawSecret = 'SuperSecretPass123';
      const placeholder = '[DATABASE_PASSWORD_1]';

      const success = replaceSecretInEditor(editor, rawSecret, placeholder);

      expect(success).toBe(true);
      expect(editor.innerHTML).toContain(
        'postgresql://admin:[DATABASE_PASSWORD_1]@db.example.com:5432/main'
      );
      expect(editor.innerHTML).not.toContain('SuperSecretPass123');
      expect(editorInputFired).toBe(true);
      expect(editorChangeFired).toBe(true);
    });
  });

  describe('replaceSecretInEditor - .ProseMirror div (Claude)', () => {
    it('replaces secret in Claude ProseMirror editor structure', () => {
      const editor = document.createElement('div');
      editor.className = 'ProseMirror';
      editor.setAttribute('contenteditable', 'true');
      editor.innerHTML = `
        <p>Anthropic key: sk-ant-api03-abcdef1234567890-test</p>
      `;
      document.body.appendChild(editor);

      let inputEventFired = false;
      editor.addEventListener('input', () => {
        inputEventFired = true;
      });

      const success = replaceSecretInEditor(
        editor,
        'sk-ant-api03-abcdef1234567890-test',
        '[ANTHROPIC_API_KEY_1]'
      );

      expect(success).toBe(true);
      expect(editor.textContent).toContain('Anthropic key: [ANTHROPIC_API_KEY_1]');
      expect(editor.textContent).not.toContain('sk-ant-api03-abcdef1234567890-test');
      expect(inputEventFired).toBe(true);
    });
  });

  describe('replaceSecretInEditor - Multiple text nodes and partial nodes', () => {
    it('replaces secret split across multiple <span> text nodes', () => {
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      editor.innerHTML = '<p><span>sk-ant-</span><span>api03-</span><span>999888777</span></p>';
      document.body.appendChild(editor);

      const rawSecret = 'sk-ant-api03-999888777';
      const placeholder = '[ANTHROPIC_API_KEY_SPLIT]';

      const success = replaceSecretInEditor(editor, rawSecret, placeholder);

      expect(success).toBe(true);
      expect(editor.textContent?.trim()).toBe('[ANTHROPIC_API_KEY_SPLIT]');
      expect(editor.textContent).not.toContain(rawSecret);
    });

    it('replaces secret spanning partial text nodes with prefix and suffix text', () => {
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      editor.innerHTML = '<p><span>Prefix text sk-ant-</span><span>api03-secret and suffix text</span></p>';
      document.body.appendChild(editor);

      const rawSecret = 'sk-ant-api03-secret';
      const placeholder = '[REDACTED_API_KEY]';

      const success = replaceSecretInEditor(editor, rawSecret, placeholder);

      expect(success).toBe(true);
      expect(editor.textContent?.trim()).toBe(
        'Prefix text [REDACTED_API_KEY] and suffix text'
      );
      expect(editor.textContent).not.toContain(rawSecret);
    });

    it('replaces secret across 3 text nodes with an intermediate node', () => {
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      editor.innerHTML = '<p>Key: <code>AKIA</code><code>IOSFODNN7</code><code>EXAMPLE</code> please check</p>';
      document.body.appendChild(editor);

      const rawSecret = 'AKIAIOSFODNN7EXAMPLE';
      const placeholder = '[AWS_ACCESS_KEY_ID_1]';

      const success = replaceSecretInEditor(editor, rawSecret, placeholder);

      expect(success).toBe(true);
      expect(editor.textContent?.trim()).toBe(
        'Key: [AWS_ACCESS_KEY_ID_1] please check'
      );
    });
  });

  describe('replaceSecretInEditor - Strategy A execution (execCommand)', () => {
    it('executes Strategy A with selection Range and execCommand when supported', () => {
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      editor.innerHTML = '<p>Secret: sk-ant-12345678</p>';
      document.body.appendChild(editor);

      let rangePassedToSelection: Range | null = null;
      const originalGetSelection = window.getSelection;
      const mockSelection = {
        removeAllRanges: vi.fn(),
        addRange: vi.fn((range: Range) => {
          rangePassedToSelection = range;
        }),
      };
      // @ts-expect-error Mocking getSelection for happy-dom
      window.getSelection = vi.fn(() => mockSelection);

      // Mock execCommand to simulate successful browser text replacement
      const mockExecCommand = vi.fn(
        (cmd: string, _showUI: boolean, val: string) => {
          if (cmd === 'insertText') {
            if (rangePassedToSelection) {
              const r = rangePassedToSelection as Range;
              r.deleteContents();
              r.insertNode(document.createTextNode(val));
              return true;
            }
          }
          return false;
        }
      );
      document.execCommand = mockExecCommand;

      const success = replaceSecretInEditor(
        editor,
        'sk-ant-12345678',
        '[ANTHROPIC_KEY_1]'
      );

      expect(success).toBe(true);
      expect(mockSelection.removeAllRanges).toHaveBeenCalled();
      expect(mockSelection.addRange).toHaveBeenCalled();
      expect(mockExecCommand).toHaveBeenCalledWith(
        'insertText',
        false,
        '[ANTHROPIC_KEY_1]'
      );
      expect(editor.textContent).toContain('Secret: [ANTHROPIC_KEY_1]');
      expect(editor.textContent).not.toContain('sk-ant-12345678');

      window.getSelection = originalGetSelection;
    });

    it('falls back to Strategy B if execCommand returns false', () => {
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      editor.innerHTML = '<p>Secret: sk-ant-12345678</p>';
      document.body.appendChild(editor);

      document.execCommand = vi.fn().mockReturnValue(false);

      const success = replaceSecretInEditor(
        editor,
        'sk-ant-12345678',
        '[ANTHROPIC_KEY_FALLBACK]'
      );

      expect(success).toBe(true);
      expect(editor.textContent).toContain('Secret: [ANTHROPIC_KEY_FALLBACK]');
      expect(editor.textContent).not.toContain('sk-ant-12345678');
    });

    it('falls back to Strategy B if execCommand throws an error', () => {
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      editor.innerHTML = '<p>Secret: sk-ant-12345678</p>';
      document.body.appendChild(editor);

      document.execCommand = vi.fn(() => {
        throw new Error('execCommand disabled in sandbox');
      });

      const success = replaceSecretInEditor(
        editor,
        'sk-ant-12345678',
        '[ANTHROPIC_KEY_THROWS]'
      );

      expect(success).toBe(true);
      expect(editor.textContent).toContain('Secret: [ANTHROPIC_KEY_THROWS]');
    });
  });

  describe('replaceSecretInEditor - Gemini <rich-textarea> & Quill .ql-editor', () => {
    it('replaces secret when called on outer <rich-textarea> custom element wrapping .ql-editor', () => {
      const host = document.createElement('rich-textarea');
      const qlEditor = document.createElement('div');
      qlEditor.className = 'ql-editor textarea';
      qlEditor.setAttribute('contenteditable', 'true');
      qlEditor.innerHTML = '<p>Gemini prompt: AIzaSyD9876543210zyxwvutsrqponmlkjihgfedcba</p>';
      host.appendChild(qlEditor);
      document.body.appendChild(host);

      let beforeInputDispatched = false;
      let inputDispatched = false;
      qlEditor.addEventListener('beforeinput', (e: any) => {
        if (e.data === '[GOOGLE_API_KEY_1]') {
          beforeInputDispatched = true;
        }
      });
      qlEditor.addEventListener('input', (e: any) => {
        if (e.data === '[GOOGLE_API_KEY_1]') {
          inputDispatched = true;
        }
      });

      const success = replaceSecretInEditor(
        host,
        'AIzaSyD9876543210zyxwvutsrqponmlkjihgfedcba',
        '[GOOGLE_API_KEY_1]'
      );

      expect(success).toBe(true);
      expect(qlEditor.textContent).toContain('[GOOGLE_API_KEY_1]');
      expect(qlEditor.textContent).not.toContain('AIzaSyD9876543210zyxwvutsrqponmlkjihgfedcba');
      expect(beforeInputDispatched).toBe(true);
      expect(inputDispatched).toBe(true);
    });
  });

  describe('Edge cases and boundary conditions', () => {
    it('returns false when secret is not found in the editor', () => {
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      editor.innerHTML = '<p>Normal text without any secrets</p>';
      document.body.appendChild(editor);

      const success = replaceSecretInEditor(
        editor,
        'sk-ant-nonexistent',
        '[REDACTED]'
      );
      expect(success).toBe(false);
      expect(editor.textContent).toBe('Normal text without any secrets');
    });

    it('returns false for empty or null inputs', () => {
      const editor = document.createElement('div');
      expect(replaceSecretInEditor(editor, '', '[PLACEHOLDER]')).toBe(false);
      // @ts-expect-error Defensively testing null element
      expect(replaceSecretInEditor(null, 'secret', '[PLACEHOLDER]')).toBe(false);
    });

    it('supports sequential replacement of multiple distinct secrets', () => {
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      editor.innerHTML = `
        <p>Key 1: sk-ant-first12345</p>
        <p>Key 2: ghp_second67890</p>
      `;
      document.body.appendChild(editor);

      const firstSuccess = replaceSecretInEditor(
        editor,
        'sk-ant-first12345',
        '[KEY_1]'
      );
      const secondSuccess = replaceSecretInEditor(
        editor,
        'ghp_second67890',
        '[KEY_2]'
      );

      expect(firstSuccess).toBe(true);
      expect(secondSuccess).toBe(true);
      expect(editor.textContent).toContain('Key 1: [KEY_1]');
      expect(editor.textContent).toContain('Key 2: [KEY_2]');
      expect(editor.textContent).not.toContain('sk-ant-first12345');
      expect(editor.textContent).not.toContain('ghp_second67890');
    });

    it('successfully locates exact DOM coordinates via exported findTextNodeSpan', () => {
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      editor.innerHTML = '<p>Prefix text and then sk-proj-1234567890abcdef suffix</p>';
      document.body.appendChild(editor);

      const span = findTextNodeSpan(editor, 'sk-proj-1234567890abcdef');
      expect(span).not.toBeNull();
      expect(span!.startOffset).toBe(21);
      expect(span!.endOffset).toBe(45);
      expect(span!.startNode.nodeValue).toContain('sk-proj-1234567890abcdef');
    });

    it('falls back to full-text replacement when targeted span is simulated as missing', () => {
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      editor.innerHTML = '<p>Config: API_TOKEN_SECRET_998877 in complex structure</p>';
      document.body.appendChild(editor);

      // Simulates execCommand replacing full contents
      const execCommandSpy = vi.spyOn(document, 'execCommand').mockImplementation((command, _showUI, val) => {
        if (command === 'insertText') {
          editor.innerText = String(val);
          return true;
        }
        return false;
      });

      const success = replaceSecretInEditor(editor, 'API_TOKEN_SECRET_998877', '[REDACTED_TOKEN]');
      expect(success).toBe(true);
      expect(editor.textContent).toContain('[REDACTED_TOKEN]');
      expect(editor.textContent).not.toContain('API_TOKEN_SECRET_998877');
      execCommandSpy.mockRestore();
    });

    it('finds all occurrences of targetText via findAllTextNodeSpans', () => {
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      editor.innerHTML = '<p>Key: cmp438078272436591415144cbd44b149a9 and another cmp438078272436591415144cbd44b149a9 here</p>';
      document.body.appendChild(editor);

      const spans = findAllTextNodeSpans(editor, 'cmp438078272436591415144cbd44b149a9');
      expect(spans.length).toBe(2);
      expect(spans[0]!.startOffset).toBe(5);
      expect(spans[1]!.startOffset).toBe(53);
    });
  });
});
