import { LLMPlatformAdapter } from './types.js';
import { setContentEditableText } from './dom_utils.js';

export class ClaudeAdapter implements LLMPlatformAdapter {
  readonly name = 'Claude';

  matches(url: string): boolean {
    return url.includes('claude.ai');
  }

  findInputElement(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('div[contenteditable="true"].ProseMirror') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"]') ||
      document.querySelector<HTMLElement>('fieldset div[contenteditable="true"]') ||
      document.querySelector<HTMLElement>('textarea')
    );
  }

  extractPrompt(element: HTMLElement): string {
    if (element instanceof HTMLTextAreaElement) {
      return element.value;
    }
    return element.innerText || element.textContent || '';
  }

  setPrompt(element: HTMLElement, newText: string): void {
    setContentEditableText(element, newText);
  }

  getResponseContainers(): HTMLElement[] {
    const list = document.querySelectorAll<HTMLElement>(
      'div.font-claude-message, div[data-is-streaming], div.standard-markdown'
    );
    return Array.from(list);
  }
}

