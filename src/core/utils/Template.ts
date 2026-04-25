/**
 * Lightweight Template Engine
 * Tagged template literal for creating DOM elements from HTML strings
 */

export type TemplateResult = HTMLElement | DocumentFragment;

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
        return v !== undefined && v !== null ? v : '';
      }).join('');
    } else {
      valStr = value !== undefined && value !== null ? value : '';
    }
    
    return acc + str + valStr;
  }, '');

  template.innerHTML = fullHTML.trim();
  const fragment = template.content;

  // Replace placeholders with actual DOM elements
  values.forEach((value, i) => {
    if (value instanceof HTMLElement || value instanceof DocumentFragment) {
      const placeholder = fragment.querySelector(`[data-au-placeholder="${i}"]`);
      if (placeholder) {
        placeholder.parentNode?.replaceChild(value, placeholder);
      }
    } else if (Array.isArray(value)) {
      value.forEach((v, j) => {
        if (v instanceof HTMLElement || v instanceof DocumentFragment) {
          const placeholder = fragment.querySelector(`[data-au-placeholder="${i}-${j}"]`);
          if (placeholder) {
            placeholder.parentNode?.replaceChild(v, placeholder);
          }
        }
      });
    }
  });

  if (fragment.children.length > 1) {
    const wrapper = document.createElement('div');
    wrapper.appendChild(fragment);
    return wrapper;
  }

  return fragment.firstElementChild as HTMLElement;
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
