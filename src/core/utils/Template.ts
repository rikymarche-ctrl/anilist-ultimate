import { logger } from '@core/logger';
import { assertTemplateAttributeSafe, BOOLEAN_TEMPLATE_ATTRIBUTES } from './TemplatePolicy';
/**
 * @file Template.ts
 * @description Lightweight tagged-template engine for safe DOM element creation
 *
 * Provides the `html` tagged template literal which:
 *   - Inserts dynamic strings as text / attribute values after parsing static markup
 *   - Passes through numbers and booleans safely
 *   - Clones HTMLElement/DocumentFragment bindings without moving originals
 *   - Handles arrays of mixed elements/strings
 *   - Returns a single HTMLElement (wraps multiple roots in a div)
 *
 * Also exports `map()` and `when()` helpers for declarative rendering.
 * Literal markup and supplied DOM nodes are trusted application code. Dynamic
 * attribute names/code contexts are rejected; bare attributes support only the
 * listed boolean names. URL bindings allow HTTP(S) and relative web URLs.
 * Inline CSS values must still be validated for their CSS context by the caller.
 *
 * @example
 *   const el = html`<div class="card">${title}</div>`;
 *
 * @see docs/ARCHITECTURE.md#template-engine
 */

export type TemplateResult = HTMLElement | DocumentFragment;

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

/**
 * html tagged template literal
 * Usage: const el = html`<div>${content}</div>`;
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): HTMLElement {
  const template = document.createElement('template');
  const prefix = `au-value-${crypto.randomUUID()}-`;
  const tokenPattern = `${prefix}(\\d+)-end`;
  const matches = (text: string) => [...text.matchAll(new RegExp(`(?:<!--)?${tokenPattern}(?:-->)?`, 'g'))];
  const seen = new Set<number>();
  const binding = (index: number): unknown => {
    if (index >= values.length || seen.has(index)) throw new TypeError('Unsafe or duplicate template binding');
    seen.add(index);
    return values[index];
  };

  // Attribute markers contain no HTML delimiters. Content markers are comments so
  // select/table parsing preserves their position instead of discarding or fostering divs.
  let inTag = false;
  let quote = '';
  let inComment = false;
  let markup = '';
  strings.forEach((chunk, index) => {
    for (let offset = 0; offset < chunk.length; offset++) {
      if (inComment) {
        if (chunk.startsWith('-->', offset)) { inComment = false; offset += 2; }
      } else if (quote) {
        if (chunk[offset] === quote) quote = '';
      } else if (chunk.startsWith('<!--', offset)) {
        inComment = true;
        offset += 3;
      } else if (inTag) {
        if (chunk[offset] === '"' || chunk[offset] === "'") quote = chunk[offset];
        else if (chunk[offset] === '>') inTag = false;
      } else if (chunk[offset] === '<') {
        inTag = true;
      }
    }
    markup += chunk;
    if (index < values.length) {
      const token = `${prefix}${index}-end`;
      markup += inTag ? token : `<!--${token}-->`;
    }
  });
  template.innerHTML = markup.trim();

  const scalar = (value: unknown): string => {
    if (value instanceof HTMLElement || value instanceof DocumentFragment) {
      throw new TypeError('Unsafe DOM binding in a template attribute');
    }
    if (Array.isArray(value)) return value.map(scalar).join('');
    return value === undefined || value === null ? '' : String(value);
  };
  const appendValue = (target: DocumentFragment, value: unknown): void => {
    if (value instanceof HTMLElement || value instanceof DocumentFragment) {
      target.appendChild(value.cloneNode(true));
    } else if (Array.isArray(value)) {
      // Preserve the established flat array contract; nested arrays stringify as data.
      value.forEach(item => {
        if (Array.isArray(item)) target.appendChild(document.createTextNode(String(item)));
        else appendValue(target, item);
      });
    } else if (value !== undefined && value !== null) {
      target.appendChild(document.createTextNode(String(value)));
    }
  };
  const process = (fragment: DocumentFragment): void => {
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
    const nodes: Node[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    // Snapshot before inserting trusted DOM bindings, which are already rendered.
    for (const node of nodes) {
      if (node instanceof Element) {
        if (node.localName.includes(prefix)) throw new TypeError('Unsafe dynamic template tag');
        for (const attribute of [...node.attributes]) {
          const nameMatches = matches(attribute.name);
          if (nameMatches.length) {
            if (nameMatches.length !== 1 || nameMatches[0][0] !== attribute.name || attribute.value !== '') {
              throw new TypeError('Unsafe dynamic template attribute name');
            }
            const name = scalar(binding(Number(nameMatches[0][1])));
            node.removeAttribute(attribute.name);
            if (name !== '') {
              if (!BOOLEAN_TEMPLATE_ATTRIBUTES.has(name)) throw new TypeError('Unsafe dynamic template boolean attribute');
              node.setAttribute(name, '');
            }
            continue;
          }
          const valueMatches = matches(attribute.value);
          if (!valueMatches.length) continue;
          let value = attribute.value;
          // Function replacer: bound text must never be parsed for $-patterns ($$, $&, $`, $').
          for (const match of valueMatches) value = value.replace(match[0], () => scalar(binding(Number(match[1]))));
          assertTemplateAttributeSafe(node, attribute.name, value);
          node.setAttribute(attribute.name, value);
        }
        if (node instanceof HTMLTemplateElement) process(node.content);
      } else if (node.nodeType === Node.COMMENT_NODE) {
        const found = matches(node.textContent || '');
        if (!found.length) continue;
        if (found.length !== 1 || node.textContent !== found[0][0]) throw new TypeError('Unsafe dynamic template comment');
        const replacement = document.createDocumentFragment();
        appendValue(replacement, binding(Number(found[0][1])));
        node.parentNode?.replaceChild(replacement, node);
      } else {
        const text = node.textContent || '';
        const found = matches(text);
        if (!found.length) continue;
        if (node.parentElement && ['script', 'style'].includes(node.parentElement.localName)) {
          throw new TypeError('Unsafe dynamic template code content');
        }
        const replacement = document.createDocumentFragment();
        let offset = 0;
        for (const match of found) {
          replacement.appendChild(document.createTextNode(text.slice(offset, match.index)));
          appendValue(replacement, binding(Number(match[1])));
          offset = (match.index || 0) + match[0].length;
        }
        replacement.appendChild(document.createTextNode(text.slice(offset)));
        node.parentNode?.replaceChild(replacement, node);
      }
    }
  };
  const fragment = template.content;
  process(fragment);
  if (seen.size !== values.length) throw new TypeError('Unsafe or unsupported template interpolation context');

  if (fragment.children.length > 1) {
    const wrapper = document.createElement('div');
    wrapper.appendChild(fragment);
    return wrapper;
  }
  const firstElement = fragment.firstElementChild as HTMLElement | null;
  if (!firstElement) {
    logger.warn('[Template] No elements in template, returning empty div');
    return document.createElement('div');
  }
  return firstElement;
}

/**
 * Helper to render an array of items
 */
export function map<T>(items: T[], callback: (item: T, index: number) => TemplateResult | string): (TemplateResult | string)[] {
  return items.map(callback);
}

/**
 * Helper to render conditionally
 */
export function when<T>(condition: unknown, trueContent: T): T | '';
export function when<T, F>(condition: unknown, trueContent: T, falseContent: F): T | F;
export function when(condition: unknown, trueContent: unknown, falseContent: unknown = ''): unknown {
  return condition ? trueContent : falseContent;
}
