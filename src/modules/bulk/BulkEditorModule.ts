import { inject, injectable } from 'tsyringe';
import { BaseModule } from '@core/modules/BaseModule';
import { TOKENS } from '@core/di/tokens';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { SharedGlobalObserver } from '@core/observers/SharedGlobalObserver';
import { EVENT_TYPES } from '@core/events/EventTypes';
import {
  BulkEditorService,
  bulkRoute,
  bulkRouteOwner,
  BULK_STATUSES,
  type BulkEdit,
  type BulkMediaType,
  type BulkResult,
  type BulkSnapshot,
  type BulkStatus,
} from './BulkEditorService';
import { ToastService } from '@core/services/ToastService';
import '@/styles/bulk-editor.css';
import { BULK_ROWS, BulkSelectionGesture } from './BulkSelectionGesture';

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  className = ''
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}
function button(text: string, action: () => void): HTMLButtonElement {
  const node = element('button', text);
  node.type = 'button';
  node.addEventListener('click', () => {
    if (node.isConnected) action();
  });
  return node;
}
function option(value: string, text: string): HTMLOptionElement {
  const node = element('option', text);
  node.value = value;
  return node;
}

/** How long a first Apply click stays armed before it expires. */
const CONFIRM_MS = 4000;

/** Status labels for the media type, matching the status select. */
function statusLabels(type: BulkMediaType): Record<BulkStatus, string> {
  const anime = type === 'ANIME';
  return {
    CURRENT: anime ? 'Watching' : 'Reading',
    PLANNING: 'Planning',
    COMPLETED: 'Completed',
    PAUSED: 'Paused',
    DROPPED: 'Dropped',
    REPEATING: anime ? 'Rewatching' : 'Rereading',
  };
}

@injectable()
export class BulkEditorModule extends BaseModule {
  private initialized = false;
  private version = 0;
  private root: HTMLElement | null = null;
  private toolbar: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private message: HTMLElement | null = null;
  private summary: HTMLElement | null = null;
  private editButton: HTMLButtonElement | null = null;
  private submit: HTMLButtonElement | null = null;
  private stopButton: HTMLButtonElement | null = null;
  private snapshot: BulkSnapshot | null = null;
  /** True only once the viewer is confirmed as this route's owner; gates controls and gestures. */
  private ownsRoute = false;
  private stopRequested = false;
  /** Selection and edit key of a first Apply click that awaits confirmation. */
  private armedKey: string | null = null;
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;
  private selected = new Set<number>();
  private busy = false;
  private path = '';
  private gesture: BulkSelectionGesture | null = null;
  private initialId: number | null = null;
  private status: HTMLSelectElement | null = null;
  private listControls = new Map<string, HTMLSelectElement>();
  private checks = new Map<
    HTMLElement,
    { input: HTMLInputElement; mediaId: number; addedClass: boolean }
  >();
  private readonly change = (event: Event): void => {
    const input = event.target;
    if (
      !(input instanceof HTMLInputElement) ||
      !input.classList.contains('au-bulk-check') ||
      this.busy ||
      !this.isCurrent()
    )
      return;
    const id = Number(input.value);
    if (!this.snapshot?.entries.has(id)) return;
    if (input.checked) this.selected.add(id);
    else this.selected.delete(id);
    this.updateSelection();
  };

  constructor(
    @inject(BulkEditorService) private service: BulkEditorService,
    @inject(TOKENS.SharedGlobalObserver) private observer: SharedGlobalObserver,
    @inject(TOKENS.EventBus) protected eventBus: IEventBus,
    @inject(TOKENS.ToastService) private toast: ToastService
  ) {
    super(eventBus);
  }

