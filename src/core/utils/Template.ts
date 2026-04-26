/**
 * Lightweight Template Engine
 * Tagged template literal for creating DOM elements from HTML strings
 */

export type TemplateResult = HTMLElement | DocumentFragment;

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
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
export function html(strings: TemplateStringsArray, ...values: any[]): HTMLElement {
  const template = document.createElement('template');

  const fullHTML = strings.reduce((acc, str, i) => {
    const value = values[i];
    let valStr = '';

    if (value instanceof HTMLElement || value instanceof DocumentFragment) {
      // Create a placeholder for DOM elements
      valStr = `<div data-au-placeholder="${i}"></div>`;
    } else if (Array.isArray(value)) {
      // Handle arrays of elements or strings
      valStr = value.map((v, j) => {
        if (v instanceof HTMLElement || v instanceof DocumentFragment) {
          return `<div data-au-placeholder="${i}-${j}"></div>`;
        }
        // Sanitize string values in arrays
        return v !== undefined && v !== null ? escapeHtml(String(v)) : '';
      }).join('');
    } else if (typeof value === 'string') {
      // XSS PROTECTION: Sanitize string values
      valStr = escapeHtml(value);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      // Numbers and booleans are safe
      valStr = String(value);
    } else {
      // Other types - convert to string and sanitize
      valStr = value !== undefined && value !== null ? escapeHtml(String(value)) : '';
    }

    return acc + str + valStr;
  }, '');

  template.innerHTML = fullHTML.trim();
  const fragment = template.content;

  // Replace placeholders with actual DOM elements
  // IMPORTANT: Clone elements to prevent moving them from their original location
  values.forEach((value, i) => {
    if (value instanceof HTMLElement) {
      const placeholder = fragment.querySelector(`[data-au-placeholder="${i}"]`);
      if (placeholder && placeholder.parentNode) {
        // Clone the element to prevent memory leak (moving elements)
        const cloned = value.cloneNode(true) as HTMLElement;
        placeholder.parentNode.replaceChild(cloned, placeholder);
      }
    } else if (value instanceof DocumentFragment) {
      const placeholder = fragment.querySelector(`[data-au-placeholder="${i}"]`);
      if (placeholder && placeholder.parentNode) {
        // DocumentFragment can only be appended once, so clone it
        const cloned = document.createDocumentFragment();
        Array.from(value.childNodes).forEach(node => {
          cloned.appendChild(node.cloneNode(true));
        });
        placeholder.parentNode.replaceChild(cloned, placeholder);
      }
    } else if (Array.isArray(value)) {
      value.forEach((v, j) => {
        if (v instanceof HTMLElement) {
          const placeholder = fragment.querySelector(`[data-au-placeholder="${i}-${j}"]`);
          if (placeholder && placeholder.parentNode) {
            const cloned = v.cloneNode(true) as HTMLElement;
            placeholder.parentNode.replaceChild(cloned, placeholder);
          }
        } else if (v instanceof DocumentFragment) {
          const placeholder = fragment.querySelector(`[data-au-placeholder="${i}-${j}"]`);
          if (placeholder && placeholder.parentNode) {
            const cloned = document.createDocumentFragment();
            Array.from(v.childNodes).forEach(node => {
              cloned.appendChild(node.cloneNode(true));
            });
            placeholder.parentNode.replaceChild(cloned, placeholder);
          }
        }
      });
    }
  });

  // Handle multiple root elements
  if (fragment.children.length > 1) {
    const wrapper = document.createElement('div');
    wrapper.appendChild(fragment);
    return wrapper;
  }

  // Return first element or empty div if no elements
  const firstElement = fragment.firstElementChild as HTMLElement;
  if (!firstElement) {
    console.warn('[Template] No elements in template, returning empty div');
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
export function when(condition: any, trueContent: any, falseContent: any = ''): any {
  return condition ? trueContent : falseContent;
}
