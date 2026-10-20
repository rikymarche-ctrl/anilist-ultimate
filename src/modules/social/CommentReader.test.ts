import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentReader } from './CommentReader';

describe('CommentReader', () => {
  let reader: CommentReader;
  let trigger: HTMLButtonElement;
  beforeEach(() => {
    reader = new CommentReader();
    document.body.innerHTML = '<button>Notes</button>';
    trigger = document.querySelector('button')!;
    document.body.style.overflow = '';
  });
  afterEach(() => { reader.close(); document.body.innerHTML = ''; document.body.style.overflow = ''; vi.restoreAllMocks(); });
  const comment = { username: 'Friend', mediaId: 1, notes: 'First line\nSecond line', timestamp: 0 };
  const open = () => reader.open(comment, trigger);

  it('renders complete notes and usernames as text with accessible dialog semantics', () => {
    reader.open({ ...comment, username: '<img src=x>', notes: '<script>bad()</script>\nsecond' }, trigger);
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector('h2')?.textContent).toBe("<img src=x>'s Notes");
    expect(document.querySelector('.au-comment-reader-content')?.textContent).toBe('<script>bad()</script>\nsecond');
    expect(document.querySelector('img, script')).toBeNull();
  });

  it('expands and restores the reading window', () => {
    open();
    const expand = document.querySelector<HTMLButtonElement>('.au-comment-reader-expand')!;
    expand.click();
    expect(expand.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.au-comment-reader--fullscreen')).not.toBeNull();
    expand.click();
    expect(expand.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('.au-comment-reader--fullscreen')).toBeNull();
  });

  it.each(['button', 'escape', 'backdrop'])('closes via %s and restores focus and scroll', mode => {
    document.body.style.setProperty('overflow', 'auto', 'important');
    open();
    expect(document.body.style.overflow).toBe('hidden');
    if (mode === 'button') document.querySelector<HTMLButtonElement>('.au-comment-reader-close')!.click();
    if (mode === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (mode === 'backdrop') document.querySelector<HTMLElement>('.au-comment-reader-overlay')!.click();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe('auto');
    expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
  });

  it('does not close when clicking inside the notes', () => {
    open();
    document.querySelector<HTMLElement>('.au-comment-reader-content')!.click();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('contains keyboard focus and releases its capture listener on close', () => {
    open();
    const first = document.querySelector<HTMLButtonElement>('.au-comment-reader-expand')!;
    const last = document.querySelector<HTMLElement>('.au-comment-reader-content')!;
    last.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(last);
    reader.close();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
  });

  it('opens only one reader and updates the comment on a subsequent request', () => {
    open();
    reader.open({ ...comment, username: 'Other', notes: 'Other notes', mediaId: 2 }, trigger);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('.au-comment-reader-content')?.textContent).toBe('Other notes');
    reader.close();
    expect(document.body.style.overflow).toBe('');
  });

  it('releases only the reader owned by the removed trigger', () => {
    open(); const other = document.createElement('button'); document.body.append(other);
    reader.closeFor(other); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    reader.closeFor(trigger); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.body.style.overflow).toBe('');
  });
});
