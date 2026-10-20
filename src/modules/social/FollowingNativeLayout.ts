import { HIDDEN_CLASS, setClass, setOrder } from './FollowingGroupsDom';

export interface NativeOrder {
  order: string;
  hidden: boolean;
}

/**
 * Styles native rows and siblings with CSS order and the hidden class. The original inline order of every
 * touched node is remembered, so release() restores it exactly. Nodes are never moved, which keeps Vue intact.
 */
export class FollowingNativeLayout {
  private saved = new Map<HTMLElement, string>();

  /** Rows get their order; native siblings ahead of the first row stay on top, the rest go after `after`. */
  apply(parent: HTMLElement, orders: Map<HTMLElement, NativeOrder>, after: string, own: Set<Element>): void {
    let seenRow = false;
    for (const child of Array.from(parent.children)) {
      if (!(child instanceof HTMLElement) || own.has(child)) continue;
      const layout = orders.get(child);
      if (layout) {
        seenRow = true;
        this.touch(child, layout.order, layout.hidden);
      } else {
        this.touch(child, seenRow ? after : '-1', false);
      }
    }
  }

  /** Restores nodes that Vue detached or moved out of the column, so they never keep a stale order. */
  releaseDetached(parent: HTMLElement): void {
    for (const element of [...this.saved.keys()]) {
      if (element.parentElement !== parent) this.release(element);
    }
  }

  restoreAll(): void {
    [...this.saved.keys()].forEach((element) => this.release(element));
  }

  private touch(element: HTMLElement, order: string, hidden: boolean): void {
    if (!this.saved.has(element)) this.saved.set(element, element.style.order);
    setOrder(element, order);
    setClass(element, HIDDEN_CLASS, hidden);
  }

  private release(element: HTMLElement): void {
    const original = this.saved.get(element);
    if (original === undefined) return;
    this.saved.delete(element);
    if (element.style.order !== original) element.style.order = original;
    setClass(element, HIDDEN_CLASS, false);
  }
}
