import { afterEach, describe, expect, it } from 'vitest';
import { isExtensionPageUrl } from './ExtensionPage';

const runtime = chrome.runtime as unknown as { id?: string; getURL: (path: string) => string };
const originalGetURL = runtime.getURL;

describe('isExtensionPageUrl', () => {
  afterEach(() => {
    runtime.getURL = originalGetURL;
    delete runtime.id;
  });

  it('accepts Chromium pages of this extension and rejects other extensions', () => {
    runtime.id = 'abc';
    runtime.getURL = (path) => `chrome-extension://abc${path}`;
    expect(isExtensionPageUrl('chrome-extension://abc/settings.html')).toBe(true);
    expect(isExtensionPageUrl('chrome-extension://other/settings.html')).toBe(false);
  });

  it('accepts Firefox pages whose host is the per-install UUID, not runtime.id', () => {
    runtime.id = 'anilist-ultimate@exastra';
    runtime.getURL = (path) => `moz-extension://1b2c3d4e-0000-4000-8000-123456789abc${path}`;
    expect(
      isExtensionPageUrl('moz-extension://1b2c3d4e-0000-4000-8000-123456789abc/popup.html')
    ).toBe(true);
    expect(
      isExtensionPageUrl('moz-extension://ffffffff-0000-4000-8000-123456789abc/popup.html')
    ).toBe(false);
    expect(isExtensionPageUrl('chrome-extension://anilist-ultimate@exastra/popup.html')).toBe(
      false
    );
  });

  it('rejects web pages, missing and malformed URLs', () => {
    runtime.id = 'abc';
    runtime.getURL = (path) => `chrome-extension://abc${path}`;
    expect(isExtensionPageUrl('https://anilist.co/home')).toBe(false);
    expect(isExtensionPageUrl(undefined)).toBe(false);
    expect(isExtensionPageUrl('not a url')).toBe(false);
  });
});
