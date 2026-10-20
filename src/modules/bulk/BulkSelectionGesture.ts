export const BULK_ROWS = '.list-entries .entry, .list-entries .entry-card';
const HOLD_MS = 500;
const MOVE_TOLERANCE = 8;
const CONTROLS =
  'button, input, select, textarea, [contenteditable], [role="button"], .au-bulk-toolbar';

/** Delegated gestures leave ordinary links and scrolling available until selection starts. */
export class BulkSelectionGesture {
  private press: {
    row: HTMLElement;
    pointerId: number;
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private suppressed: { row: HTMLElement; until: number } | null = null;
  private readonly onDown = (event: PointerEvent): void => {
    this.cancel();
    this.suppressed = null;
    if (
      this.selecting() ||
      this.busy() ||
      event.button !== 0 ||
      event.isPrimary === false ||
      this.modified(event)
    )
      return;
    const row = this.row(event.target);
    if (!row || this.control(event.target)) return;
    const timer = setTimeout(() => {
      if (!this.press || !row.isConnected || !this.root.contains(row)) {
        this.cancel();
        return;
      }
      this.suppressed = { row, until: Infinity };
      this.press = null;
      window.getSelection()?.removeAllRanges();
      this.start(row);
    }, HOLD_MS);
    this.press = { row, pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer };
  };
  private readonly onMove = (event: PointerEvent): void => {
    if (
      this.press &&
      event.pointerId === this.press.pointerId &&
      Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y) > MOVE_TOLERANCE
    )
      this.cancel();
  };
  private readonly onUp = (): void => {
    this.cancel();
    // Touch may dispatch its synthesized click after pointerup.
    if (this.suppressed) this.suppressed.until = Date.now() + 1000;
  };
  private readonly onCancel = (): void => {
    this.cancel();
    this.suppressed = null;
  };
  private readonly onClick = (event: MouseEvent): void => {
    const row = this.row(event.target);
    if (!row) return;
    if (this.suppressed?.row === row && Date.now() <= this.suppressed.until) {
      this.suppressed = null;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!this.selecting() || this.modified(event) || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('.au-bulk-check')) {
      event.stopPropagation();
      if (this.busy()) event.preventDefault();
      return;
    }
    if (this.control(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!this.busy()) this.toggle(row);
  };
  private readonly onContextMenu = (event: Event): void => {
    if (this.suppressed?.row === this.row(event.target) && Date.now() <= this.suppressed.until) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.cancel();
      if (this.selecting() && !this.busy()) {
        event.preventDefault();
        this.exit();
      }
      return;
    }
    if (event.key !== ' ' || event.repeat || this.busy() || this.control(event.target)) return;
    const row = this.row(event.target);
    if (!row || (!this.selecting() && !event.shiftKey)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (this.selecting()) this.toggle(row);
    else this.start(row);
  };

  constructor(
    private root: HTMLElement,
    private selecting: () => boolean,
    private busy: () => boolean,
    private start: (row: HTMLElement) => void,
    private toggle: (row: HTMLElement) => void,
    private exit: () => void
  ) {
    root.addEventListener('pointerdown', this.onDown, true);
    root.addEventListener('click', this.onClick, true);
    root.addEventListener('contextmenu', this.onContextMenu, true);
    root.addEventListener('dragstart', this.onCancel, true);
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onUp, true);
    window.addEventListener('pointercancel', this.onCancel, true);
    window.addEventListener('scroll', this.onCancel, true);
    window.addEventListener('blur', this.onCancel);
    window.addEventListener('keydown', this.onKey, true);
  }
  private row(target: EventTarget | null): HTMLElement | null {
    const row = target instanceof Element ? target.closest<HTMLElement>(BULK_ROWS) : null;
    return row && this.root.contains(row) ? row : null;
  }
  private control(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest(CONTROLS);
  }
  private modified(event: MouseEvent): boolean {
    return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
  }
  private cancel(): void {
    if (this.press) clearTimeout(this.press.timer);
    this.press = null;
  }
  destroy(): void {
    this.onCancel();
    this.root.removeEventListener('pointerdown', this.onDown, true);
    this.root.removeEventListener('click', this.onClick, true);
    this.root.removeEventListener('contextmenu', this.onContextMenu, true);
    this.root.removeEventListener('dragstart', this.onCancel, true);
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('pointerup', this.onUp, true);
    window.removeEventListener('pointercancel', this.onCancel, true);
    window.removeEventListener('scroll', this.onCancel, true);
    window.removeEventListener('blur', this.onCancel);
    window.removeEventListener('keydown', this.onKey, true);
  }
}
