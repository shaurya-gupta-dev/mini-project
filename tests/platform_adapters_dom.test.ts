/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ChatGPTAdapter } from '../src/extension/adapters/chatgpt.js';
import { ClaudeAdapter } from '../src/extension/adapters/claude.js';
import { GeminiAdapter } from '../src/extension/adapters/gemini.js';
import { DOMUnmasker } from '../src/extension/dom_unmasker.js';
import { SessionVault } from '../src/vault/session_vault.js';

describe('ChatGPTAdapter DOM Integration', () => {
  let adapter: ChatGPTAdapter;

  beforeEach(() => {
    document.body.innerHTML = '';
    adapter = new ChatGPTAdapter();
  });

  it('locates #prompt-textarea contenteditable input element', () => {
    document.body.innerHTML = `
      <div id="app">
        <div id="prompt-textarea" contenteditable="true">Initial prompt</div>
      </div>
    `;
    const input = adapter.findInputElement();
    expect(input).not.toBeNull();
    expect(input?.id).toBe('prompt-textarea');
    expect(adapter.extractPrompt(input!)).toBe('Initial prompt');
  });

  it('locates textarea[data-id="root"] as fallback', () => {
    document.body.innerHTML = `
      <div id="app">
        <textarea data-id="root">Textarea prompt</textarea>
      </div>
    `;
    const input = adapter.findInputElement();
    expect(input).not.toBeNull();
    expect(adapter.extractPrompt(input!)).toBe('Textarea prompt');
  });

  it('sets prompt and dispatches bubbling input event on textarea', () => {
    document.body.innerHTML = `<textarea id="prompt-textarea"></textarea>`;
    const input = document.getElementById('prompt-textarea') as HTMLTextAreaElement;
    
    let eventFired = false;
    let bubbles = false;
    input.addEventListener('input', (e) => {
      eventFired = true;
      bubbles = e.bubbles;
    });

    adapter.setPrompt(input, 'Redacted: [OPENAI_API_KEY_1]');
    expect(input.value).toBe('Redacted: [OPENAI_API_KEY_1]');
    expect(eventFired).toBe(true);
    expect(bubbles).toBe(true);
  });

  it('sets prompt and dispatches bubbling input event on contenteditable div', () => {
    document.body.innerHTML = `<div id="prompt-textarea" contenteditable="true"></div>`;
    const input = document.getElementById('prompt-textarea') as HTMLElement;
    
    let eventFired = false;
    input.addEventListener('input', () => {
      eventFired = true;
    });

    adapter.setPrompt(input, 'Contenteditable redacted text');
    expect(adapter.extractPrompt(input)).toBe('Contenteditable redacted text');
    expect(eventFired).toBe(true);
  });

  it('queries all ChatGPT response container variations', () => {
    document.body.innerHTML = `
      <div class="conversation">
        <div data-message-author-role="user">User question</div>
        <div data-message-author-role="assistant">Assistant response 1</div>
        <div class="agent-turn">Agent turn response 2</div>
        <div class="markdown">Markdown block 3</div>
      </div>
    `;
    const containers = adapter.getResponseContainers();
    expect(containers.length).toBe(3);
  });
});

