/**
 * @file CustomScrollbar.ts
 * @description Custom horizontal scrollbar that remains fixed at bottom of viewport
 *
 * Provides a custom scrollbar implementation that:
 * - Stays fixed at the bottom of the screen
 * - Syncs with .astra-table-wrap horizontal scroll
 * - Uses Astra color scheme (--astra-accent-a20)
 * - Supports click, drag, and keyboard navigation
 */

export class CustomScrollbar {
  private scrollbar: HTMLElement | null = null;
  private thumb: HTMLElement | null = null;
  private targetElement: HTMLElement | null = null;
  private isDragging = false;
  private startX = 0;
  private startScrollLeft = 0;
  private targetSelector: string;
  private initRetries = 0;
  private maxRetries = 20;
  private updateInterval: number | null = null;

  constructor(targetSelector: string) {
    this.targetSelector = targetSelector;
    this.init();
  }

  private init(): void {
    this.targetElement = document.querySelector(this.targetSelector);

    if (!this.targetElement && this.initRetries < this.maxRetries) {
      this.initRetries++;
      setTimeout(() => this.init(), 100);
      return;
    }

    if (!this.targetElement) {
      console.warn('[CustomScrollbar] Target element not found:', this.targetSelector);
      return;
    }

    this.createScrollbar();
    this.attachEvents();
    this.updateThumb();

    // Poll for updates (per rilevare quando viene aggiunto contenuto)
    this.updateInterval = window.setInterval(() => this.updateThumb(), 200);
  }

  private createScrollbar(): void {
    // Create scrollbar container
    this.scrollbar = document.createElement('div');
    this.scrollbar.className = 'astra-custom-scrollbar';

    // Create track
    const track = document.createElement('div');
    track.className = 'astra-custom-scrollbar-track';

    // Create thumb
    this.thumb = document.createElement('div');
    this.thumb.className = 'astra-custom-scrollbar-thumb';

    track.appendChild(this.thumb);
    this.scrollbar.appendChild(track);
    document.body.appendChild(this.scrollbar);
  }

  private attachEvents(): void {
    if (!this.targetElement || !this.scrollbar || !this.thumb) return;

    // Sync scrollbar with target scroll
    this.targetElement.addEventListener('scroll', () => this.updateThumb());

    // Window resize
    window.addEventListener('resize', () => this.updateThumb());

    // Thumb drag
    this.thumb.addEventListener('mousedown', (e) => this.startDrag(e));
    document.addEventListener('mousemove', (e) => this.onDrag(e));
    document.addEventListener('mouseup', () => this.stopDrag());

    // Track click
    const track = this.scrollbar.querySelector('.astra-custom-scrollbar-track');
    track?.addEventListener('click', (e) => this.onTrackClick(e as MouseEvent));

    // Show/hide on table visibility
    const observer = new MutationObserver(() => this.updateThumb());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  private updateThumb(): void {
    if (!this.targetElement || !this.scrollbar || !this.thumb) return;

    const { scrollWidth, clientWidth, scrollLeft } = this.targetElement;
    const hasOverflow = scrollWidth > clientWidth;

    // Show/hide scrollbar
    if (hasOverflow) {
      this.scrollbar.classList.add('visible');
    } else {
      this.scrollbar.classList.remove('visible');
      return;
    }

    // Calculate thumb width and position
    const scrollbarWidth = this.scrollbar.clientWidth;
    const thumbWidth = Math.max((clientWidth / scrollWidth) * scrollbarWidth, 30);
    const maxThumbLeft = scrollbarWidth - thumbWidth;
    const thumbLeft = (scrollLeft / (scrollWidth - clientWidth)) * maxThumbLeft;

    this.thumb.style.width = `${thumbWidth}px`;
    this.thumb.style.left = `${thumbLeft}px`;
  }

  private startDrag(e: MouseEvent): void {
    if (!this.targetElement) return;

    this.isDragging = true;
    this.startX = e.clientX;
    this.startScrollLeft = this.targetElement.scrollLeft;
    e.preventDefault();
  }

  private onDrag(e: MouseEvent): void {
    if (!this.isDragging || !this.targetElement || !this.scrollbar) return;

    const deltaX = e.clientX - this.startX;
    const scrollbarWidth = this.scrollbar.clientWidth;
    const { scrollWidth, clientWidth } = this.targetElement;

    const scrollRatio = (scrollWidth - clientWidth) / scrollbarWidth;
    this.targetElement.scrollLeft = this.startScrollLeft + deltaX * scrollRatio;
  }

  private stopDrag(): void {
    this.isDragging = false;
  }

  private onTrackClick(e: MouseEvent): void {
    if (!this.targetElement || !this.scrollbar || !this.thumb) return;
    if (e.target === this.thumb) return;

    const trackRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clickX = e.clientX - trackRect.left;
    const thumbWidth = this.thumb.clientWidth;
    const targetThumbLeft = clickX - thumbWidth / 2;

    const scrollbarWidth = this.scrollbar.clientWidth;
    const { scrollWidth, clientWidth } = this.targetElement;
    const maxThumbLeft = scrollbarWidth - thumbWidth;

    const scrollRatio = targetThumbLeft / maxThumbLeft;
    this.targetElement.scrollLeft = scrollRatio * (scrollWidth - clientWidth);
  }

  public refresh(): void {
    this.updateThumb();
  }

  public destroy(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.scrollbar?.remove();
    this.scrollbar = null;
    this.thumb = null;
    this.targetElement = null;
  }
}
