import { describe, expect, it } from 'vitest';
import { ModuleLoader } from './ModuleLoader';

describe('module page matchers', () => {
  it('matches nested routes without also matching a different route with the same prefix', () => {
    const matches = ModuleLoader.pageMatches('/user/*', '/home');
    expect(matches('/user')).toBe(true);
    expect(matches('/user/Fixture')).toBe(true);
    expect(matches('/user/Fixture/animelist')).toBe(true);
    expect(matches('/users/Fixture')).toBe(false);
    expect(matches('/username')).toBe(false);
    expect(matches('/home')).toBe(true);
    expect(matches('/homepage')).toBe(false);
  });
  it.each(['g', 'y'])('rechecks a %s regex deterministically without changing the original lastIndex', flags => {
    const pattern = new RegExp('^/user/.+', flags);
    pattern.lastIndex = 8;
    const matches = ModuleLoader.pageMatchesRegex(pattern);
    expect(matches('/user/Fixture')).toBe(true);
    expect(matches('/user/Fixture')).toBe(true);
    expect(matches('/anime/42')).toBe(false);
    expect(matches('/user/Another')).toBe(true);
    expect(pattern.lastIndex).toBe(8);
  });
});
