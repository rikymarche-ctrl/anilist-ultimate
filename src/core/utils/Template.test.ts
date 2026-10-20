import { describe, it, expect } from 'vitest';
import { html, escapeHtml, map, when } from './Template';

describe('escapeHtml', () => {
  it('escapes all HTML-sensitive characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#039;');
  });

  it('leaves safe text untouched', () => {
    expect(escapeHtml('Hello 123')).toBe('Hello 123');
  });
});

describe('html tagged template', () => {
  it('auto-escapes interpolated strings (XSS protection)', () => {
    const el = html`<div>${'<img src=x onerror=alert(1)>'}</div>`;
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('renders numbers and booleans without escaping', () => {
    expect(html`<div>${42}</div>`.textContent).toBe('42');
    expect(html`<div>${true}</div>`.textContent).toBe('true');
  });

  it('embeds a real HTMLElement (cloned, original untouched)', () => {
    const child = document.createElement('span');
    child.textContent = 'hi';
    const el = html`<div>${child}</div>`;
    expect(el.querySelector('span')?.textContent).toBe('hi');
    // The original node was not moved into the new tree.
    expect(child.parentElement).toBeNull();
  });

  it('escapes each string in an interpolated array', () => {
    const el = html`<ul>
      ${['<b>x</b>', 'plain']}
    </ul>`;
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toContain('<b>x</b>');
    expect(el.textContent).toContain('plain');
  });

  it('wraps multiple root elements in a container div', () => {
    const el = html`<span>a</span><span>b</span>`;
    expect(el.querySelectorAll('span').length).toBe(2);
  });

  it('renders null/undefined interpolations as empty', () => {
    expect(html`<div>${null}${undefined}</div>`.textContent).toBe('');
  });

  it('does not let an unquoted attribute value introduce an event handler', () => {
    const value = 'hello onmouseover=alert(1)';
    const el = html`<div title=${value}></div>`;
    expect(el.hasAttribute('onmouseover')).toBe(false);
    expect(el.getAttribute('title')).toBe(value);
  });

  it.each(['javascript:alert(1)', 'java\tscript:alert(1)', '\nJAVASCRIPT:alert(1)', 'data:text/html,<script>alert(1)</script>'])('rejects executable navigation URLs: %s', value => {
    expect(() => html`<a href="${value}">link</a>`).toThrow(/unsafe/i);
  });

  it('rejects dynamic event code and iframe documents', () => {
    expect(() => html`<button onclick="${'alert(1)'}">go</button>`).toThrow(/unsafe/i);
    expect(() => html`<iframe srcdoc="${'<script>alert(1)</script>'}"></iframe>`).toThrow(/unsafe/i);
  });

  it('does not confuse caller markup with a DOM interpolation placeholder', () => {
    const child = document.createElement('span');
    child.textContent = 'child';
    const el = html`<div><i data-au-placeholder="0">original</i>${child}</div>`;
    expect(el.querySelector('i')?.textContent).toBe('original');
    expect(el.children[1]?.textContent).toBe('child');
  });

  it('retains DOM children inside select and table parser contexts', () => {
    const option = html`<option value="a">A</option>`;
    const row = html`<tr><td>Cell</td></tr>`;
    const optionParent = option.parentNode;
    const rowParent = row.parentNode;
    expect(html`<select>${option}</select>`.querySelector('option')?.value).toBe('a');
    expect(html`<table><tbody>${row}</tbody></table>`.querySelector('td')?.textContent).toBe('Cell');
    expect(option.parentNode).toBe(optionParent);
    expect(row.parentNode).toBe(rowParent);
  });

  it('supports existing conditional boolean attributes without accepting arbitrary markup', () => {
    expect((html`<input ${when(true, 'checked')}>` as HTMLInputElement).checked).toBe(true);
    expect((html`<input ${when(false, 'checked')}>` as HTMLInputElement).checked).toBe(false);
    expect(() => html`<input ${'onclick=alert(1)'}>`).toThrow(/unsafe/i);
  });

  it('validates the complete URL after partial interpolation and entity decoding', () => {
    expect(() => html`<a href="${'java'}script:alert(1)">go</a>`).toThrow(/unsafe/i);
    expect(() => html`<a href="javascript&#58;${'alert(1)'}">go</a>`).toThrow(/unsafe/i);
    expect(html`<a href="https://anilist.co/user/${'hello world'}">go</a>`.getAttribute('href')).toBe('https://anilist.co/user/hello world');
    expect(html`<img src="${'/icons/icon48.png'}">`.getAttribute('src')).toBe('/icons/icon48.png');
    expect(html`<a href="${'//example.com/path'}">go</a>`.getAttribute('href')).toBe('//example.com/path');
  });

  it('keeps quotes, markup, Unicode and ampersands as literal attribute data', () => {
    const value = '" onmouseover=alert(1) <img> &quot; 日本語';
    const el = html`<input value="${value}" title='${value}'>` as HTMLInputElement;
    expect(el.value).toBe(value);
    expect(el.getAttribute('title')).toBe(value);
    expect(el.hasAttribute('onmouseover')).toBe(false);
  });

  it('inserts attribute values containing String.replace patterns literally', () => {
    const first = 'Top $$ & $&';
    const second = "$` and $'";
    const el = html`<span title="${first} / ${second}">x</span>`;
    expect(el.getAttribute('title')).toBe(`${first} / ${second}`);
  });

  it('rejects unsupported code, tag, comment and attribute-name interpolation', () => {
    expect(() => html`<script>${'alert(1)'}</script>`).toThrow(/unsafe/i);
    expect(() => html`<style>${'body { display: none }'}</style>`).toThrow(/unsafe/i);
    expect(() => html`<script src="${'https://example.com/a.js'}"></script>`).toThrow(/unsafe/i);
    expect(() => html`<${'img'}>`).toThrow(/unsafe/i);
    expect(() => html`<div data-${'name'}="x"></div>`).toThrow(/unsafe/i);
    expect(() => html`<div><!-- ${'comment'} --></div>`).toThrow(/unsafe/i);
    expect(() => html`<img srcset="${'a 1x, b 2x'}">`).toThrow(/unsafe/i);
  });

  it('renders array fragments, preserves originals and handles nested template content', () => {
    const child = document.createElement('span');
    child.textContent = 'child';
    const fragment = document.createDocumentFragment();
    fragment.appendChild(child);
    const el = html`<div>${['<b>literal</b>', fragment, null, 0]}<template>${'inside'}</template></div>`;
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toBe('<b>literal</b>child0');
    expect(fragment.firstChild).toBe(child);
    expect(el.querySelector('template')?.content.textContent).toBe('inside');
  });

  it('sets textarea contents as text without interpreting data as markup', () => {
    const value = '</textarea><img src=x onerror=alert(1)> &amp;';
    const el = html`<textarea>${value}</textarea>` as HTMLTextAreaElement;
    expect(el.value).toBe(value);
    expect(el.querySelector('img')).toBeNull();
  });
});

describe('when', () => {
  it('returns the true branch for truthy conditions', () => {
    expect(when(true, 'yes', 'no')).toBe('yes');
    expect(when(1, 'yes', 'no')).toBe('yes');
  });

  it('returns the false branch (default empty string) for falsy conditions', () => {
    expect(when(false, 'yes', 'no')).toBe('no');
    expect(when(0, 'yes')).toBe('');
  });
});

describe('map', () => {
  it('maps items via the callback', () => {
    // map's callback returns string | TemplateResult.
    expect(map([1, 2, 3], (x) => String(x * 2))).toEqual(['2', '4', '6']);
  });

  it('passes the index to the callback', () => {
    expect(map(['a', 'b'], (_, i) => String(i))).toEqual(['0', '1']);
  });
});
