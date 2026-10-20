import { injectable } from 'tsyringe';
import { html } from '@core/utils/Template';
import type { UserComment } from './CommentService';

/** Expanded reading view for the same plain-text notes shown by the hover tooltip. */
@injectable()
export class CommentReader {
  private overlay: HTMLElement | null = null;
  private listeners: AbortController | null = null;
  private returnFocus: HTMLElement | null = null;
  private bodyOverflow = { value: '', priority: '' };

  public open(comment: UserComment, trigger: HTMLElement): void {
    this.close(false);
    this.returnFocus = trigger;
    const overlay = html`
      <div class="au-comment-reader-overlay">
        <section class="au-comment-reader" role="dialog" aria-modal="true"
          aria-labelledby="au-comment-reader-title" tabindex="-1">
          <header class="au-comment-reader-header">
            <h2 id="au-comment-reader-title">${comment.username}'s Notes</h2>
            <div class="au-comment-reader-actions">
              <button type="button" class="au-comment-reader-expand" aria-label="Expand notes"
                title="Expand notes" aria-pressed="false">⛶</button>
              <button type="button" class="au-comment-reader-close" aria-label="Close notes"
                title="Close notes">×</button>
            </div>
          </header>
          <div class="au-comment-reader-content" tabindex="0">${comment.notes}</div>
        </section>
      </div>
    `;
    const panel = overlay.querySelector<HTMLElement>('.au-comment-reader')!;
    const expand = overlay.querySelector<HTMLButtonElement>('.au-comment-reader-expand')!;
    const close = overlay.querySelector<HTMLButtonElement>('.au-comment-reader-close')!;
    const content = overlay.querySelector<HTMLElement>('.au-comment-reader-content')!;
    const listeners = new AbortController();
    this.listeners = listeners;
    this.overlay = overlay;
    const options = { signal: listeners.signal };
    expand.addEventListener('click', () => {
      const expanded = panel.classList.toggle('au-comment-reader--fullscreen');
      expand.setAttribute('aria-pressed', String(expanded));
      expand.setAttribute('aria-label', expanded ? 'Restore notes window' : 'Expand notes');
      expand.title = expanded ? 'Restore notes window' : 'Expand notes';
    }, options);
    close.addEventListener('click', () => this.close(), options);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) this.close();
    }, options);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.close();
      } else if (event.key === 'Tab') {
        const first = expand;
        const last = content;
        if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    }, { ...options, capture: true });
    this.bodyOverflow = {
      value: document.body.style.getPropertyValue('overflow'),
      priority: document.body.style.getPropertyPriority('overflow'),
    };
    document.body.style.setProperty('overflow', 'hidden');
    document.body.appendChild(overlay);
    close.focus();
  }

  public close(restoreFocus = true): void {
    if (!this.overlay) return;
    this.listeners?.abort();
    this.listeners = null;
    this.overlay.remove();
    this.overlay = null;
    if (document.body.style.getPropertyValue('overflow') === 'hidden'
      && document.body.style.getPropertyPriority('overflow') === '') {
      document.body.style.setProperty('overflow', this.bodyOverflow.value, this.bodyOverflow.priority);
    }
    if (restoreFocus && this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    this.returnFocus = null;
  }

  public closeFor(trigger: HTMLElement): void {
    if (this.returnFocus === trigger) this.close(false);
  }
}
