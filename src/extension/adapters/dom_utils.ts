/**
 * DOM Input Utilities for Modern Rich-Text Editors
 * Provides resilient text replacement across ProseMirror (Claude),
 * Lexical (ChatGPT), Wiz/Angular (Gemini), and standard HTML inputs.
 */

export function setContentEditableText(element: HTMLElement, newText: string): void {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    element.value = newText;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  try {
    element.focus();

    // 1. Select all contents within the editor
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    // 2. Try document.execCommand('insertText') which triggers ProseMirror/Lexical input transactions
    const commandSuccess = document.execCommand('insertText', false, newText);
    
    // 3. Fallback: if execCommand was not handled or failed, manually update DOM and dispatch InputEvent
    if (!commandSuccess || (element.textContent !== newText && !element.innerText.includes(newText))) {
      element.innerText = newText;
      try {
        const inputEvent = new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: newText,
        });
        element.dispatchEvent(inputEvent);
      } catch {
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } catch (err) {
    // Ultimate fallback
    element.innerText = newText;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

