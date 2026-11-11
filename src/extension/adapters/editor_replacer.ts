/**
 * Editor Replacer & DOM Integration
 *
 * Provides robust, resilient in-place replacement of detected secrets with
 * placeholders across ProseMirror (Claude), Wiz/Angular (Gemini), and Lexical (ChatGPT).
 */

import { setContentEditableText } from './dom_utils.js';

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'tr',
  'blockquote',
  'article',
  'section',
]);

/**
 * Checks if an element contains any block-level child elements.
 */
function hasBlockChildren(element: HTMLElement): boolean {
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = (child as HTMLElement).tagName.toLowerCase();
      if (BLOCK_TAGS.has(tag)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Text node span descriptor for precise character offset mapping.
 */
interface TextNodeSpan {
  node: Text;
  start: number;
  end: number;
}

/**
 * Matched range span across one or more Text nodes.
 */
export interface MatchedSpan {
  startNode: Text;
  startOffset: number;
  endNode: Text;
  endOffset: number;
  affectedNodes: Text[];
}

/**
 * Recursively collects all non-empty Text nodes in document order,
 * including within open Shadow DOM roots if present.
 * Filters out whitespace-only formatting nodes between block elements.
 */
function collectTextNodes(root: Node): Text[] {
  const textNodes: Text[] = [];

  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const val = node.nodeValue ?? '';
      if (val.length === 0) {
        return;
      }
      if (
        node.parentElement &&
        hasBlockChildren(node.parentElement) &&
        /^[\s\r\n]+$/.test(val)
      ) {
        return;
      }
      textNodes.push(node as Text);
      return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style') {
        return;
      }

      if (el.shadowRoot) {
        for (let child = el.shadowRoot.firstChild; child; child = child.nextSibling) {
          walk(child);
        }
      }
    }

    for (let child = node.firstChild; child; child = child.nextSibling) {
      walk(child);
    }
  }

  walk(root);
  return textNodes;
}

/**
 * Locates all occurrences of targetText across the editor's text nodes.
 */
export function findAllTextNodeSpans(root: Node, targetText: string): MatchedSpan[] {
  if (!targetText) {
    return [];
  }

  const textNodes = collectTextNodes(root);
  if (textNodes.length === 0) {
    return [];
  }

  const spans: TextNodeSpan[] = [];
  let combined = '';

  for (const node of textNodes) {
    const val = node.nodeValue ?? '';
    if (val.length === 0) {
      continue;
    }
    const start = combined.length;
    combined += val;
    const end = combined.length;
    spans.push({ node, start, end });
  }

  const results: MatchedSpan[] = [];
  let searchPos = 0;

  while (searchPos < combined.length) {
    const matchIndex = combined.indexOf(targetText, searchPos);
    if (matchIndex === -1) {
      break;
    }

    const matchEnd = matchIndex + targetText.length;
    searchPos = matchIndex + Math.max(1, targetText.length);

    let startIndex = -1;
    let endIndex = -1;

    for (let i = 0; i < spans.length; i++) {
      const span = spans[i]!;
      if (startIndex === -1 && matchIndex >= span.start && matchIndex < span.end) {
        startIndex = i;
      }
      if (endIndex === -1 && matchEnd > span.start && matchEnd <= span.end) {
        endIndex = i;
      }
    }

    if (startIndex !== -1 && endIndex !== -1 && startIndex <= endIndex) {
      const startSpan = spans[startIndex]!;
      const endSpan = spans[endIndex]!;
      results.push({
        startNode: startSpan.node,
        startOffset: matchIndex - startSpan.start,
        endNode: endSpan.node,
        endOffset: matchEnd - endSpan.start,
        affectedNodes: spans.slice(startIndex, endIndex + 1).map((s) => s.node),
      });
    }
  }

  return results;
}

/**
 * Locates the exact occurrence of targetText across the editor's text nodes.
 * Maps exact character offsets from the concatenated stream back into individual DOM Text nodes.
 */
export function findTextNodeSpan(root: Node, targetText: string): MatchedSpan | null {
  if (!targetText) {
    return null;
  }

  const textNodes = collectTextNodes(root);
  if (textNodes.length === 0) {
    return null;
  }

  const spans: TextNodeSpan[] = [];
  let combined = '';

  for (const node of textNodes) {
    const val = node.nodeValue ?? '';
    if (val.length === 0) {
      continue;
    }
    const start = combined.length;
    combined += val;
    const end = combined.length;
    spans.push({ node, start, end });
  }

  const matchIndex = combined.indexOf(targetText);
  if (matchIndex === -1) {
    return null;
  }

  const matchEnd = matchIndex + targetText.length;

  let startIndex = -1;
  let endIndex = -1;

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (startIndex === -1 && matchIndex >= span.start && matchIndex < span.end) {
      startIndex = i;
    }
    if (endIndex === -1 && matchEnd > span.start && matchEnd <= span.end) {
      endIndex = i;
    }
  }

  if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
    return null;
  }

  const startSpan = spans[startIndex];
  const endSpan = spans[endIndex];

  return {
    startNode: startSpan.node,
    startOffset: matchIndex - startSpan.start,
    endNode: endSpan.node,
    endOffset: matchEnd - endSpan.start,
    affectedNodes: spans.slice(startIndex, endIndex + 1).map((s) => s.node),
  };
}