describe('ClaudeAdapter DOM Integration', () => {
  let adapter: ClaudeAdapter;

  beforeEach(() => {
    document.body.innerHTML = '';
    adapter = new ClaudeAdapter();
  });

  it('locates div[contenteditable="true"].ProseMirror input element', () => {
    document.body.innerHTML = `
      <div class="claude-input-container">
        <div contenteditable="true" class="ProseMirror">Ask Claude anything</div>
      </div>
    `;
    const input = adapter.findInputElement();
    expect(input).not.toBeNull();
    expect(input?.classList.contains('ProseMirror')).toBe(true);
    expect(adapter.extractPrompt(input!)).toBe('Ask Claude anything');
  });

  it('locates fallback textarea in Claude interface', () => {
    document.body.innerHTML = `
      <div class="claude-fallback">
        <textarea placeholder="Reply...">Fallback Claude prompt</textarea>
      </div>
    `;
    const input = adapter.findInputElement();
    expect(input).not.toBeNull();
    expect(adapter.extractPrompt(input!)).toBe('Fallback Claude prompt');
  });

  it('sets prompt and triggers event in Claude ProseMirror editor', () => {
    document.body.innerHTML = `<div contenteditable="true" class="ProseMirror"></div>`;
    const input = adapter.findInputElement()!;
    let inputEventFired = false;
    input.addEventListener('input', () => {
      inputEventFired = true;
    });

    adapter.setPrompt(input, 'Claude sanitized [ANTHROPIC_API_KEY_1]');
    expect(adapter.extractPrompt(input)).toBe('Claude sanitized [ANTHROPIC_API_KEY_1]');
    expect(inputEventFired).toBe(true);
  });

  it('locates Claude streaming response containers', () => {
    document.body.innerHTML = `
      <div class="chat-viewport">
        <div class="font-claude-message">Static completed message</div>
        <div data-is-streaming="true">Streaming message</div>
        <div class="standard-markdown">Standard markdown message</div>
        <div class="user-message">User message (ignored)</div>
      </div>
    `;
    const containers = adapter.getResponseContainers();
    expect(containers.length).toBe(3);
  });
});

describe('GeminiAdapter DOM Integration', () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    document.body.innerHTML = '';
    adapter = new GeminiAdapter();
  });

  it('locates rich-textarea div[contenteditable="true"] in Gemini UI', () => {
    document.body.innerHTML = `
      <rich-textarea>
        <div contenteditable="true">Ask Gemini something</div>
      </rich-textarea>
    `;
    const input = adapter.findInputElement();
    expect(input).not.toBeNull();
    expect(adapter.extractPrompt(input!)).toBe('Ask Gemini something');
  });

  it('falls back to generic textarea if rich-textarea is absent', () => {
    document.body.innerHTML = `
      <div>
        <textarea>Gemini fallback prompt</textarea>
      </div>
    `;
    const input = adapter.findInputElement();
    expect(input).not.toBeNull();
    expect(adapter.extractPrompt(input!)).toBe('Gemini fallback prompt');
  });

  it('sets prompt and dispatches input event in Gemini rich editor', () => {
    document.body.innerHTML = `
      <rich-textarea>
        <div contenteditable="true"></div>
      </rich-textarea>
    `;
    const input = adapter.findInputElement()!;
    let eventReceived = false;
    input.addEventListener('input', () => {
      eventReceived = true;
    });

    adapter.setPrompt(input, 'Gemini protected query: [GOOGLE_API_KEY_1]');
    expect(adapter.extractPrompt(input)).toBe('Gemini protected query: [GOOGLE_API_KEY_1]');
    expect(eventReceived).toBe(true);
  });

  it('locates Gemini response containers (message-content, model-response)', () => {
    document.body.innerHTML = `
      <div class="chat-history">
        <message-content>Gemini reply 1</message-content>
        <model-response>Gemini model response 2</model-response>
        <div class="response-container">Container response 3</div>
        <user-query>User text</user-query>
      </div>
    `;
    const containers = adapter.getResponseContainers();
    expect(containers.length).toBe(3);
  });
});

