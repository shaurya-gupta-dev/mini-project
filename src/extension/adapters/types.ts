/**
 * Adapter interface for Web LLM platforms (ChatGPT, Claude, Gemini).
 */

export interface LLMPlatformAdapter {
  readonly name: string;
  matches(url: string): boolean;
  findInputElement(): HTMLElement | null;
  extractPrompt(element: HTMLElement): string;
  setPrompt(element: HTMLElement, newText: string): void;
  getResponseContainers(): HTMLElement[];
}

