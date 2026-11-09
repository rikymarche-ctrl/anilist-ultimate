import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, parsePrefs } from './WatchOrderPrefs';

describe('parsePrefs', () => {
  it('falls back to defaults for missing or corrupted storage', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{not json')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('[1,2]')).toEqual(DEFAULT_PREFS);
  });
  it('keeps valid fields and drops unknown values', () => {
    const prefs = parsePrefs(
      JSON.stringify({
        mode: 'map',
        posters: 'yes',
        hiddenKinds: ['SPIN_OFF', 'BOGUS', 42],
      })
    );
    expect(prefs).toMatchObject({
      mode: 'map',
      posters: false,
      hiddenKinds: ['SPIN_OFF'],
    });
    expect(parsePrefs(JSON.stringify({ mode: 'timeline' })).mode).toBeNull();
  });
  it('maps the four earlier views onto the two tabs', () => {
    const parse = (mode: string) => parsePrefs(JSON.stringify({ mode }));
    expect(parse('curated')).toMatchObject({ mode: 'list', releaseSort: false });
    expect(parse('story')).toMatchObject({ mode: 'list', releaseSort: false });
    expect(parse('release')).toMatchObject({ mode: 'list', releaseSort: true });
    expect(parse('map')).toMatchObject({ mode: 'map', releaseSort: false });
  });
});
