import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { BulkSelectionGesture } from './BulkSelectionGesture';

describe('bulk selection gestures', () => {
  let gesture: BulkSelectionGesture;
  let root: HTMLElement;
  let title: HTMLAnchorElement;
  let selecting: boolean;
  let busy: boolean;
  let start: Mock<(row: HTMLElement) => void>;
  let toggle: Mock<(row: HTMLElement) => void>;
  let exit: Mock<() => void>;
  function pointer(
    type: string,
    target: EventTarget = title,
    x = 10,
    y = 10,
    extra: MouseEventInit = {}
  ) {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
      ...extra,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    target.dispatchEvent(event);
    return event;
  }
  beforeEach(() => {
    vi.useFakeTimers();
    selecting = false;
    busy = false;
    document.body.innerHTML =
      '<div class="medialist"><div class="list-entries"><div class="entry row"><a class="title" href="/anime/1">First</a><button>Edit</button><input type="checkbox" class="au-bulk-check"></div><div class="entry-card"><a href="/anime/2">Second</a></div></div></div>';
    root = document.querySelector('.medialist')!;
    title = document.querySelector('.title')!;
    start = vi.fn(() => {
      selecting = true;
    });
    toggle = vi.fn();
    exit = vi.fn(() => {
      selecting = false;
    });
    gesture = new BulkSelectionGesture(
      root,
      () => selecting,
      () => busy,
      start,
      toggle,
      exit
    );
  });
  afterEach(() => {
    gesture.destroy();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('leaves a brief click and its native handler intact', () => {
    const native = vi.fn();
    title.addEventListener('click', native);
    pointer('pointerdown');
    vi.advanceTimersByTime(200);
    pointer('pointerup', window);
    const click = pointer('click');
    expect(click.defaultPrevented).toBe(false);
    expect(native).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });
  it('activates after 500 ms and consumes the release click without toggling the first entry off', () => {
    const native = vi.fn();
    title.addEventListener('click', native);
    pointer('pointerdown');
    vi.advanceTimersByTime(499);
    expect(start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(start).toHaveBeenCalledWith(title.closest('.entry'));
    pointer('pointerup', window);
    expect(pointer('click').defaultPrevented).toBe(true);
    expect(native).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
  });
  it('selects other entries on a simple click, including title links', () => {
    selecting = true;
    const other = document.querySelector<HTMLElement>('.entry-card a')!;
    expect(pointer('click', other).defaultPrevented).toBe(true);
    expect(toggle).toHaveBeenCalledWith(other.parentElement);
  });
  it('treats the next pointerdown as a fresh click even when touch emitted no release click', () => {
    pointer('pointerdown');
    vi.advanceTimersByTime(500);
    pointer('pointerup', window);
    pointer('pointerdown');
    pointer('pointerup', window);
    pointer('click');
    expect(toggle).toHaveBeenCalledTimes(1);
  });
  it.each(['scroll', 'blur', 'pointercancel', 'dragstart'])(
    'cancels a pending hold on %s',
    (type) => {
      pointer('pointerdown');
      (type === 'dragstart' ? title : window).dispatchEvent(new Event(type, { bubbles: true }));
      vi.advanceTimersByTime(600);
      expect(start).not.toHaveBeenCalled();
    }
  );
  it('cancels when the pointer moves beyond eight pixels, but tolerates small movements', () => {
    pointer('pointerdown');
    pointer('pointermove', window, 19, 10);
    vi.advanceTimersByTime(500);
    expect(start).not.toHaveBeenCalled();
    pointer('pointerdown');
    pointer('pointermove', window, 12, 11);
    vi.advanceTimersByTime(500);
    expect(start).toHaveBeenCalledTimes(1);
  });
  it('ignores buttons, modified presses and secondary mouse buttons', () => {
    for (const [target, extra] of [
      [root.querySelector('button')!, {}],
      [title, { ctrlKey: true }],
      [title, { button: 2 }],
    ] as const) {
      pointer('pointerdown', target, 10, 10, extra);
      vi.advanceTimersByTime(600);
    }
    expect(start).not.toHaveBeenCalled();
  });
  it('preserves checkbox default behavior and native editor controls in selection mode', () => {
    selecting = true;
    const input = root.querySelector<HTMLInputElement>('input')!;
    input.click();
    expect(input.checked).toBe(true);
    expect(toggle).not.toHaveBeenCalled();
    const native = vi.fn();
    root.querySelector('button')!.addEventListener('click', native);
    root.querySelector('button')!.click();
    expect(native).toHaveBeenCalledTimes(1);
  });
  it('blocks row changes during saving', () => {
    selecting = true;
    busy = true;
    expect(pointer('click').defaultPrevented).toBe(true);
    expect(toggle).not.toHaveBeenCalled();
  });
  it('suppresses the long-press context menu', () => {
    pointer('pointerdown');
    vi.advanceTimersByTime(500);
    expect(pointer('contextmenu').defaultPrevented).toBe(true);
  });
  it('supports Shift+Space to start, Space to toggle and Escape to leave', () => {
    title.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', shiftKey: true, bubbles: true, cancelable: true })
    );
    expect(start).toHaveBeenCalledTimes(1);
    title.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    );
    expect(toggle).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(exit).toHaveBeenCalledTimes(1);
  });
  it('does not activate after teardown or after the held row is removed', () => {
    pointer('pointerdown');
    title.closest('.entry')!.remove();
    vi.advanceTimersByTime(600);
    expect(start).not.toHaveBeenCalled();
    root.querySelector('.list-entries')!.append(title);
    pointer('pointerdown', root.querySelector('.entry-card a')!);
    gesture.destroy();
    vi.advanceTimersByTime(600);
    expect(start).not.toHaveBeenCalled();
  });
});