/**
 * Strategy B helper: directly replaces matched text within the DOM Text nodes.
 * Preserves surrounding DOM structure, formatting spans, and node hierarchy.
 */
function applyTextNodeReplacement(span: MatchedSpan, placeholder: string): void {
  const { startNode, startOffset, endNode, endOffset, affectedNodes } = span;

  if (startNode === endNode) {
    const original = startNode.nodeValue ?? '';
    startNode.nodeValue =
      original.slice(0, startOffset) + placeholder + original.slice(endOffset);
  } else {
    // Multi-node replacement:
    // 1. Slice start node and append the placeholder
    const startVal = startNode.nodeValue ?? '';
    startNode.nodeValue = startVal.slice(0, startOffset) + placeholder;

    // 2. Clear all intermediate text nodes completely
    for (let i = 1; i < affectedNodes.length - 1; i++) {
      affectedNodes[i].nodeValue = '';
    }

    // 3. Slice end node past the endOffset
    const endVal = endNode.nodeValue ?? '';
    endNode.nodeValue = endVal.slice(endOffset);
  }
}

/**
 * Dispatches standard synthetic beforeinput, input, and change events with bubbling enabled.
 * Also hooks into Quill delta update mechanisms if running inside Gemini / Quill editors.
 */
function dispatchInputEvents(element: HTMLElement, data: string): void {
  try {
    const beforeInputEvent = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: 'insertText',
      data,
    });
    element.dispatchEvent(beforeInputEvent);
  } catch {
    // Fallback for environments lacking full InputEvent support
  }

  try {
    const inputEvent = new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: 'insertText',
      data,
    });
    element.dispatchEvent(inputEvent);
  } catch {
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }

  element.dispatchEvent(new Event('change', { bubbles: true }));

  // If inside a Quill editor (Gemini), trigger Quill's internal synchronization
  try {
    const quillHost = element.closest('.ql-container, rich-textarea, .ql-editor') as any;
    if (quillHost) {
      if (typeof quillHost.__quill?.update === 'function') {
        quillHost.__quill.update();
      } else if (typeof quillHost._quill?.update === 'function') {
        quillHost._quill.update();
      }
    }
  } catch {
    // Ignore internal Quill hooks if unavailable
  }
}

/**
 * Strategy C helper: handles textarea and text input elements.
 */
function replaceInTextareaOrInput(
  element: HTMLTextAreaElement | HTMLInputElement,
  rawSecret: string,
  placeholder: string
): boolean {
  if (!rawSecret) {
    return false;
  }

  const value = element.value;
  const start = value.indexOf(rawSecret);
  if (start === -1) {
    return false;
  }

  const end = start + rawSecret.length;
  if (typeof element.setRangeText === 'function') {
    element.setRangeText(placeholder, start, end, 'end');
  } else {
    element.value = value.slice(0, start) + placeholder + value.slice(end);
  }

  dispatchInputEvents(element, placeholder);
  return true;
}

/**
 * Extracts complete plain text from an editor element, accurately formatting
 * paragraphs, line breaks, shadow DOM, and standard inputs.
 */
export function extractEditorText(editorElement: HTMLElement): string {
  if (!editorElement) {
    return '';
  }

  if (
    editorElement instanceof HTMLTextAreaElement ||
    editorElement instanceof HTMLInputElement
  ) {
    return editorElement.value;
  }

  let result = '';

  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const val = node.nodeValue ?? '';
      if (
        node.parentElement &&
        hasBlockChildren(node.parentElement) &&
        /^[\s\r\n]+$/.test(val)
      ) {
        return;
      }
      result += val;
      return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();

      if (tag === 'script' || tag === 'style') {
        return;
      }

      if (
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLInputElement
      ) {
        result += el.value;
        return;
      }

      if (tag === 'br') {
        result += '\n';
        return;
      }

      const isBlock = BLOCK_TAGS.has(tag);
      if (isBlock && result.length > 0 && !result.endsWith('\n')) {
        result += '\n';
      }

      if (el.shadowRoot) {
        for (let child = el.shadowRoot.firstChild; child; child = child.nextSibling) {
          walk(child);
        }
      }

      for (let child = el.firstChild; child; child = child.nextSibling) {
        walk(child);
      }
    }
  }

  walk(editorElement);
  return result;
}

/**
 * Replaces an exact occurrence of rawSecret inside an editor element with placeholder.
 * Supports ProseMirror (Claude), Lexical (ChatGPT), Wiz/Angular (Gemini), and standard inputs.
 *
 * @param editorElement The host or editable DOM element
 * @param rawSecret The raw secret string to replace
 * @param placeholder The redaction placeholder (e.g. "[ANTHROPIC_API_KEY_1]")
 * @returns True if replacement succeeded, false otherwise
 */