  getName(): string {
    return 'bulkEditor';
  }
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.onPageChange(() => {
      this.reset();
      this.reconcile();
    });
    this.subscribe(EVENT_TYPES.AUTH_STATE_CHANGED, () => {
      this.reset();
      this.reconcile();
    });
    this.observer.register('bulkEditor', () => this.reconcile());
    this.reconcile();
  }

  private isCurrent(): boolean {
    return (
      this.initialized &&
      this.ownsRoute &&
      this.path === location.pathname &&
      !!bulkRoute(this.path) &&
      !!this.root?.isConnected
    );
  }
  private reconcile(): void {
    if (!this.initialized) return;
    const root = bulkRoute(location.pathname)
      ? document.querySelector<HTMLElement>('.medialist')
      : null;
    if (
      root !== this.root ||
      this.path !== location.pathname ||
      (this.toolbar && !this.toolbar.isConnected)
    ) {
      this.reset();
      if (!root) return;
      this.root = root;
      this.path = location.pathname;
      root.addEventListener('change', this.change);
      void this.claimOwnership();
    }
    if (this.snapshot) this.decorate();
  }

  /**
   * Activates the editor only when the signed-in viewer owns this route's list.
   * Other profiles and signed-out visitors keep AniList's native behaviour.
   */
  private async claimOwnership(): Promise<void> {
    const version = this.version;
    const owner = bulkRouteOwner(this.path);
    const viewer = owner ? await this.service.viewerName().catch(() => null) : null;
    const root = this.root;
    if (version !== this.version || !root || !owner || viewer?.toLowerCase() !== owner.toLowerCase())
      return;
    this.ownsRoute = true;
    this.gesture = new BulkSelectionGesture(
      root,
      () => !!this.toolbar,
      () => this.busy,
      (row) => {
        const id = this.mediaId(row);
        if (!id || !this.isCurrent()) return;
        this.initialId = id;
        void this.open();
      },
      (row) => {
        const id = this.mediaId(row);
        if (!id || !this.snapshot?.entries.has(id) || !this.isCurrent()) return;
        if (this.selected.has(id)) this.selected.delete(id);
        else this.selected.add(id);
        this.updateSelection();
      },
      () => this.close()
    );
  }
  private async open(): Promise<void> {
    if (!this.root || this.snapshot || this.busy) return;
    if (!this.toolbar) {
      this.toolbar = element('section', '', 'au-bulk-toolbar');
      this.toolbar.addEventListener('click', (event) => event.stopPropagation());
      this.toolbar.setAttribute('aria-label', 'Bulk editor');
      (this.root.querySelector('.lists') ?? this.root).prepend(this.toolbar);
    }
    const version = this.version;
    const active = () => version === this.version && this.isCurrent();
    this.busy = true;
    this.toolbar.replaceChildren();
    this.message = element('p', 'Loading your list…');
    this.message.setAttribute('role', 'status');
    this.toolbar.append(this.message);
    try {
      const snapshot = await this.service.load(bulkRoute(this.path)!, active);
      if (!active()) return;
      this.snapshot = snapshot;
      if (this.initialId !== null && snapshot.entries.has(this.initialId))
        this.selected.add(this.initialId);
      this.renderEditor();
    } catch (error) {
      if (!active()) return;
      this.message.textContent =
        error instanceof Error && error.message.startsWith('Connect ')
          ? error.message
          : 'Could not load the list. Try again.';
      this.toolbar.append(
        button('Retry', () => {
          if (!this.busy && active()) void this.open();
        }),
        button('Close', () => this.close())
      );
    } finally {
      if (active()) {
        this.busy = false;
        this.updateSelection();
      }
    }
  }

  private renderEditor(): void {
    const snapshot = this.snapshot!;
    const version = this.version;
    this.toolbar!.replaceChildren();
    const controls = element('div', '', 'au-bulk-actions');
    this.summary = element('strong');
    this.editButton = button('Edit selected', () => {
      if (!this.busy && this.isCurrent()) {
        this.panel!.hidden = !this.panel!.hidden;
        this.updateSelection();
      }
    });
    this.stopButton = button('Stop', () => this.requestStop());
    controls.append(
      this.summary,
      button('Select visible', () => {
        if (this.busy || !this.isCurrent()) return;
        for (const { input, mediaId } of this.checks.values())
          if (this.visible(input)) this.selected.add(mediaId);
        this.updateSelection();
      }),
      button('Clear selection', () => {
        if (!this.busy && this.isCurrent()) {
          this.selected.clear();
          this.updateSelection();
        }
      }),
      this.editButton,
      this.stopButton,
      button('Exit', () => {
        if (!this.busy && this.isCurrent()) this.close();
      })
    );
    this.panel = element('form', '', 'au-bulk-panel');
    this.panel.hidden = true;
    this.panel.append(element('h3', 'Edit selected entries'));
    const label = element('label', 'Status');
    this.status = element('select');
    this.status.setAttribute('aria-label', 'Status');
    this.status.append(option('', 'Keep current status'));
    const labels = statusLabels(snapshot.type);
    for (const value of BULK_STATUSES) this.status!.append(option(value, labels[value]));    label.append(this.status);
    this.panel.append(label);
    const lists = element('div', '', 'au-bulk-list-controls');
    for (const name of snapshot.lists) {
      const label = element('label', name);
      const select = element('select');
      select.setAttribute('aria-label', `Custom list: ${name}`);
      select.append(
        option('', 'Keep membership'),
        option('add', 'Add to list'),
        option('remove', 'Remove from list')
      );
      this.listControls.set(name, select);
      label.append(select);
      lists.append(label);
    }
    this.panel.append(lists);
    if (!snapshot.lists.length)
      this.panel.append(element('p', 'No custom lists configured for this media type.'));
    const preview = element('p', '', 'au-bulk-preview');
    preview.dataset.bulkPreview = 'true';
    this.panel.append(preview);
    this.panel.append(
      element('p', 'Only chosen fields change. Status changes do not adjust progress or dates.')
    );
    this.submit = element('button', 'Apply changes');
    this.submit.type = 'submit';
    this.panel.append(this.submit);
    this.panel.addEventListener('change', () => {
      if (version === this.version) this.updateSelection();
    });
    this.panel.addEventListener('submit', (event) => {
      event.preventDefault();
      if (version !== this.version || this.busy || !this.isCurrent()) return;
      // The first click arms a confirmation; only a second click with the same edit writes.
      if (this.armedKey !== this.actionKey(this.readEdit())) this.arm();
      else void this.save();
    });
    this.message = element(
      'p',
      'Click entries to select them. Press Escape or Exit to leave selection. “Select visible” includes only loaded, displayed entries.'
    );
    this.message.setAttribute('role', 'status');
    this.message.setAttribute('aria-live', 'polite');
    this.toolbar!.append(controls, this.panel, this.message);
    this.decorate();
    this.updateSelection();
  }

  private visible(input: HTMLInputElement): boolean {
    if (!input.isConnected || !this.root?.contains(input)) return false;
    for (
      let node: HTMLElement | null = input.parentElement;
      node && node !== this.root;
      node = node.parentElement
    ) {
      if (
        node.hidden ||
        getComputedStyle(node).display === 'none' ||
        getComputedStyle(node).visibility === 'hidden'
      )
        return false;
    }
    return true;
  }

  private decorate(): void {
    for (const [row, state] of this.checks) {
      if (
        !row.isConnected ||
        !this.root!.contains(row) ||
        !row.contains(state.input) ||
        this.mediaId(row) !== state.mediaId
      ) {
        state.input.remove();
        if (state.addedClass) row.classList.remove('au-bulk-row');
        this.checks.delete(row);
      }
    }
    for (const row of this.root!.querySelectorAll<HTMLElement>(BULK_ROWS)) {
      const mediaId = this.mediaId(row);
      if (!mediaId || !this.snapshot!.entries.has(mediaId) || this.checks.has(row)) continue;
      const input = element('input', '', 'au-bulk-check');
      input.type = 'checkbox';
      input.value = String(mediaId);
      input.setAttribute('aria-label', `Select ${this.title(row)}`);
      input.checked = this.selected.has(mediaId);
      input.disabled = this.busy;
      const addedClass = !row.classList.contains('au-bulk-row');
      row.classList.add('au-bulk-row');
      row.prepend(input);
      this.checks.set(row, { input, mediaId, addedClass });
    }
  }

  private mediaId(row: HTMLElement): number | null {
    const kind = bulkRoute(this.path) === 'ANIME' ? 'anime' : 'manga';
    for (const link of row.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const url = new URL(link.href, location.href);
      const match = new RegExp(`^/${kind}/(\\d+)(?:/|$)`).exec(url.pathname);
      if (url.origin === location.origin && match) return Number(match[1]);
    }
    return null;
  }
  private title(row: HTMLElement): string {
    return (
      row
        .querySelector('.title a, a.title, a[href*="/anime/"], a[href*="/manga/"]')
        ?.textContent?.trim() || 'entry'
    );
  }

  private updateSelection(): void {
    if (!this.snapshot || !this.summary) return;
    const edit = this.readEdit();
    if (this.armedKey !== this.actionKey(edit)) this.disarm();
    // Stop is the only control that stays usable while a save runs.
    this.toolbar!.querySelectorAll('button').forEach((control) => {
      control.disabled = this.busy && control !== this.stopButton;
    });
    for (const { input, mediaId } of this.checks.values()) {
      input.checked = this.selected.has(mediaId);
      input.disabled = this.busy;
    }
    this.summary.textContent = `${this.selected.size} selected`;
    this.editButton!.disabled = this.busy || !this.selected.size;
    this.stopButton!.disabled = !this.busy || this.stopRequested;
    this.submit!.disabled =
      this.busy || !this.selected.size || (!edit.status && !Object.keys(edit.lists).length);
    this.submit!.textContent =
      this.armedKey === null ? `Apply to ${this.selected.size} entries` : this.confirmLabel(edit);
    const preview = this.panel!.querySelector<HTMLElement>('[data-bulk-preview]')!;
    const names = new Map<number, string>();
    for (const [row, { mediaId }] of this.checks)
      if (this.selected.has(mediaId)) names.set(mediaId, this.title(row));
    const titles = [...names.values()].slice(0, 6);
    const remaining = this.selected.size - titles.length;
    preview.textContent =
      titles.join(' · ') +
      (remaining > 0 ? ` · +${remaining} other selected entries (including hidden entries)` : '');
    for (const select of [this.status!, ...this.listControls.values()]) select.disabled = this.busy;
  }
  private readEdit(): BulkEdit {
    const edit: BulkEdit = { lists: {} };
    if (this.status?.value) edit.status = this.status.value as BulkEdit['status'];
    for (const [name, control] of this.listControls)
      if (control.value === 'add' || control.value === 'remove')
        Object.defineProperty(edit.lists, name, {
          value: control.value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
    return edit;
  }

  /** Key for the chosen entries and edit; a pending confirmation only applies to the same key. */
  private actionKey(edit: BulkEdit): string {
    return JSON.stringify([[...this.selected].sort((a, b) => a - b), edit]);
  }
  private arm(): void {
    this.disarm();
    this.armedKey = this.actionKey(this.readEdit());
    this.confirmTimer = setTimeout(() => {
      this.confirmTimer = null;
      this.disarm();
      this.updateSelection();
    }, CONFIRM_MS);
    this.updateSelection();
  }
  private disarm(): void {
    if (this.confirmTimer !== null) clearTimeout(this.confirmTimer);
    this.confirmTimer = null;
    this.armedKey = null;
  }
  private confirmLabel(edit: BulkEdit): string {
    const labels = statusLabels(this.snapshot!.type);
    const changes = [
      ...(edit.status ? [labels[edit.status]] : []),
      ...Object.entries(edit.lists).map(
        ([name, action]) => `${action === 'add' ? 'add to' : 'remove from'} ${name}`
      ),
    ];
    return `Confirm: ${changes.join(', ')} for ${this.selected.size} entries`;
  }
  private requestStop(): void {
    if (!this.busy || this.stopRequested || !this.isCurrent()) return;
    this.stopRequested = true;
    this.message!.textContent = 'Stopping after the current request finishes…';
    this.updateSelection();
  }
  /** Persistent toast, so the outcome survives leaving the page, which resets this module. */
  private summarizeRun(outcome: 'interrupted' | 'stopped', saved: number, total: number): void {
    this.toast.warn(`Bulk edit ${outcome}: ${saved} of ${total} saved.`, { duration: 0 });
  }
  private resultText(result: BulkResult, total: number): string {
    const saved = result.saved.length;
    const remaining = result.remaining.length;
    if (result.reason === 'stopped')
      return `Stopped: ${saved} of ${total} entries saved. ${remaining} remain selected.`;
    if (result.failed === null)
      return `${saved} entries saved. Reload the page to refresh AniList’s lists.`;
    if (result.reason === 'queue')
      return `${saved} entries confirmed. Paused: other Astra changes are syncing. Retry in a moment. ${remaining} remain selected.`;
    return `${saved} entries confirmed. Saving stopped; ${remaining} remain selected. Check your connection and retry. The last request may already have reached AniList.`;
  }

  private async save(): Promise<void> {
    if (!this.snapshot) return;
    const version = this.version;
    const active = () => version === this.version && this.isCurrent();
    const snapshot = this.snapshot;
    const selected = [...this.selected];
    const edit = this.readEdit();
    let written = 0;
    this.disarm();
    this.stopRequested = false;
    this.busy = true;
    this.updateSelection();
    this.message!.textContent = 'Checking the latest list before saving…';
    try {
      const result = await this.service.apply(
        snapshot,
        selected,
        edit,
        active,
        (id, done, total) => {
          written = done;
          if (!active()) return;
          this.selected.delete(id);
          this.message!.textContent = `Saved ${done}/${total} entries…`;
        },
        () => this.stopRequested
      );
      written = result.saved.length;
      if (!active()) {
        this.summarizeRun('interrupted', written, selected.length);
        return;
      }
      if (result.reason === 'stopped') this.summarizeRun('stopped', written, selected.length);
      this.message!.textContent = this.resultText(result, selected.length);
      if (result.saved.length)
        this.message!.append(
          ' ',
          button('Reload page', () => {
            if (!this.busy && active()) location.reload();
          })
        );
    } catch (error) {
      if (active())
        this.message!.textContent =
          error instanceof Error && error.message.startsWith('Wait for Astra')
            ? error.message
            : 'Could not save. Your selection is retained. Reopen the editor if your account or lists changed.';
      else this.summarizeRun('interrupted', written, selected.length);
    } finally {
      if (active()) {
        this.busy = false;
        this.updateSelection();
      }
    }
  }
  private close(): void {
    this.reset();
    this.reconcile();
  }
  private reset(): void {
    this.version++;
    this.gesture?.destroy();
    this.gesture = null;
    this.initialId = null;
    this.root?.removeEventListener('change', this.change);
    for (const [row, state] of this.checks) {
      state.input.remove();
      if (state.addedClass) row.classList.remove('au-bulk-row');
    }
    this.checks.clear();
    this.selected.clear();
    this.listControls.clear();
    this.snapshot = null;
    this.busy = false;
    this.disarm();
    this.stopRequested = false;
    this.ownsRoute = false;
    this.stopButton = null;
    this.toolbar?.remove();
    this.toolbar = null;
    this.root = null;
    this.panel = null;
    this.summary = null;
    this.message = null;
    this.status = null;
    this.editButton = null;
    this.submit = null;
    this.path = '';
  }
  override async destroy(): Promise<void> {
    this.initialized = false;
    this.observer.unregister('bulkEditor');
    this.reset();
    await super.destroy();
  }
}
