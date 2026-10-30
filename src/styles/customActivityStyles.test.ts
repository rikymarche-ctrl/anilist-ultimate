/**
 * @file customActivityStyles.test.ts
 * @description Custom-feed rows are cleaned clones of native AniList rows, so
 * AniList's own CSS must lay them out. Any extension rule that resizes or moves
 * a native part of those rows makes them drift from the real feed.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const STYLES_DIR = join(process.cwd(), 'src', 'styles');
const NATIVE_PART =
  /^(\.activity-entry|\.wrap|\.list|\.cover|\.details|\.name|\.status|\.avatar|\.time|\.actions|\.action|\.like-wrap|\.text|\.markdown|\.title)\b/;
const LAYOUT_PROPS = new Set([
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height',
  'margin',
  'margin-top',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'padding',
  'padding-top',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'flex',
  'gap',
  'grid-template-columns',
  'font-size',
  'font-weight',
  'line-height',
  'background',
  'background-size',
  'border-radius',
]);

interface Rule {
  selector: string;
  props: string[];
}

const readRules = (css: string): Rule[] =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    ([, selector, body]) => ({
      selector: selector.trim(),
      props: body
        .split(';')
        .map((decl) => decl.split(':')[0].trim().toLowerCase())
        .filter(Boolean),
    })
  );

/** The last compound of the selector, when it hits a native element of a custom row. */
const nativeTarget = (selector: string): string | null => {
  if (!selector.includes('.au-custom-activity')) return null;
  const last = selector.split(/\s+|>/).filter(Boolean).pop() ?? '';
  if (
    /\.au-/.test(last.replace(/^\.au-custom-activity/, '')) ||
    /^a\.au-|iframe|img|video/.test(last)
  )
    return null;
  const part = last.replace(/^\.au-custom-activity/, '');
  return part === '' || NATIVE_PART.test(part) ? last : null;
};

describe('custom feed row styles', () => {
  it('never changes the layout of native parts of a cloned row', () => {
    const offenders = readdirSync(STYLES_DIR)
      .filter((file) => file.endsWith('.css'))
      .flatMap((file) =>
        readRules(readFileSync(join(STYLES_DIR, file), 'utf8')).flatMap(({ selector, props }) =>
          selector.split(',').flatMap((single) => {
            const target = nativeTarget(single.trim());
            const bad = target ? props.filter((prop) => LAYOUT_PROPS.has(prop)) : [];
            // Hiding the always-empty likers list is the one allowed exception.
            const allowed = /\.users$/.test(single.trim())
              ? bad.filter((p) => p !== 'display')
              : bad;
            return allowed.length ? [`${file}: ${single.trim()} { ${allowed.join(', ')} }`] : [];
          })
        )
      );
    expect(offenders).toEqual([]);
  });
});