export function replaceSecretInEditor(
  editorElement: HTMLElement,
  rawSecret: string,
  placeholder: string
): boolean {
  if (!editorElement || !rawSecret) {
    return false;
  }

  // Strategy C: Textarea or Input element
  if (
    editorElement instanceof HTMLTextAreaElement ||
    editorElement instanceof HTMLInputElement
  ) {
    return replaceInTextareaOrInput(editorElement, rawSecret, placeholder);
  }

  // Wrapper fallback: if editorElement wraps a textarea or input without contenteditable
  if (editorElement.getAttribute('contenteditable') !== 'true') {
    const innerInput = editorElement.querySelector<HTMLTextAreaElement | HTMLInputElement>(
      'textarea, input'
    );
    if (innerInput && innerInput.value.includes(rawSecret)) {
      const replaced = replaceInTextareaOrInput(innerInput, rawSecret, placeholder);
      if (replaced) {
        dispatchInputEvents(editorElement, placeholder);
        return true;
      }
    }
  }

  // Resolve the true contenteditable element (handles rich-textarea wrappers or nested paragraphs)
  const editableTarget: HTMLElement =
    editorElement.getAttribute('contenteditable') === 'true'
      ? editorElement
      : editorElement.querySelector<HTMLElement>('[contenteditable="true"]') || editorElement;

  // Locate the exact text span in the DOM tree if present
  const span = findTextNodeSpan(editorElement, rawSecret);

  // Strategy A (Primary for rich editors): Targeted Range selection + document.execCommand('insertText')
  if (span) {
    try {
      if (typeof editableTarget.focus === 'function') {
        editableTarget.focus();
      }

      const selection = window.getSelection();
      if (selection && typeof document.createRange === 'function') {
        const range = document.createRange();
        range.setStart(span.startNode, span.startOffset);
        range.setEnd(span.endNode, span.endOffset);
        selection.removeAllRanges();
        selection.addRange(range);

        // Notify ProseMirror / Quill selection observers of new focused range
        document.dispatchEvent(new Event('selectionchange'));

        if (typeof document.execCommand === 'function') {
          const cmdRes = document.execCommand('insertText', false, placeholder);
          if (cmdRes && !extractEditorText(editorElement).includes(rawSecret)) {
            const eventTarget = span.startNode.parentElement ?? editableTarget;
            dispatchInputEvents(eventTarget, placeholder);
            if (eventTarget !== editableTarget) {
              dispatchInputEvents(editableTarget, placeholder);
            }
            return true;
          }
        }
      }
    } catch {
      // Continue to next strategy
    }
  }

  // Strategy B (Full-Text Replacement for ProseMirror/Quill reconciliation):
  // When targeted range execCommand is ignored or rejected by complex frameworks,
  // select the full editor contents and execute insertText with the updated text.
  // ProseMirror handles this as a full document replace transaction without desyncing.
  try {
    const fullText = extractEditorText(editorElement);
    if (fullText.includes(rawSecret)) {
      const newFullText = fullText.replace(rawSecret, placeholder);
      if (typeof editableTarget.focus === 'function') {
        editableTarget.focus();
      }

      const selection = window.getSelection();
      if (selection && typeof document.createRange === 'function') {
        const fullRange = document.createRange();
        fullRange.selectNodeContents(editableTarget);
        selection.removeAllRanges();
        selection.addRange(fullRange);

        document.dispatchEvent(new Event('selectionchange'));

        if (typeof document.execCommand === 'function') {
          const fullCmdRes = document.execCommand('insertText', false, newFullText);
          if (fullCmdRes && !extractEditorText(editorElement).includes(rawSecret)) {
            dispatchInputEvents(editableTarget, placeholder);
            return true;
          }
        }
      }
    }
  } catch {
    // Continue to DOM-level fallback
  }

  // Strategy D (DOM Node Mutation Fallback): If execCommand was not handled or failed in test/headless env
  if (span) {
    applyTextNodeReplacement(span, placeholder);
    const eventTarget = span.startNode.parentElement ?? editableTarget;
    dispatchInputEvents(eventTarget, placeholder);
    if (eventTarget !== editableTarget) {
      dispatchInputEvents(editableTarget, placeholder);
    }
    if (editableTarget !== editorElement && eventTarget !== editorElement) {
      dispatchInputEvents(editorElement, placeholder);
    }
    return true;
  }

  // Strategy E (Ultimate Fallback via setContentEditableText):
  try {
    const fullText = extractEditorText(editorElement);
    if (fullText.includes(rawSecret)) {
      const newFullText = fullText.replace(rawSecret, placeholder);
      setContentEditableText(editableTarget, newFullText);
      return !extractEditorText(editorElement).includes(rawSecret);
    }
  } catch {
    // Return false if all strategies exhausted
  }

  return false;
}
