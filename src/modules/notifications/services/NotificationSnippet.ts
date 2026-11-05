/**
 * @file NotificationSnippet.ts
 * @description Reduces AniList activity markup to plain text for notification previews
 *
 * Activity text arrives as AniList markdown (`text(asHtml: false)`). Previews only need the
 * words, so media embeds, images, spoiler markers, HTML tags, heading, quote and list markers,
 * horizontal rules, code marks and emphasis are removed while their text is kept. Text that is only an embed yields an empty string.
 */

// A lookbehind, not a word boundary: an embed is often wrapped in _emphasis_.
const MEDIA_EMBED = /(?<![a-z0-9])(?:img\d*%?|webm|youtube)\([^)\s]*\)/gi;
const SPOILER_MARKERS = /~~~|~!|!~/g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
// Block tags separate words; inline tags sit inside them.
const HTML_BLOCK_TAG = /<\/?(?:br|p|div|h[1-6]|center|li|ul|ol|hr|blockquote)\b[^>]*>/gi;
const HTML_TAG = /<\/?[a-z][^>]*>/gi;
const MARKDOWN_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const HORIZONTAL_RULE = /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm;
const LINE_MARKER = /^[ \t]*(?:(?:#{1,6}|>)[ \t]*)+/gm;
const LIST_MARKER = /^[ \t]*(?:[-+*]|\d+\.)[ \t]+/gm;
const CODE_MARKER = /`+/g;
const STRIKE_OR_BOLD = /__|\*\*|~~/g;
// Emphasis opens after a non-word character and closes before one, so snake_case survives.
const EMPHASIS = /(^|\W)([_*])(?=\S)([^_*\n]*?\S)\2(?!\w)/g;
const ESCAPED_MARKER = /\\([\\`*_[\]()#+\-.!~>])/g;
const HTML_ENTITY = /&(?:(amp|lt|gt|quot|apos|nbsp)|#(\d{1,6})|#x([\da-f]{1,6}));/gi;
// Escaped markers are parked in the private use area so no later step reads them as markup.
const PARKED_OFFSET = 0xe000;
const PARKED_MARKER = /[\ue000-\ue07f]/g;
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
const WHITESPACE = /\s+/g;
const MAX_CODE_POINT = 0x10ffff;

/** Decodes the entities AniList leaves in markup. The result is only ever used as text. */
function decodeEntity(match: string, name?: string, decimal?: string, hex?: string): string {
  if (name) return NAMED_ENTITIES[name.toLowerCase()];
  const code = decimal ? Number(decimal) : parseInt(hex ?? '', 16);
  return code > 0 && code <= MAX_CODE_POINT ? String.fromCodePoint(code) : match;
}

/** Plain-text preview of one activity body. Never throws; empty when nothing readable remains. */
export function plainActivityText(raw: string): string {
  if (typeof raw !== 'string' || !raw) return '';
  let text = raw
    .replace(ESCAPED_MARKER, (_, marker: string) =>
      String.fromCharCode(PARKED_OFFSET + marker.charCodeAt(0))
    )
    .replace(HTML_COMMENT, '')
    .replace(MEDIA_EMBED, '')
    .replace(MARKDOWN_IMAGE, '')
    .replace(SPOILER_MARKERS, '')
    .replace(HTML_BLOCK_TAG, ' ')
    .replace(HTML_TAG, '')
    .replace(MARKDOWN_LINK, '$1')
    .replace(HORIZONTAL_RULE, '')
    .replace(LINE_MARKER, '')
    .replace(LIST_MARKER, '')
    .replace(CODE_MARKER, '')
    .replace(STRIKE_OR_BOLD, '');
  // Emphasis can nest (e.g. _*x*_), so strip until nothing changes.
  for (let previous = ''; previous !== text; ) {
    previous = text;
    text = text.replace(EMPHASIS, '$1$3');
  }
  return text
    .replace(PARKED_MARKER, (marker) => String.fromCharCode(marker.charCodeAt(0) - PARKED_OFFSET))
    .replace(HTML_ENTITY, decodeEntity)
    .replace(WHITESPACE, ' ')
    .trim();
}
