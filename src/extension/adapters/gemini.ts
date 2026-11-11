import { LLMPlatformAdapter } from './types.js';
import { setContentEditableText } from './dom_utils.js';

export class GeminiAdapter implements LLMPlatformAdapter {
  readonly name = 'Gemini';

  matches(url: string): boolean {
    return url.includes('gemini.google.com');
  }

  findInputElement(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('rich-textarea div[contenteditable="true"]') ||
      document.querySelector<HTMLElement>('rich-textarea p') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"]') ||
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
      'message-content, model-response, div.response-container'
    );
    return Array.from(list);
  }
}

