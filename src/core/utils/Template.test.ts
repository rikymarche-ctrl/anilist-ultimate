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
    expect(html`<div>${null as any}${undefined as any}</div>`.textContent).toBe('');
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
