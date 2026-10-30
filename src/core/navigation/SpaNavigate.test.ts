import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { interceptInternalLinks, navigateInApp } from './SpaNavigate';

function click(target: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('navigateInApp', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['//evil.example/x', 'https://evil.example/', '/\\evil.example', 'relative/path', ''])(
    'rejects non-internal path %j',
    (path) => {
      const push = vi.spyOn(history, 'pushState');
      expect(() => navigateInApp(path)).toThrow();
      expect(push).not.toHaveBeenCalled();
    }
  );

  it('pushes the path and fires a popstate event for AniList to render the route', () => {
    const push = vi.spyOn(history, 'pushState');
    const onPop = vi.fn();
    window.addEventListener('popstate', onPop);
    navigateInApp('/activity/12?x=1#top');
    expect(push).toHaveBeenCalledWith(null, '', '/activity/12?x=1#top');
    expect(onPop).toHaveBeenCalledTimes(1);
    expect(onPop.mock.calls[0][0]).toBeInstanceOf(PopStateEvent);
    window.removeEventListener('popstate', onPop);
  });
});

describe('interceptInternalLinks', () => {
  let container: HTMLElement;
  let cleanup: () => void;

  beforeEach(() => {
    history.replaceState(null, '', '/');
    container = document.createElement('div');
    document.body.append(container);
    cleanup = interceptInternalLinks(container);
  });
  afterEach(() => {
    cleanup();
    container.remove();
    vi.restoreAllMocks();
  });

  function link(href: string, attrs: Record<string, string> = {}): HTMLAnchorElement {
    const a = document.createElement('a');
    a.setAttribute('href', href);
    for (const [name, value] of Object.entries(attrs)) a.setAttribute(name, value);
    container.append(a);
    return a;
  }

  it('routes a same-origin link through the app router and prevents the reload', () => {
    const push = vi.spyOn(history, 'pushState');
    const event = click(link('/user/Alice/'));
    expect(event.defaultPrevented).toBe(true);
    expect(push).toHaveBeenCalledWith(null, '', '/user/Alice/');
  });

  it('keeps the query and hash of the target', () => {
    const push = vi.spyOn(history, 'pushState');
    click(link('/search?q=x#y'));
    expect(push).toHaveBeenCalledWith(null, '', '/search?q=x#y');
  });

  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])('leaves modified or non-primary clicks %j to the browser', (init) => {
    const push = vi.spyOn(history, 'pushState');
    const event = click(link('/user/Alice/'), init);
    expect(event.defaultPrevented).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it('leaves new-tab targets and downloads to the browser', () => {
    const push = vi.spyOn(history, 'pushState');
    expect(click(link('/a', { target: '_blank' })).defaultPrevented).toBe(false);
    expect(click(link('/b', { download: '' })).defaultPrevented).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it('leaves foreign origins to the browser', () => {
    const push = vi.spyOn(history, 'pushState');
    expect(click(link('https://example.com/x')).defaultPrevented).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it('ignores links outside the container and events already handled', () => {
    const push = vi.spyOn(history, 'pushState');
    const outside = document.createElement('a');
    outside.href = '/outside';
    document.body.append(outside);
    click(outside);
    expect(push).not.toHaveBeenCalled();
    outside.remove();
  });

  it('does not route a click that a previous listener already prevented', () => {
    const push = vi.spyOn(history, 'pushState');
    const a = link('/x');
    a.addEventListener('click', (event) => event.preventDefault(), { capture: true });
    click(a);
    expect(push).not.toHaveBeenCalled();
  });

  it('installs once per container and cleanup removes the listener', () => {
    const second = interceptInternalLinks(container);
    second();
    const push = vi.spyOn(history, 'pushState');
    click(link('/once'));
    expect(push).toHaveBeenCalledTimes(1);
    cleanup();
    push.mockClear();
    click(link('/after-cleanup'));
    expect(push).not.toHaveBeenCalled();
    cleanup = interceptInternalLinks(container);
  });
});
