import { LLMPlatformAdapter } from './types.js';
import { ChatGPTAdapter } from './chatgpt.js';
import { ClaudeAdapter } from './claude.js';
import { GeminiAdapter } from './gemini.js';

export class GenericFallbackAdapter implements LLMPlatformAdapter {
  readonly name = 'Generic';

  matches(_url: string): boolean {
    return true;
  }

  findInputElement(): HTMLElement | null {
    return (
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
    if (element instanceof HTMLTextAreaElement) {
      element.value = newText;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      element.innerText = newText;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  getResponseContainers(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.markdown, article, .response'));
  }
}

const REGISTERED_ADAPTERS: LLMPlatformAdapter[] = [
  new ChatGPTAdapter(),
  new ClaudeAdapter(),
  new GeminiAdapter(),
  new GenericFallbackAdapter(),
];

export function resolveAdapter(url: string = window.location.href): LLMPlatformAdapter {
  for (const adapter of REGISTERED_ADAPTERS) {
    if (adapter.matches(url)) {
      return adapter;
    }
  }
  return new GenericFallbackAdapter();
}

