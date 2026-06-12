/**
 * @file Sanitizer.ts
 * @description HTML-escaping utility to prevent XSS when inserting untrusted
 * strings into HTML *content*.
 *
 * NOTE: escape() is safe for text content (between tags). It does NOT escape
 * quotes, so do not use it for HTML attribute values — use the `html` tagged
 * template (Template.ts) for attribute interpolation instead.
 *
 * (The previous sanitize()/formatMultiline() helpers were removed: they were
 * unused dead code and sanitize() was bypassable, e.g. `java\tscript:`.)
 *
 * @see docs/SECURITY.md#sec-001
 */

export class Sanitizer {
  /**
   * Escapes a string for safe insertion into HTML content (`<`, `>`, `&` become
   * entity equivalents).
   */
  public static escape(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
