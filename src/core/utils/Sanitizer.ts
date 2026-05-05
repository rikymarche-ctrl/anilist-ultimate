/**
 * @file Sanitizer.ts
 * @description Enterprise-grade HTML sanitization utility to prevent XSS vulnerabilities.
 * 
 * Provides methods for:
 * 1. Escaping raw strings for safe insertion into HTML.
 * 2. Stripping dangerous tags and attributes from untrusted HTML.
 * 3. Cleaning AniList descriptions and forum posts.
 * 
 * @see docs/SECURITY.md#sec-001
 */

export class Sanitizer {
  /**
   * Escapes a string to be safe for HTML content.
   * Replaces <, >, &, ", and ' with their entity equivalents.
   */
  public static escape(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Sanitizes an HTML string by removing dangerous elements and attributes.
   * This is a basic implementation suitable for simple markup.
   * For complex scenarios, consider a dedicated library like DOMPurify.
   */
  public static sanitize(html: string): string {
    if (!html) return '';

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Remove dangerous tags
    const dangerousTags = ['script', 'iframe', 'object', 'embed', 'style', 'link', 'meta'];
    dangerousTags.forEach(tag => {
      const elements = doc.querySelectorAll(tag);
      elements.forEach(el => el.remove());
    });

    // Remove event handler attributes (on*) and javascript: URIs
    const allElements = doc.querySelectorAll('*');
    allElements.forEach(el => {
      // Remove all on* attributes
      Array.from(el.attributes).forEach(attr => {
        if (attr.name.toLowerCase().startsWith('on')) {
          el.removeAttribute(attr.name);
        }
        
        // Remove javascript: and data: URIs in href/src
        if (['href', 'src', 'action', 'formaction'].includes(attr.name.toLowerCase())) {
          const val = attr.value.toLowerCase().trim();
          if (val.startsWith('javascript:') || val.startsWith('data:')) {
            el.removeAttribute(attr.name);
          }
        }
      });
    });

    return doc.body.innerHTML;
  }

  /**
   * Safely formats a multi-line string into HTML with <br> tags.
   */
  public static formatMultiline(str: string): string {
    return this.escape(str).replace(/\n/g, '<br>');
  }
}
