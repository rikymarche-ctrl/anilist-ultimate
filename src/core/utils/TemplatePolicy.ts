import { parseWebUrl } from './WebUrl';
/** Policies for dynamic template bindings. Literal markup and supplied DOM nodes are trusted code. */
const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href', 'cite', 'background', 'data']);
const CODE_ELEMENTS = new Set(['script', 'object', 'embed']);

export const BOOLEAN_TEMPLATE_ATTRIBUTES = new Set([
  'checked', 'selected', 'disabled', 'readonly', 'multiple', 'required', 'hidden',
  'autofocus', 'open', 'controls', 'muted', 'loop', 'reversed', 'async', 'defer',
]);

export function assertTemplateAttributeSafe(element: Element, name: string, value: string): void {
  const attribute = name.toLowerCase();
  if (attribute.startsWith('on') || attribute === 'srcdoc' || attribute === 'srcset'
    || attribute === 'ping' || CODE_ELEMENTS.has(element.localName)) {
    throw new TypeError(`Unsafe dynamic template attribute: ${attribute}`);
  }
  if (!URL_ATTRIBUTES.has(attribute) || value === '') return;
  // Validate schemes against a fixed HTTPS base; relative bindings still resolve in the caller's document.
  if (parseWebUrl(value)) return;
  throw new TypeError(`Unsafe dynamic template URL: ${attribute}`);
}
