import type { IApiClient } from '@core/interfaces/IApiClient';
import type { CalendarCustomPlan } from '@core/types';
import { DAYS_OF_WEEK } from '@core/constants';
import { BackgroundOperationError } from '@core/errors/OperationFailure';
import { CalendarStore } from '../CalendarStore';
import { CalendarPlanCandidates, normalizePlanSearch, type CalendarPlanCandidate } from '../CalendarPlanCandidates';

interface PanelOptions {
  api: IApiClient;
  store: CalendarStore;
  ownerId: number;
  initialPlan?: CalendarCustomPlan;
  onChanged: () => void;
  onClose: () => void;
}
type Source = 'lists' | 'search';

export class CustomCalendarPlanPanel {
  private element: HTMLElement | null = null;
  private selected: CalendarCustomPlan | null = null;
  private editingPlan = false;
  private busy = false;
  private previousFocus: HTMLElement | null = null;
  private previousOverflow = '';
  private source: Source = 'lists';
  private version = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private searchRunning = false;
  private queuedSearch: { title: string; version: number; refresh: boolean } | null = null;
  private listCandidates: CalendarPlanCandidate[] | null = null;
  private candidates = new Map<number, CalendarPlanCandidate>();
  private displayed: CalendarPlanCandidate[] = [];
  private resultLimit = 50;
  private inputValues: Record<Source, string> = { lists: '', search: '' };
  private readonly provider: CalendarPlanCandidates;

  constructor(private options: PanelOptions) {
    this.provider = new CalendarPlanCandidates(options.api, options.ownerId);
  }

