import { describe, expect, it } from 'vitest';
import { viewerResponse } from './ViewerResponse';

const response = () => ({ Viewer: { id: 7, name: 'User', avatar: { medium: 'https://s4.anilist.co/a.png' },
  options: { titleLanguage: 'ROMAJI' }, mediaListOptions: { scoreFormat: 'POINT_100', rowOrder: 'title' } } });

describe('Viewer projection', () => {
  it.each([null, undefined, {}, [], { Viewer: null }, { Viewer: [] }])('rejects invalid envelopes %j', value => {
    expect(() => viewerResponse(value)).toThrow('Invalid Viewer response');
  });
  it.each([0, -1, 1.5, NaN, Infinity, 2147483648, '7', null])('rejects invalid GraphQL identity %j', id => {
    expect(() => viewerResponse({ Viewer: { ...response().Viewer, id } })).toThrow();
  });
  it.each(['name', 'avatar', 'options', 'mediaListOptions'])('requires queried field %s', field => {
    const viewer: Record<string, unknown> = response().Viewer; delete viewer[field];
    expect(() => viewerResponse({ Viewer: viewer })).toThrow();
  });
  it.each(['ROMAJI', 'ENGLISH', 'NATIVE', 'ROMAJI_STYLISED', 'ENGLISH_STYLISED', 'NATIVE_STYLISED'])('accepts official title enum %s', titleLanguage => {
    expect(viewerResponse({ Viewer: { ...response().Viewer, options: { titleLanguage } } }).options?.titleLanguage).toBe(titleLanguage);
  });
  it.each(['POINT_100', 'POINT_10_DECIMAL', 'POINT_10', 'POINT_5', 'POINT_3'])('preserves official scoring enum %s', scoreFormat => {
    expect(viewerResponse({ Viewer: { ...response().Viewer, mediaListOptions: { scoreFormat, rowOrder: 'updatedTime' } } }).mediaListOptions?.scoreFormat).toBe(scoreFormat);
  });
  it.each(['javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///c:/a.png'])('rejects non-web avatar %s', medium => {
    expect(() => viewerResponse({ Viewer: { ...response().Viewer, avatar: { medium } } })).toThrow();
  });
  it('accepts a provisional OAuth identity and rejects another known owner', () => {
    expect(viewerResponse(response(), null).id).toBe(7);
    expect(viewerResponse(response(), 7).id).toBe(7);
    expect(() => viewerResponse(response(), 8)).toThrow();
  });
  it('normalizes explicit nullable containers without inventing preferences', () => {
    expect(viewerResponse({ Viewer: { id: 7, name: 'User', avatar: null, options: null, mediaListOptions: null } })).toEqual({ id: 7, name: 'User', avatar: { medium: '' } });
    expect(viewerResponse({ Viewer: { id: 7, name: 'User', avatar: { medium: null }, options: { titleLanguage: null }, mediaListOptions: { scoreFormat: null, rowOrder: null } } })).toEqual({ id: 7, name: 'User', avatar: { medium: '' } });
    expect(viewerResponse({ Viewer: { ...response().Viewer, mediaListOptions: { scoreFormat: 'POINT_5', rowOrder: null } } }).mediaListOptions).toEqual({ scoreFormat: 'POINT_5', rowOrder: '' });
  });
  it('validates row order even when nullable score format omits preferences', () => {
    expect(() => viewerResponse({ Viewer: { ...response().Viewer, mediaListOptions: { scoreFormat: null, rowOrder: {} } } })).toThrow();
  });
  it('projects only selected fields and detaches nested values', () => {
    const original = response(); Object.assign(original.Viewer, { secret: 'unqueried' }); Object.assign(original.Viewer.avatar, { large: 'unqueried' });
    const projected = viewerResponse(original); original.Viewer.avatar.medium = 'changed';
    expect(projected).not.toHaveProperty('secret'); expect(projected.avatar).toEqual({ medium: 'https://s4.anilist.co/a.png' });
  });
});
