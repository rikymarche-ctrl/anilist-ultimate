/** Synthetic DOM/parser checks, bundled only for the isolated Chrome test. */
import 'reflect-metadata';
import { html, when } from '@core/utils/Template';
import { cssImageUrl } from '@core/utils/WebUrl';

export function runTemplateBrowserFixture(): string[] {
  const checks: string[] = [];
  const assert = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };
  const rejects = (render: () => HTMLElement): boolean => {
    try { render(); return false; } catch (error) { return error instanceof TypeError && /unsafe/i.test(error.message); }
  };
  const value = 'hello onmouseover=alert(1)';
  const attribute = html`<div title=${value}></div>`;
  assert(attribute.getAttribute('title') === value && !attribute.hasAttribute('onmouseover'), 'unquoted attribute must remain data');
  checks.push('unquoted dynamic attribute cannot add event code');

  for (const url of ['javascript:alert(1)', 'java\tscript:alert(1)', '\nJAVASCRIPT:alert(1)', 'data:text/html,<script>alert(1)</script>']) {
    assert(rejects(() => html`<a href="${url}">link</a>`), 'executable URL must be rejected');
  }
  assert(rejects(() => html`<a href="${'java'}script:alert(1)">go</a>`), 'complete URL must be validated');
  checks.push('URL schemes and partial URL bindings validated');

  assert(rejects(() => html`<button onclick="${'alert(1)'}">go</button>`), 'dynamic event code must be rejected');
  assert(rejects(() => html`<iframe srcdoc="${'<script>alert(1)</script>'}"></iframe>`), 'dynamic document must be rejected');
  assert(rejects(() => html`<script>${'alert(1)'}</script>`), 'dynamic script must be rejected');
  assert(rejects(() => html`<style>${'body { display:none }'}</style>`), 'dynamic stylesheet must be rejected');
  checks.push('dynamic code and iframe document contexts rejected');

  const literal = '</textarea><img src=x onerror=alert(1)> &amp; 日本語';
  const textarea = html`<textarea>${literal}</textarea>` as HTMLTextAreaElement;
  assert(textarea.value === literal && !textarea.querySelector('img'), 'textarea data must not become markup');
  const input = html`<input value="${'" onmouseover=alert(1) <img> &quot;'}">` as HTMLInputElement;
  assert(input.value === '" onmouseover=alert(1) <img> &quot;' && !input.hasAttribute('onmouseover'), 'quoted attributes must remain literal');
  checks.push('quoted values and textarea strings remain literal');

  const option = html`<option value="a">A</option>`;
  const optionParent = option.parentNode;
  const select = html`<select>${option}</select>` as HTMLSelectElement;
  const row = html`<tr><td>Cell</td></tr>`;
  const rowParent = row.parentNode;
  assert(select.options.length === 1 && select.value === 'a', 'select must retain option binding');
  assert(html`<table><tbody>${row}</tbody></table>`.querySelector('td')?.textContent === 'Cell', 'table must retain row binding');
  assert(option.parentNode === optionParent && row.parentNode === rowParent, 'bound nodes must be cloned');
  checks.push('native select/table parser contexts retain cloned DOM bindings');

  assert((html`<input ${when(true, 'checked')}>` as HTMLInputElement).checked, 'conditional checkbox checked');
  assert(!(html`<input ${when(false, 'checked')}>` as HTMLInputElement).checked, 'conditional checkbox unchecked');
  assert(rejects(() => html`<input ${'onclick=alert(1)'}>`), 'bare attribute injection must be rejected');
  checks.push('existing conditional boolean attributes preserved');

  const container = html`<div><i data-au-placeholder="0">original</i>${html`<span>child</span>`}<template>${'inside'}</template></div>`;
  assert(container.querySelector('i')?.textContent === 'original' && container.querySelector('span')?.textContent === 'child', 'literal placeholder names must not intercept a binding');
  assert(container.querySelector('template')?.content.textContent === 'inside', 'nested template bindings must resolve');
  checks.push('caller markup and nested template content retain correct ownership');
  const image = document.createElement('div');
  image.style.backgroundImage = cssImageUrl("https://example.com/x'); color:red; background-image:url('https://evil.invalid/')");
  assert(image.style.color === '' && image.style.length === 1 && image.style.backgroundImage.includes('example.com'), 'CSS image URLs must stay one declaration');
  image.style.backgroundImage = cssImageUrl('java\tscript:alert(1)');
  assert(image.style.backgroundImage === 'none', 'executable image URLs must be omitted');
  checks.push('CSS image URL bindings cannot introduce declarations or executable schemes');
  return checks;
}
