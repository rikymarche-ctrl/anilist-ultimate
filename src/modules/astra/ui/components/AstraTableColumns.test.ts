import { describe, expect, it } from 'vitest';
import { sectionColumnWidth, sectionColumnsStyle } from './AstraTableColumns';

describe('Astra table section columns', () => {
  it('keeps short labels at the minimum readable width', () => {
    expect(sectionColumnWidth('Story')).toBe(96);
    expect(sectionColumnWidth('')).toBe(96);
  });

  it('widens tracks for long labels so the header does not overflow', () => {
    expect(sectionColumnWidth('Consistency')).toBeGreaterThan(sectionColumnWidth('Characters'));
    expect(sectionColumnWidth('Characters')).toBeGreaterThan(96);
  });

  it('caps very long labels, leaving the rest to the CSS ellipsis', () => {
    expect(sectionColumnWidth('A'.repeat(80))).toBe(168);
  });

  it('ignores surrounding whitespace', () => {
    expect(sectionColumnWidth('  Consistency  ')).toBe(sectionColumnWidth('Consistency'));
  });

  it('declares one fixed track per section, in order', () => {
    const style = sectionColumnsStyle([{ name: 'Story' }, { name: 'Consistency' }]);
    expect(style).toBe(`--astra-dynamic-cols: 96px ${sectionColumnWidth('Consistency')}px`);
  });

  it('emits no declaration without sections so the CSS fallback stays valid', () => {
    expect(sectionColumnsStyle([])).toBe('');
  });
});