  public mount(parent: HTMLElement): void {
    if (this.element) return;
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const overlay = document.createElement('div');
    overlay.className = 'calendar-plan-overlay';
    overlay.innerHTML = `
      <section class="calendar-plan-panel" role="dialog" aria-modal="true" aria-labelledby="calendar-plan-title">
        <header class="calendar-plan-panel__header">
          <div><span class="calendar-plan-panel__eyebrow">PERSONAL SCHEDULE</span><h2 id="calendar-plan-title">Add to calendar</h2></div>
          <button type="button" class="calendar-plan-panel__close" aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </header>
        <p class="calendar-plan-panel__intro">Make room for your next episode. Choose an anime, then set your weekly slot.</p>
        <div class="calendar-plan-saved" hidden><h3>Your personal plans</h3><div class="calendar-plan-saved__list"></div></div>
        <div class="calendar-plan-picker">
          <div class="calendar-plan-sources" role="tablist" aria-label="Choose anime source">
            <button type="button" id="calendar-plan-tab-lists" role="tab" data-source="lists" aria-controls="calendar-plan-picker-content" aria-selected="true"><i class="fa-solid fa-list" aria-hidden="true"></i><span>My lists</span><small>Watching &amp; Rewatching</small></button>
            <button type="button" id="calendar-plan-tab-search" role="tab" data-source="search" aria-controls="calendar-plan-picker-content" aria-selected="false" tabindex="-1"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><span>Search AniList</span><small>Find an anime by title</small></button>
          </div>
          <div id="calendar-plan-picker-content" role="tabpanel" aria-labelledby="calendar-plan-tab-lists">
            <form class="calendar-plan-search" role="search">
              <label for="calendar-plan-search-input">Filter your lists</label>
              <div class="calendar-plan-search__row"><input id="calendar-plan-search-input" type="search" maxlength="100" autocomplete="off" aria-describedby="calendar-plan-hint" placeholder="Filter by title…"><button type="submit" hidden><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><span>Search</span></button><button type="button" class="calendar-plan-refresh" aria-label="Refresh lists"><i class="fa-solid fa-arrow-rotate-left" aria-hidden="true"></i></button></div>
            </form>
            <p id="calendar-plan-hint" class="calendar-plan-hint">Your Watching and Rewatching lists. Filter instantly by English, Romaji or native title.</p>
            <div class="calendar-plan-results" role="list" aria-label="Anime results" aria-busy="false"></div>
            <button type="button" class="calendar-plan-more" hidden>Show more</button>
            <button type="button" class="calendar-plan-retry" hidden>Try again</button>
          </div>
        </div>
        <p class="calendar-plan-status" role="status" aria-live="polite"></p>
        <form class="calendar-plan-editor" hidden>
          <div class="calendar-plan-editor__selected"><img alt=""><div><strong></strong><span>Weekly personal slot</span></div></div>
          <div class="calendar-plan-editor__fields">
            <label>Day of week<select name="day"></select></label>
            <label>Time<input name="time" type="time" value="20:00" required></label>
          </div>
          <div class="calendar-plan-editor__actions"><button type="button" class="calendar-plan-back">Choose another</button><button type="button" class="calendar-plan-remove" hidden>Remove plan</button><button type="submit" class="calendar-plan-save">Save plan</button></div>
        </form>
      </section>`;
    this.element = overlay;
    parent.append(overlay);
    const select = this.control<HTMLSelectElement>('[name="day"]');
    [...DAYS_OF_WEEK.slice(1), DAYS_OF_WEEK[0]].forEach(day => {
      const option = document.createElement('option'); option.value = day; option.textContent = day; select.append(option);
    });
    this.control('.calendar-plan-panel__close').addEventListener('click', () => this.close());
    overlay.addEventListener('click', event => { if (event.target === overlay) this.close(); });
    overlay.addEventListener('keydown', event => this.handleKeydown(event));
    this.control('.calendar-plan-search').addEventListener('submit', event => { event.preventDefault(); this.onInput(true); });
    this.control('.calendar-plan-search input').addEventListener('input', event => {
      if (!(event instanceof InputEvent) || !event.isComposing) this.onInput();
    });
    this.control('.calendar-plan-search input').addEventListener('compositionend', () => this.onInput());
    this.control('.calendar-plan-sources').addEventListener('click', event => {
      const tab = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-source]') : null;
      if (tab?.dataset.source === 'lists' || tab?.dataset.source === 'search') this.switchSource(tab.dataset.source);
    });
    this.control('.calendar-plan-results').addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-media-id]') : null;
      if (!button || button.disabled || this.busy) return;
      const candidate = this.candidates.get(Number(button.dataset.mediaId));
      if (candidate && !candidate.unavailable) this.showEditor(candidate);
    });
    this.control('.calendar-plan-more').addEventListener('click', () => {
      const previous = this.resultLimit; this.resultLimit += 50; this.renderResults();
      this.element?.querySelectorAll<HTMLButtonElement>('[data-media-id]')[previous]?.focus();
    });
    this.control('.calendar-plan-retry').addEventListener('click', () => {
      if (this.source === 'lists') void this.loadLists(); else this.onInput(true);
    });
    this.control('.calendar-plan-refresh').addEventListener('click', () => void this.loadLists(true));
    this.control('.calendar-plan-editor').addEventListener('submit', event => { event.preventDefault(); void this.save(); });
    this.control('.calendar-plan-remove').addEventListener('click', () => void this.remove());
    this.control('.calendar-plan-back').addEventListener('click', () => {
      if (this.busy) return;
      this.selected = null; this.editingPlan = false;
      this.control('.calendar-plan-editor').hidden = true;
      this.control('.calendar-plan-picker').hidden = false;
      this.control('#calendar-plan-title').textContent = 'Add to calendar';
      this.control('.calendar-plan-panel__intro').textContent = 'Make room for your next episode. Choose an anime, then set your weekly slot.';
      this.renderSavedPlans(); this.switchSource(this.source, true);
    });
    this.control('.calendar-plan-saved__list').addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-edit-plan]') : null;
      const plan = button && this.options.store.getCustomPlans(this.options.ownerId).find(item => item.mediaId === Number(button.dataset.editPlan));
      if (plan) this.showEditor(plan, true);
    });
    if (this.options.initialPlan) this.showEditor(this.options.initialPlan, true);
    else { this.renderSavedPlans(); this.switchSource('lists', true); }
  }

  private control<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.element!.querySelector<T>(selector)!;
  }

  private invalidate(): number {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null; this.queuedSearch = null;
    return ++this.version;
  }

  private switchSource(source: Source, force = false): void {
    if (!this.element || this.busy || (!force && source === this.source)) return;
    this.inputValues[this.source] = this.control<HTMLInputElement>('#calendar-plan-search-input').value;
    this.invalidate(); this.source = source;
    this.element.querySelectorAll<HTMLElement>('[data-source]').forEach(tab => {
      const active = tab.dataset.source === source;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    });
    this.control('#calendar-plan-picker-content').setAttribute('aria-labelledby', `calendar-plan-tab-${source}`);
    const input = this.control<HTMLInputElement>('#calendar-plan-search-input');
    input.value = this.inputValues[source];
    input.placeholder = source === 'lists' ? 'Filter by title…' : 'Start typing an anime title…';
    this.control('.calendar-plan-search label').textContent = source === 'lists' ? 'Filter your lists' : 'Search anime';
    this.control('.calendar-plan-search [type="submit"]').hidden = source === 'lists';
    this.control('.calendar-plan-refresh').hidden = source !== 'lists';
    this.control('#calendar-plan-hint').textContent = source === 'lists'
      ? 'Your Watching and Rewatching lists. Filter instantly by English, Romaji or native title.'
      : 'Type at least 2 characters. Suggestions appear automatically; no exact title needed.';
    this.control('.calendar-plan-retry').hidden = true;
    this.setResultsBusy(false); this.setResults([]); input.focus();
    if (source === 'lists') {
      if (this.listCandidates) this.filterLists(); else void this.loadLists();
    } else this.onInput();
  }

  private onInput(immediate = false): void {
    if (!this.element || this.busy || this.selected) return;
    const token = this.invalidate();
    this.inputValues[this.source] = this.control<HTMLInputElement>('#calendar-plan-search-input').value;
    this.control('.calendar-plan-retry').hidden = true;
    if (this.source === 'lists') { this.filterLists(); return; }
    this.setResults([]); this.setResultsBusy(false);
    const title = this.inputValues.search.trim();
    if (title.length < 2) { this.setStatus(''); return; }
    this.setStatus('Waiting to search…');
    const enqueue = () => { this.timer = null; this.queuedSearch = { title, version: token, refresh: immediate }; void this.runSearch(); };
    if (immediate) enqueue(); else this.timer = setTimeout(enqueue, 500);
  }

  private async loadLists(refresh = false): Promise<void> {
    if (!this.element) return;
    // Local filter edits must not cancel the shared list download.
    const root = this.element;
    this.control<HTMLButtonElement>('.calendar-plan-refresh').disabled = true;
    if (refresh) { this.listCandidates = null; this.setResults([]); }
    this.control('.calendar-plan-retry').hidden = true;
    this.setResultsBusy(true); this.setStatus('Loading your AniList lists…');
    try {
      const results = await this.provider.fromLists(refresh);
      if (this.element !== root) return;
      this.listCandidates = results;
      if (this.source === 'lists' && !this.selected) { this.setResultsBusy(false); this.filterLists(); }
    } catch (error) {
      if (this.element === root && this.source === 'lists' && !this.selected) this.showFailure(error);
    } finally { if (this.element === root) this.control<HTMLButtonElement>('.calendar-plan-refresh').disabled = false; }
  }

  private filterLists(): void {
    if (!this.listCandidates) return;
    const words = normalizePlanSearch(this.inputValues.lists).split(/\s+/).filter(Boolean);
    const results = this.listCandidates.filter(item => words.every(word => item.searchText.includes(word)));
    const visibleCount = this.setResults(results);
    this.setStatus(visibleCount ? `${visibleCount} anime · Choose a title for your personal schedule.`
      : results.length ? 'No more anime to add from these lists. Try Search AniList.'
      : this.listCandidates.length ? 'No matching anime in your lists. Try Search AniList.'
        : 'Your Watching and Rewatching lists are empty. Find a title with Search AniList.');
  }

  /** At most one search is in flight. While it runs, only the latest input is retained. */
  private async runSearch(): Promise<void> {
    if (this.searchRunning) return;
    this.searchRunning = true;
    try {
      while (this.queuedSearch && this.element) {
        const request = this.queuedSearch; this.queuedSearch = null;
        if (request.version !== this.version || this.source !== 'search' || this.selected) continue;
        this.setResultsBusy(true); this.setStatus('Searching AniList…');
        try {
          const results = await this.provider.search(request.title, request.refresh);
          if (!this.element || request.version !== this.version) continue;
          const visibleCount = this.setResults(results); this.setResultsBusy(false);
          this.setStatus(visibleCount ? 'Choose an anime. Only Watching and Rewatching titles can be scheduled.'
            : results.length ? 'No new anime to add for this search. Try another title.' : 'No anime found. Try another title or spelling.');
        } catch (error) {
          if (this.element && request.version === this.version) this.showFailure(error);
        }
      }
    } finally { this.searchRunning = false; }
  }

  private setResults(results: CalendarPlanCandidate[]): number {
    this.displayed = results; this.resultLimit = 50; this.renderResults();
    return this.displayed.length;
  }

  private renderResults(): void {
    if (!this.element) return;
    const container = this.control('.calendar-plan-results'); container.replaceChildren(); this.candidates.clear();
    const scheduled = new Set([
      ...this.options.store.getCustomPlans(this.options.ownerId).map(plan => plan.mediaId),
      ...this.options.store.getState().entries.map(entry => entry.mediaId),
    ]);
    // Exclude existing titles before counting and paging the additions.
    this.displayed = this.displayed.filter(candidate => candidate.unavailable !== 'airing' && !scheduled.has(candidate.mediaId));
    for (const candidate of this.displayed.slice(0, this.resultLimit)) {
      this.candidates.set(candidate.mediaId, candidate);
      const row = document.createElement('div'); row.setAttribute('role', 'listitem');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'calendar-plan-result';
      button.dataset.mediaId = String(candidate.mediaId); button.disabled = !!candidate.unavailable;
      if (candidate.coverImage) {
        const image = document.createElement('img'); image.src = candidate.coverImage; image.alt = ''; image.loading = 'lazy'; button.append(image);
      }
      const details = document.createElement('span'); details.className = 'calendar-plan-result__details';
      const name = document.createElement('strong'); name.textContent = candidate.title;
      const meta = document.createElement('span');
      meta.textContent = candidate.unavailable === 'completed' ? 'All episodes watched'
        : candidate.unavailable === 'list' ? 'Set to Watching or Rewatching on AniList first'
        : `${candidate.status === 'REPEATING' ? 'Rewatching' : 'Watching'} · ${candidate.progress}${candidate.totalEpisodes ? ` / ${candidate.totalEpisodes}` : ''} episodes watched`;
      details.append(name);
      if (candidate.description) { const description = document.createElement('span'); description.textContent = candidate.description; details.append(description); }
      details.append(meta); button.append(details);
      const icon = document.createElement('i'); icon.className = 'fa-solid fa-chevron-right'; icon.setAttribute('aria-hidden', 'true');
      button.append(icon); row.append(button);
      if (candidate.unavailable === 'list') {
        const link = document.createElement('a'); link.className = 'calendar-plan-result__link'; link.href = candidate.siteUrl;
        link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open on AniList';
        link.setAttribute('aria-label', `Open ${candidate.title} on AniList`); row.append(link);
      }
      container.append(row);
    }
    this.control('.calendar-plan-more').hidden = this.displayed.length <= this.resultLimit;
  }

  private renderSavedPlans(): void {
    const plans = this.options.store.getCustomPlans(this.options.ownerId);
    const section = this.control('.calendar-plan-saved'); section.hidden = plans.length === 0;
    const list = this.control('.calendar-plan-saved__list'); list.replaceChildren();
    for (const plan of plans) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.editPlan = String(plan.mediaId);
      button.className = 'calendar-plan-saved__item';
      const title = document.createElement('strong'); title.textContent = plan.title;
      const schedule = document.createElement('span'); schedule.textContent = `${plan.dayOfWeek} · ${plan.time}`;
      const edit = document.createElement('i'); edit.className = 'fa-solid fa-pen'; edit.setAttribute('aria-hidden', 'true');
      button.append(title, schedule, edit); list.append(button);
    }
  }

  private showEditor(plan: CalendarCustomPlan, saved = false): void {
    if (!this.element || this.busy) return;
    this.invalidate(); this.selected = { ...plan }; this.editingPlan = saved;
    this.control('.calendar-plan-picker').hidden = true; this.control('.calendar-plan-saved').hidden = true;
    this.control('#calendar-plan-title').textContent = saved ? 'Edit personal plan' : 'Choose your weekly slot';
    this.control('.calendar-plan-panel__intro').textContent = saved
      ? 'Adjust your weekly slot, or remove this personal plan.' : 'Pick a day and time for your next episode.';
    const editor = this.control<HTMLFormElement>('.calendar-plan-editor');
    const image = editor.querySelector<HTMLImageElement>('img')!;
    image.hidden = !plan.coverImage;
    if (plan.coverImage) image.src = plan.coverImage; else image.removeAttribute('src');
    editor.querySelector('strong')!.textContent = plan.title;
    this.control<HTMLSelectElement>('[name="day"]').value = plan.dayOfWeek;
    this.control<HTMLInputElement>('[name="time"]').value = plan.time;
    this.control('.calendar-plan-remove').hidden = !saved;
    this.control('.calendar-plan-back').hidden = !!this.options.initialPlan;
    editor.hidden = false; this.control('[name="day"]').focus();
    this.setStatus('Repeats every week in your local time. Episode progress stays synced with AniList.');
  }

  private async save(): Promise<void> {
    if (!this.selected || this.busy || !this.element) return;
    const form = this.control<HTMLFormElement>('.calendar-plan-editor');
    if (!form.reportValidity()) return;
    const plan: CalendarCustomPlan = { ...this.selected,
      dayOfWeek: this.control<HTMLSelectElement>('[name="day"]').value as CalendarCustomPlan['dayOfWeek'],
      time: this.control<HTMLInputElement>('[name="time"]').value };
    this.setEditorBusy(true); this.setStatus('Saving your plan…');
    try {
      await this.provider.assertCurrent();
      await this.options.store.saveCustomPlan(this.options.ownerId, plan);
      this.options.onChanged(); this.close();
    } catch (error) { if (this.element) this.setStatus(this.describeFailure(error, 'The plan could not be saved. Try again.')); }
    finally { this.setEditorBusy(false); }
  }

  private async remove(): Promise<void> {
    if (!this.selected || this.busy || !this.editingPlan) return;
    this.setEditorBusy(true); this.setStatus('Removing your plan…');
    try {
      await this.provider.assertCurrent();
      await this.options.store.removeCustomPlan(this.options.ownerId, this.selected.mediaId);
      this.options.onChanged(); this.close();
    } catch (error) { if (this.element) this.setStatus(this.describeFailure(error, 'The plan could not be removed. Try again.')); }
    finally { this.setEditorBusy(false); }
  }

  private setEditorBusy(busy: boolean): void {
    this.busy = busy;
    this.element?.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>('.calendar-plan-editor button, .calendar-plan-editor select, .calendar-plan-editor input')
      .forEach(control => { control.disabled = busy; });
  }

  private setResultsBusy(busy: boolean): void { this.control('.calendar-plan-results').setAttribute('aria-busy', String(busy)); }
  private setStatus(message: string): void { if (this.element) this.control('.calendar-plan-status').textContent = message; }
  private showFailure(error: unknown): void {
    this.setResultsBusy(false); this.setResults([]);
    this.control('.calendar-plan-retry').hidden = false;
    this.setStatus(this.describeFailure(error, this.source === 'lists' ? 'Your lists could not be loaded. Try again or use Search AniList.' : 'AniList search failed. Try again.'));
  }

  private describeFailure(error: unknown, fallback: string): string {
    if (error instanceof Error && /account changed|context changed|queue cleared/i.test(error.message)) return 'The AniList account changed. Close this panel and reopen the calendar.';
    if (!(error instanceof BackgroundOperationError)) return fallback;
    switch (error.failureCode) {
      case 'API_AUTH': return 'AniList authentication failed. Reconnect your account and try again.';
      case 'API_LIMIT': return 'AniList is temporarily limiting requests. Wait a little, then try again.';
      case 'API_REQUEST': return `AniList rejected the request${error.statusCode ? ` (HTTP ${error.statusCode})` : ''}. Try again.`;
      case 'ACCOUNT_CHANGED': return 'The AniList account changed. Close this panel and reopen the calendar.';
      case 'TRANSPORT': return 'The background service could not be reached. Reload the extension and try again.';
      default: return fallback;
    }
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return; }
    if (!this.element) return;
    if (event.target instanceof HTMLElement && event.target.matches('[role="tab"]')
      && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      this.switchSource(event.key === 'Home' ? 'lists' : event.key === 'End' ? 'search' : this.source === 'lists' ? 'search' : 'lists');
      this.control(`[data-source="${this.source}"]`).focus(); return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const buttons = [...this.element.querySelectorAll<HTMLButtonElement>('[data-media-id]:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index >= 0 || event.target === this.control('#calendar-plan-search-input')) {
        event.preventDefault();
        if (event.key === 'ArrowUp' && index <= 0) this.control('#calendar-plan-search-input').focus();
        else buttons[Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))]?.focus();
        return;
      }
    }
    if (event.key !== 'Tab') return;
    const focusable = [...this.element.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')]
      .filter(item => item.tabIndex >= 0 && !item.closest('[hidden]') && item.getClientRects().length > 0);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  public close(): void {
    const element = this.element; if (!element) return;
    this.invalidate(); this.element = null; element.remove();
    document.body.style.overflow = this.previousOverflow;
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
    this.options.onClose();
  }
}
