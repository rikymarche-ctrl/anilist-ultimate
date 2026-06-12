import { describe, it, expect } from 'vitest';
import { Sanitizer } from './Sanitizer';

describe('Sanitizer.escape', () => {
  it('escapes angle brackets and ampersands', () => {
    expect(Sanitizer.escape('<script>')).toBe('&lt;script&gt;');
    expect(Sanitizer.escape('a & b')).toBe('a &amp; b');
  });

  it('neutralizes an injected element so it cannot render as markup', () => {
    const out = Sanitizer.escape('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('returns an empty string for empty input', () => {
    expect(Sanitizer.escape('')).toBe('');
  });

  it('leaves plain text unchanged', () => {
    expect(Sanitizer.escape('Hello world 123')).toBe('Hello world 123');
  });
});
