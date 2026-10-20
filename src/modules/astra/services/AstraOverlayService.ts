/** Owns Astra overlays, their animations and the body scroll lock. */
import { injectable, singleton, type Disposable } from 'tsyringe';

@injectable()
@singleton()
export class AstraOverlayService implements Disposable {
  private activeOverlays = new Map<string, HTMLElement>();
  private hideTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private showFrames = new Map<string, number>();
  private scrollLockOwners = new Set<string>();
  private scrollLock: {
    body: { element: HTMLElement; value: string; priority: string };
    document: { element: HTMLElement; value: string; priority: string };
  } | null = null;
  private disposed = false;

  public create(id: string): HTMLElement {
    if (this.disposed) throw new Error('Astra overlay service disposed');
    const current = this.activeOverlays.get(id);
    if (current) return current;
    const overlay = document.createElement('div');
    overlay.className = 'astra-modal-overlay'; overlay.id = `astra-overlay-${id}`;
    (document.body || document.documentElement).appendChild(overlay);
    this.acquireScrollLock(`overlay:${id}`);
    this.activeOverlays.set(id, overlay);
    return overlay;
  }

  public show(id: string): void {
    const overlay = this.activeOverlays.get(id);
    if (!overlay || this.disposed) return;
    this.cancelAnimation(id);
    overlay.classList.remove('astra-modal-overlay--closing');
    const frame = requestAnimationFrame(() => {
      if (this.disposed || this.showFrames.get(id) !== frame || this.activeOverlays.get(id) !== overlay) return;
      this.showFrames.delete(id);
      if (overlay.isConnected) overlay.classList.add('astra-modal-overlay--open');
    });
    this.showFrames.set(id, frame);
  }

  public hide(id: string, onComplete?: () => void): void {
    const overlay = this.activeOverlays.get(id);
    if (!overlay || this.disposed || this.hideTimers.has(id)) return;
    this.cancelAnimation(id);
    overlay.classList.add('astra-modal-overlay--closing'); overlay.classList.remove('astra-modal-overlay--open');
    const timer = setTimeout(() => {
      if (this.disposed || this.hideTimers.get(id) !== timer || this.activeOverlays.get(id) !== overlay) return;
      this.hideTimers.delete(id);
      this.remove(id);
      onComplete?.();
    }, 350);
    this.hideTimers.set(id, timer);
  }

  /** Immediate teardown for account changes, feature OFF and document disposal. */
  public remove(id: string): void {
    this.cancelAnimation(id);
    const overlay = this.activeOverlays.get(id);
    overlay?.remove(); this.activeOverlays.delete(id);
    if (overlay) this.releaseScrollLock(`overlay:${id}`);
  }

  private cancelAnimation(id: string): void {
    const timer = this.hideTimers.get(id); if (timer !== undefined) clearTimeout(timer);
    this.hideTimers.delete(id);
    const frame = this.showFrames.get(id); if (frame !== undefined) cancelAnimationFrame(frame);
    this.showFrames.delete(id);
  }

  /** Share the document scroll lock between independently managed Astra overlays. */
  public acquireScrollLock(owner: string): void {
    if (this.disposed || this.scrollLockOwners.has(owner)) return;
    if (!this.scrollLock) {
      const body = document.body;
      const root = document.documentElement;
      this.scrollLock = {
        body: { element: body, value: body.style.getPropertyValue('overflow'), priority: body.style.getPropertyPriority('overflow') },
        document: { element: root, value: root.style.getPropertyValue('overflow'), priority: root.style.getPropertyPriority('overflow') },
      };
      body.style.setProperty('overflow', 'hidden');
      root.style.setProperty('overflow', 'hidden');
    }
    this.scrollLockOwners.add(owner);
  }

  public releaseScrollLock(owner: string): void {
    if (!this.scrollLockOwners.delete(owner) || this.scrollLockOwners.size > 0) return;
    const lock = this.scrollLock; this.scrollLock = null;
    if (!lock) return;
    this.restoreOverflow(lock.body);
    this.restoreOverflow(lock.document);
  }

  private restoreOverflow(snapshot: { element: HTMLElement; value: string; priority: string }): void {
    const { element, value, priority } = snapshot;
    if (element.style.getPropertyValue('overflow') !== 'hidden' || element.style.getPropertyPriority('overflow') !== '') return;
    if (value) element.style.setProperty('overflow', value, priority);
    else element.style.removeProperty('overflow');
  }

  public isActive(id: string): boolean { return this.activeOverlays.has(id); }
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of this.activeOverlays.keys()) this.remove(id);
  }
}