describe('Live Streaming DOM Unmasker across Platforms', () => {
  let vault: SessionVault;
  const sessionId = 'test-session-live-stream';

  beforeEach(() => {
    document.body.innerHTML = '';
    vault = new SessionVault();
    vault.registerSecret(sessionId, 'sk-live-999888777666', 'OPENAI_API_KEY');
    vault.registerSecret(sessionId, 'user@enterprise.internal', 'EMAIL');
  });

  it('unmasks existing static text nodes upon scanning subtree', () => {
    document.body.innerHTML = `
      <div data-message-author-role="assistant">
        <p>Your API key is [OPENAI_API_KEY_1] and contact is [EMAIL_1].</p>
      </div>
    `;
    const unmasker = new DOMUnmasker(vault, sessionId);
    unmasker.scanAndUnmaskSubtree(document.body);

    const p = document.querySelector('p');
    expect(p?.textContent).toBe('Your API key is sk-live-999888777666 and contact is user@enterprise.internal.');
  });

  it('dynamically unmasks text nodes as tokens stream into the DOM via MutationObserver', async () => {
    document.body.innerHTML = `<div id="chat-stream" class="font-claude-message"></div>`;
    const streamContainer = document.getElementById('chat-stream')!;

    const unmasker = new DOMUnmasker(vault, sessionId);
    unmasker.startObserving(streamContainer);

    // Simulate streaming by creating a text node and updating characterData
    const textNode = document.createTextNode('Received token: [OPENAI_API_KEY_1]');
    streamContainer.appendChild(textNode);

    // Wait for mutation observer tick
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(streamContainer.textContent).toContain('sk-live-999888777666');
    expect(streamContainer.textContent).not.toContain('[OPENAI_API_KEY_1]');

    unmasker.stopObserving();
  });

  it('NEVER unmasks placeholders in prompt inputs (rich-textarea, contenteditable, textarea)', async () => {
    document.body.innerHTML = `
      <div id="gemini-app">
        <rich-textarea>
          <div contenteditable="true">
            <p>LUCIDITY_API_KEYS=[GENERIC_API_KEY_1] what is this</p>
          </div>
        </rich-textarea>
        <div id="claude-input" class="ProseMirror" contenteditable="true">
          <p>Prompt: [OPENAI_API_KEY_1]</p>
        </div>
        <textarea id="prompt-textarea">Raw text: [EMAIL_1]</textarea>
        
        <!-- Assistant response container (SHOULD be unmasked) -->
        <div data-message-author-role="assistant">
          <p>Assistant reply: [OPENAI_API_KEY_1]</p>
        </div>
      </div>
    `;

    vault.registerSecret(sessionId, 'cmp438078272436591415144cbd44b149a9', 'GENERIC_API_KEY');

    const unmasker = new DOMUnmasker(vault, sessionId);
    unmasker.startObserving(document.body);
    unmasker.scanAndUnmaskSubtree(document.body);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Input fields must preserve placeholders
    const geminiInput = document.querySelector('rich-textarea div[contenteditable="true"]');
    expect(geminiInput?.textContent).toContain('[GENERIC_API_KEY_1]');
    expect(geminiInput?.textContent).not.toContain('cmp438078272436591415144cbd44b149a9');

    const claudeInput = document.getElementById('claude-input');
    expect(claudeInput?.textContent).toContain('[OPENAI_API_KEY_1]');
    expect(claudeInput?.textContent).not.toContain('sk-live-999888777666');

    const textarea = document.getElementById('prompt-textarea') as HTMLTextAreaElement;
    expect(textarea.value || textarea.textContent).toContain('[EMAIL_1]');

    // Assistant response container MUST be unmasked
    const assistantReply = document.querySelector('div[data-message-author-role="assistant"] p');
    expect(assistantReply?.textContent).toBe('Assistant reply: sk-live-999888777666');

    unmasker.stopObserving();
  });

  it('NEVER unmasks placeholders in user chat history bubbles (user-query, font-user-message)', async () => {
    document.body.innerHTML = `
      <div class="chat-history">
        <!-- Gemini user query bubble -->
        <user-query>
          <div class="query-content">
            <p>LUCIDITY_API_KEYS=[GENERIC_API_KEY_1] what is this</p>
          </div>
        </user-query>

        <!-- Claude user message bubble -->
        <div class="font-user-message">
          <p>User sent: [OPENAI_API_KEY_1]</p>
        </div>

        <!-- ChatGPT user message bubble -->
        <div data-message-author-role="user">
          <p>Prompt: [EMAIL_1]</p>
        </div>

        <!-- Assistant response (SHOULD be unmasked) -->
        <div data-message-author-role="assistant">
          <p>Here is your email: [EMAIL_1]</p>
        </div>
      </div>
    `;

    vault.registerSecret(sessionId, 'cmp438078272436591415144cbd44b149a9', 'GENERIC_API_KEY');

    const unmasker = new DOMUnmasker(vault, sessionId);
    unmasker.startObserving(document.body);
    unmasker.scanAndUnmaskSubtree(document.body);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // User message bubbles MUST retain placeholders permanently
    const geminiQuery = document.querySelector('user-query');
    expect(geminiQuery?.textContent).toContain('[GENERIC_API_KEY_1]');
    expect(geminiQuery?.textContent).not.toContain('cmp438078272436591415144cbd44b149a9');

    const claudeMsg = document.querySelector('.font-user-message');
    expect(claudeMsg?.textContent).toContain('[OPENAI_API_KEY_1]');
    expect(claudeMsg?.textContent).not.toContain('sk-live-999888777666');

    const chatGptMsg = document.querySelector('div[data-message-author-role="user"]');
    expect(chatGptMsg?.textContent).toContain('[EMAIL_1]');
    expect(chatGptMsg?.textContent).not.toContain('user@enterprise.internal');

    // Assistant response container MUST be unmasked
    const assistantMsg = document.querySelector('div[data-message-author-role="assistant"] p');
    expect(assistantMsg?.textContent).toBe('Here is your email: user@enterprise.internal');

    unmasker.stopObserving();
  });

  it('DOES NOT unmask placeholders inside <rich-textarea><div contenteditable="true"> (Gemini input)', async () => {
    document.body.innerHTML = `
      <div id="gemini-root">
        <rich-textarea>
          <div contenteditable="true" role="textbox">
            <p>Pasted: LUCIDITY_API_KEYS=[GENERIC_API_KEY_1] what is this</p>
          </div>
        </rich-textarea>
      </div>
    `;
    vault.registerSecret(sessionId, 'cmp438078272436591415144cbd44b149a9', 'GENERIC_API_KEY');

    const unmasker = new DOMUnmasker(vault, sessionId);
    unmasker.startObserving(document.body);
    unmasker.scanAndUnmaskSubtree(document.body);

    // Also simulate dynamic characterData / child mutation inside editor
    const editor = document.querySelector('rich-textarea div[contenteditable="true"]')!;
    const newTextNode = document.createTextNode(' More text: [OPENAI_API_KEY_1]');
    editor.appendChild(newTextNode);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(editor.textContent).toContain('[GENERIC_API_KEY_1]');
    expect(editor.textContent).not.toContain('cmp438078272436591415144cbd44b149a9');
    expect(editor.textContent).toContain('[OPENAI_API_KEY_1]');
    expect(editor.textContent).not.toContain('sk-live-999888777666');

    unmasker.stopObserving();
  });

  it('DOES NOT unmask placeholders inside #prompt-textarea (ChatGPT input)', async () => {
    document.body.innerHTML = `
      <div id="chatgpt-root">
        <div id="prompt-textarea" contenteditable="true">
          <p>ChatGPT draft: [OPENAI_API_KEY_1]</p>
        </div>
      </div>
    `;

    const unmasker = new DOMUnmasker(vault, sessionId);
    unmasker.startObserving(document.body);
    unmasker.scanAndUnmaskSubtree(document.body);

    const input = document.getElementById('prompt-textarea')!;
    const childNode = document.createTextNode(' Extra: [EMAIL_1]');
    input.appendChild(childNode);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(input.textContent).toContain('[OPENAI_API_KEY_1]');
    expect(input.textContent).not.toContain('sk-live-999888777666');
    expect(input.textContent).toContain('[EMAIL_1]');
    expect(input.textContent).not.toContain('user@enterprise.internal');

    unmasker.stopObserving();
  });

  it('DOES NOT unmask placeholders inside div.ProseMirror[contenteditable="true"] (Claude input)', async () => {
    document.body.innerHTML = `
      <div id="claude-root">
        <div class="ProseMirror" contenteditable="true">
          <p>Claude prompt: [OPENAI_API_KEY_1]</p>
        </div>
      </div>
    `;

    const unmasker = new DOMUnmasker(vault, sessionId);
    unmasker.startObserving(document.body);
    unmasker.scanAndUnmaskSubtree(document.body);

    const input = document.querySelector('div.ProseMirror')!;
    const childNode = document.createTextNode(' and [EMAIL_1]');
    input.appendChild(childNode);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(input.textContent).toContain('[OPENAI_API_KEY_1]');
    expect(input.textContent).not.toContain('sk-live-999888777666');
    expect(input.textContent).toContain('[EMAIL_1]');
    expect(input.textContent).not.toContain('user@enterprise.internal');

    unmasker.stopObserving();
  });

  it('DOES NOT unmask placeholders inside standard <textarea>', async () => {
    document.body.innerHTML = `
      <div id="generic-root">
        <textarea id="standard-box">Standard input: [OPENAI_API_KEY_1]</textarea>
      </div>
    `;

    const unmasker = new DOMUnmasker(vault, sessionId);
    unmasker.startObserving(document.body);
    unmasker.scanAndUnmaskSubtree(document.body);

    const textarea = document.getElementById('standard-box') as HTMLTextAreaElement;
    expect(textarea.value || textarea.textContent).toContain('[OPENAI_API_KEY_1]');
    expect(textarea.value || textarea.textContent).not.toContain('sk-live-999888777666');

    unmasker.stopObserving();
  });

  it('STILL unmasks placeholders inside assistant response containers (<model-response>, .font-claude-message, div[data-message-author-role="assistant"])', async () => {
    document.body.innerHTML = `
      <div id="conversation-feed">
        <!-- Gemini response container -->
        <model-response>
          <p>Gemini output: [OPENAI_API_KEY_1]</p>
        </model-response>

        <!-- Claude response container -->
        <div class="font-claude-message">
          <p>Claude output: [EMAIL_1]</p>
        </div>

        <!-- ChatGPT response container -->
        <div data-message-author-role="assistant">
          <p>ChatGPT output: [OPENAI_API_KEY_1] and [EMAIL_1]</p>
        </div>
      </div>
    `;

    const unmasker = new DOMUnmasker(vault, sessionId);
    unmasker.startObserving(document.body);
    unmasker.scanAndUnmaskSubtree(document.body);

    // Also test streaming node into <model-response>
    const modelResponse = document.querySelector('model-response')!;
    const streamingP = document.createElement('p');
    streamingP.textContent = 'Streaming token: [OPENAI_API_KEY_1]';
    modelResponse.appendChild(streamingP);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const geminiText = document.querySelector('model-response')?.textContent;
    expect(geminiText).toContain('sk-live-999888777666');
    expect(geminiText).not.toContain('[OPENAI_API_KEY_1]');

    const claudeText = document.querySelector('.font-claude-message')?.textContent;
    expect(claudeText).toContain('user@enterprise.internal');
    expect(claudeText).not.toContain('[EMAIL_1]');

    const chatgptText = document.querySelector('div[data-message-author-role="assistant"]')?.textContent;
    expect(chatgptText).toContain('sk-live-999888777666');
    expect(chatgptText).toContain('user@enterprise.internal');
    expect(chatgptText).not.toContain('[OPENAI_API_KEY_1]');
    expect(chatgptText).not.toContain('[EMAIL_1]');

    unmasker.stopObserving();
  });

  it('short-circuits MutationObserver immediately when session vault has no active secrets', async () => {
    const emptyVault = new SessionVault();
    const emptySessionId = 'empty-session-123';
    expect(emptyVault.hasActiveSecrets(emptySessionId)).toBe(false);

    document.body.innerHTML = `<div id="response" class="font-claude-message"></div>`;
    const container = document.getElementById('response')!;

    const unmasker = new DOMUnmasker(emptyVault, emptySessionId);
    unmasker.startObserving(container);

    const textNode = document.createTextNode('Contains [OPENAI_API_KEY_1]');
    container.appendChild(textNode);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Must remain untouched because vault has zero secrets
    expect(textNode.nodeValue).toBe('Contains [OPENAI_API_KEY_1]');

    unmasker.stopObserving();
  });
});
