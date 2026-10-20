import { describe, expect, it } from 'vitest';
import { cssImageUrl, parseWebUrl } from './WebUrl';

describe('web URL and CSS image bindings', () => {
  it('canonicalizes only web URL schemes and relative URLs', () => {
    expect(parseWebUrl('/icons/icon48.png')?.href).toBe('https://anilist.co/icons/icon48.png');
    expect(parseWebUrl('//example.com/a b.png')?.href).toBe('https://example.com/a%20b.png');
    expect(parseWebUrl('http://example.com/a')?.protocol).toBe('http:');
  });
  it.each(['javascript:alert(1)', 'java\tscript:alert(1)', 'data:image/svg+xml,<svg/>', 'file:///C:/secret', 'https://[invalid', ''])('rejects non-web or invalid image URLs: %s', value => {
    expect(parseWebUrl(value)).toBeNull(); expect(cssImageUrl(value)).toBe('none');
  });
  it('keeps quote/semicolon payloads inside one background image value', () => {
    const element = document.createElement('div');
    element.style.backgroundImage = cssImageUrl("https://example.com/x'); color:red; background-image:url('https://evil.invalid/')");
    expect(element.style.color).toBe(''); expect(element.style.length).toBe(1);
    expect(element.style.backgroundImage).toContain('example.com');
  });
  it('does not coerce malformed values into apparently valid image paths', () => {
    for (const value of [null, undefined, 7, [], { toString: () => 'https://example.com/a' }]) {
      expect(parseWebUrl(value)).toBeNull(); expect(cssImageUrl(value)).toBe('none');
    }
  });
});
