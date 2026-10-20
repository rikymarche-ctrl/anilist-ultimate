/** Resources belong to one rendered form, independently of accepted persistence. */
export class AstraRatingViewScope {
  private released = false;
  private listeners: Array<() => void> = [];
  private frames = new Set<number>();
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(public readonly root: HTMLElement, private readonly current: () => boolean, private readonly failed: (error: unknown) => void) {}

  public get active(): boolean { return !this.released && this.root.isConnected && this.current(); }

  public listen<K extends keyof HTMLElementEventMap>(target: EventTarget | null | undefined, type: K,
    callback: (event: HTMLElementEventMap[K]) => unknown): void {
    if (!target || this.released) return;
    const listener: EventListener = event => {
      if (!this.active || (target instanceof Node && target !== document && !this.root.contains(target))) return;
      try {
        const result = callback(event as HTMLElementEventMap[K]);
        void Promise.resolve(result).catch(error => { if (this.active) this.failed(error); });
      } catch (error) { if (this.active) this.failed(error); }
    };
    target.addEventListener(type, listener);
    this.listeners.push(() => target.removeEventListener(type, listener));
  }

  public frame(callback: FrameRequestCallback): number {
    const id = requestAnimationFrame(time => {
      this.frames.delete(id);
      if (this.active) {
        try { callback(time); } catch (error) { if (this.active) this.failed(error); }
      }
    });
    this.frames.add(id); return id;
  }

  public timeout(callback: () => void, duration: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (this.active) { try { callback(); } catch (error) { if (this.active) this.failed(error); } }
    }, duration);
    this.timers.add(id); return id;
  }

  public clearTimer(id: ReturnType<typeof setTimeout>): void { clearTimeout(id); this.timers.delete(id); }

  public release(): void {
    if (this.released) return;
    this.released = true;
    for (const remove of this.listeners.splice(0)) remove();
    for (const id of this.frames) cancelAnimationFrame(id);
    for (const id of this.timers) clearTimeout(id);
    this.frames.clear(); this.timers.clear();
  }
}
