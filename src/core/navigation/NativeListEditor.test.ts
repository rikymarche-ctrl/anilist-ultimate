import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNativeListEditorBridge, openNativeListEditor } from './NativeListEditor';

const releases: Array<() => void> = [];
afterEach(() => { releases.splice(0).forEach(release => release()); document.body.replaceChildren(); });

function setup(dispatch = vi.fn().mockResolvedValue(undefined)) {
  const app = document.createElement('div'); app.id = 'app';
  Object.assign(app, { __vue__: { $store: { dispatch } } });
  document.body.append(app);
  releases.push(installNativeListEditorBridge());
  return dispatch;
}

describe('AniList native editor bridge', () => {
  it('uses only the native open action with the requested work', () => {
    const dispatch = setup();
    openNativeListEditor(30013);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('medialistEditor/open', 30013);
  });

  it.each([0, -1, 1.5, NaN, Infinity, 2147483648])('rejects invalid media IDs (%s)', mediaId => {
    const dispatch = setup();
    expect(() => openNativeListEditor(mediaId)).toThrow('Invalid AniList media ID');
    document.dispatchEvent(new CustomEvent('au:open-native-list-editor', { detail: mediaId }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('reports an unavailable bridge instead of silently doing nothing', () => {
    expect(() => openNativeListEditor(10)).toThrow('AniList editor is unavailable');
    releases.push(installNativeListEditorBridge());
    expect(() => openNativeListEditor(10)).toThrow('AniList editor is unavailable');
  });

  it('contains synchronous store failures and supports teardown', () => {
    const dispatch = setup(vi.fn(() => { throw new Error('Site unavailable'); }));
    expect(() => openNativeListEditor(10)).toThrow('AniList editor is unavailable');
    releases.pop()!(); dispatch.mockClear();
    expect(() => openNativeListEditor(10)).toThrow('AniList editor is unavailable');
    expect(dispatch).not.toHaveBeenCalled();
  });
});
