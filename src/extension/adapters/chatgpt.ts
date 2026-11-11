import { LLMPlatformAdapter } from './types.js';
import { setContentEditableText } from './dom_utils.js';

export class ChatGPTAdapter implements LLMPlatformAdapter {
  readonly name = 'ChatGPT';

  matches(url: string): boolean {
    return url.includes('chatgpt.com') || url.includes('chat.openai.com');
  }

  findInputElement(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('#prompt-textarea') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"]') ||
      document.querySelector<HTMLElement>('textarea[data-id="root"]') ||
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
      'div[data-message-author-role="assistant"], div.agent-turn, div.markdown'
    );
    return Array.from(list);
  }
}

