import { rerenderRatingModal } from '@/test/astra-rating-fixtures';
/** Production rating view lifetimes over synthetic account/data/save adapters in Chromium. */
import 'reflect-metadata';
import '@/styles/astra.css';
import { AstraRatingModal } from '@modules/astra/ui/AstraRatingModal';
import { AstraOverlayService } from '@modules/astra/services/AstraOverlayService';
import { AstraRatingViewScope } from '@modules/astra/ui/AstraRatingViewScope';
import { ratingInitialResponse } from '@modules/astra/services/AstraRatingResponse';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { AstraService } from '@modules/astra/AstraService';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { ToastService } from '@core/services/ToastService';
import type { IAstraRatingService, AstraSaveOptions, AstraSaveResult } from '@modules/astra/interfaces/IAstraRatingService';
import type { AstraWork } from '@modules/astra/AstraInterfaces';
import { MediaListStatus } from '@/api/AnilistTypes';
import { ratingResponse } from './astra-rating-fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((pass, fail) => { resolve = pass; reject = fail; });
  return { promise, resolve, reject };
}

function setup(options: { chapters?: number; work?: AstraWork; saveResult?: AstraSaveResult } = {}) {
  let context = { sessionId: 'synthetic-one', userId: 42 };
  const api = { getCurrentUserId: async () => context.userId, ensureContext: async () => ({ ...context }), getContext: () => ({ ...context }) };
  const bus = new EventBus();
  const feedback: string[] = [];
  const updates: number[] = [];
  bus.on(EVENT_TYPES.ASTRA_DATA_UPDATED, event => { if (event?.mediaId) updates.push(event.mediaId); });
  const writes: Array<{ work: AstraWork; extra: AstraSaveOptions }> = [];
  const commits: AstraWork[] = [];
  let nextSave: ReturnType<typeof deferred<void>> | null = null;
  const rating = {
    getMediaRatingData: async (id: number) => {
      const raw = ratingResponse(id, context.userId);
      raw.Media.coverImage.large = ''; // No remote image resource is needed by these lifecycle cases.
      if (options.chapters) Object.assign(raw.Media, { type: 'MANGA', format: 'MANGA', chapters: options.chapters, episodes: null, nextAiringEpisode: null });
      return ratingInitialResponse(raw, id, context.userId);
    },
    saveAndSync: async (work: AstraWork, extra: AstraSaveOptions) => {
      const gate = nextSave; nextSave = null;
      writes.push({ work: structuredClone(work), extra: structuredClone(extra) });
      if (gate) await gate.promise;
      commits.push(structuredClone(work));
      return options.saveResult ?? 'local';
    },
  };
  const astra = { getFullWork: async () => options.work ? structuredClone(options.work) : undefined,
    saveWork: async (patch: Partial<AstraWork>) => ({ ...structuredClone(options.work!), ...structuredClone(patch) }), getWorks: () => [], getSettings: () => ({ enableSeriesFinale: false }),
    hasFinaleSection: () => false, getSections: () => [{ id: 'story', name: 'Story', weight: 1 }],
    calcSectionScore: () => 8, calcSeasonScore: () => 8 };
  const modal = new AstraRatingModal(astra as unknown as AstraService, api as IApiClient, bus,
    { error: (message: string) => feedback.push(message), info: () => {} } as unknown as ToastService,
    rating as unknown as IAstraRatingService, new AstraOverlayService());
  const internals = modal as unknown as { save(): Promise<void>; getFocusableElements(): HTMLElement[]; state: { data: AstraWork; isDirty: boolean } };
  const root = () => document.querySelector<HTMLElement>('.astra-modal-overlay')!;
  const input = (selector: string) => root().querySelector<HTMLInputElement>(selector)!;
  return { modal, bus, writes, commits, feedback, updates, root, input, internals,
    gateSave: () => { const gate = deferred<void>(); nextSave = gate; return gate; },
    switchContext: (sessionId: string, userId = 42) => { context = { sessionId, userId }; },
    dirty: (notes: string) => { input('#astra-general-notes').value = notes; input('#astra-general-notes').dispatchEvent(new Event('input', { bubbles: true })); },
  };
}

export async function runAstraRatingLifecycleBrowserFixture(): Promise<string[]> {
  const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
  const until = async (predicate: () => boolean) => {
    const deadline = performance.now() + 4000;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error('Astra lifecycle fixture timed out');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  const frames = async () => { for (let i = 0; i < 2; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); };
  const checks: string[] = [];
  const fixtures: ReturnType<typeof setup>[] = [];
  const previousOverflow = document.body.style.overflow;
  const opener = document.createElement('button'); opener.textContent = 'Synthetic rating opener'; document.body.append(opener);
  const open = async (options?: Parameters<typeof setup>[0]) => { const f = setup(options); fixtures.push(f); await f.modal.open(1); return f; };
  try {
    const controls = await open();
    const oldRoot = controls.root();
    const oldStepper = controls.input('[data-step-field="progress"][data-step="1"]');
    const oldHeader = controls.input('[data-step-field="progress"][data-step="1"]');
    rerenderRatingModal(controls.modal);
    assert(!oldRoot.isConnected && controls.root() !== oldRoot, 'view replacement must rerender the rating root');
    const before = JSON.stringify(controls.internals.state.data);
    oldStepper.click(); oldHeader.click();
    const removed = controls.input('[data-step-field="progress"][data-step="1"]'); removed.remove(); removed.click();
    assert(JSON.stringify(controls.internals.state.data) === before && controls.writes.length === 0,
      'old rerendered/header and individually removed controls must be inert');
    checks.push('Astra removed controls and old rendered header/stepper remain inert in native DOM');
    controls.modal.dispose();

    const header = await open(); const previousHeader = header.input('[data-step-field="progress"][data-step="1"]');
    await header.modal.open(2); previousHeader.click();
    assert(header.root().querySelector<HTMLAnchorElement>('.astra-title-link')?.pathname === '/anime/2'
      && !header.internals.state.isDirty,
    'detached old header must not change the newly opened entry');
    checks.push('Astra detached header cannot mutate a subsequently opened entry');
    header.modal.dispose();

    const auth = await open(); auth.dirty('Accepted original-owner edit');
    const authGate = auth.gateSave(); const savingOnAuth = auth.internals.save();
    assert(auth.writes.length === 1 && auth.bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED) === 1, 'save and subscription must be accepted before account signal');
    const authRoot = auth.root(); const authButton = auth.input('[data-step-field="progress"][data-step="1"]');
    auth.switchContext('synthetic-two', 43);
    auth.bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, userId: 43, timestamp: new Date() });
    authButton.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    assert(!authRoot.isConnected && auth.bus.listenerCount(EVENT_TYPES.AUTH_STATE_CHANGED) === 0 && auth.writes.length === 1,
      'real account event must remove resources without accepting another write');
    authGate.resolve(); await savingOnAuth;
    assert(auth.commits.length === 1 && auth.commits[0].ownerId === 42 && auth.updates.length === 0
      && !document.querySelector('.astra-modal-overlay'), 'accepted original-owner save must finish without reviving view or emitting stale updates');
    checks.push('Astra real EventBus account change removes view; accepted original-owner save finishes without stale updates');

    const closing = await open(); closing.dirty('First entry close');
    const closeGate = closing.gateSave(); const oldClose = closing.modal.close();
    assert(closing.writes.length === 1, 'close must accept its dirty save before disposal');
    closing.modal.dispose(); await closing.modal.open(2); const reopened = closing.root();
    closeGate.resolve(); await oldClose;
    await new Promise(resolve => setTimeout(resolve, 400));
    assert(reopened.isConnected && !reopened.classList.contains('astra-modal-overlay--closing') && closing.commits.length === 1
      && closing.updates.length === 0 && closing.feedback.length === 0, 'old close completion must preserve reopened root and contain stale feedback');
    closing.modal.dispose();
    await closing.modal.open(1); closing.dirty('Failed old close');
    const rejectedCloseGate = closing.gateSave(); const rejectedClose = closing.modal.close();
    closing.modal.dispose(); await closing.modal.open(2); const reopenedAfterFailure = closing.root();
    rejectedCloseGate.reject(new Error('Synthetic previous close failure')); await rejectedClose;
    assert(reopenedAfterFailure.isConnected && !reopenedAfterFailure.classList.contains('astra-modal-overlay--closing')
      && closing.feedback.length === 0 && closing.commits.length === 1,
    'old close failure must not change reopened view or report its error there');
    checks.push('Astra accepted close-save completion/failure cannot close or report feedback on a reopened form');
    closing.modal.dispose();

    const saving = await open(); saving.dirty('First entry save');
    const saveGate = saving.gateSave(); const oldSave = saving.internals.save();
    saving.modal.dispose(); await saving.modal.open(2); saving.dirty('Second entry save'); await saving.internals.save();
    const secondRoot = saving.root(); saveGate.resolve(); await oldSave;
    assert(saving.writes.length === 2 && saving.writes[0].work.mediaId === 1 && saving.writes[1].work.mediaId === 2
      && saving.commits.length === 2 && saving.updates.length === 1 && saving.updates[0] === 2
      && secondRoot.isConnected && saving.input('#astra-general-notes').value === 'Second entry save',
    'new entry must accept an independent save while original accepted save finishes harmlessly');
    checks.push('Astra reopening accepts an independent save and isolates the previous accepted save result');
    saving.modal.dispose();

    document.body.style.overflow = 'scroll'; opener.focus();
    const focus = await open(); await frames();
    const elements = focus.internals.getFocusableElements();
    assert(elements.length > 1 && document.body.style.overflow === 'hidden'
      && elements.every(element => !element.matches('input[type="hidden"], :disabled')
        && !element.closest('#astra-tab-journal, .astra-dropdown-menu') && element.getClientRects().length > 0),
    'native CSS focus list must contain visible active-tab controls only');
    elements[0].focus();
    const backwards = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    elements[0].dispatchEvent(backwards);
    assert(backwards.defaultPrevented && document.activeElement === elements[elements.length - 1], 'Shift+Tab must wrap to last active control');
    const forwards = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    elements[elements.length - 1].dispatchEvent(forwards);
    assert(forwards.defaultPrevented && document.activeElement === elements[0], 'Tab must wrap to first active control');
    await focus.modal.close(); await until(() => !document.querySelector('.astra-modal-overlay'));
    assert(document.body.style.overflow === 'scroll' && document.activeElement === opener, 'close must restore prior overflow and native opener focus');
    checks.push('Astra native CSS/DOM focus wraps both ways among active controls and restores overflow/opener on close');

    const failing = await open(); failing.dirty('Retained failing edit');
    const failedSave = failing.gateSave(); failing.input('[data-tab="journal"]').click();
    assert(failing.writes.length === 1, 'tab action must start its dirty save');
    failedSave.reject(new Error('Synthetic lifecycle save failure'));
    await until(() => failing.feedback.length === 1);
    assert(failing.root().querySelector('.astra-tab-content--active')?.id === 'astra-tab-rating'
      && failing.input('#astra-general-notes').value === 'Retained failing edit'
      && failing.internals.state.isDirty && failing.commits.length === 0, 'async tab failure must remain contained and preserve current draft/tab');
    checks.push('Astra async tab-save failure is contained and preserves the active tab and unsaved draft');
    failing.modal.dispose();

    const historyTimestamp = 1760000000000;
    const journal = await open({ chapters: 20000, work: {
      id: 'synthetic-journal', mediaId: 1, ownerId: 42, title: 'Synthetic long journal', type: 'manga',
      status: MediaListStatus.CURRENT, customLists: [], tags: [], notes: '', progress: 3, chapters: 20000, updatedAt: 1,
      seasons: [{ id: 'synthetic-season', scores: {}, notes: 'Journal seed', episodeNotes: {
        1: { text: 'First page note', timestamp: historyTimestamp },
        5000: { text: 'Distant chapter note', timestamp: historyTimestamp },
        20500: { text: 'History beyond current metadata', timestamp: historyTimestamp },
      } }],
    } });
    const rowCount = () => journal.root().querySelectorAll('.astra-ep-row').length;
    assert(rowCount() === 100 && journal.input('[data-astra-journal-jump]').max === '20500',
      'long journal must render a bounded page and expose saved history beyond metadata totals');
    const firstNote = journal.input('.astra-ep-textarea[data-ep="1"]');
    firstNote.value = 'First page edited'; firstNote.dispatchEvent(new Event('input', { bubbles: true }));
    const oldPicker = journal.root().querySelector<HTMLElement>('.astra-ep-date-picker[data-ep="1"]')!;
    oldPicker.querySelector<HTMLButtonElement>('button')!.click();
    const oldClear = oldPicker.querySelector<HTMLButtonElement>('[data-clear]')!;
    const oldNext = journal.input('[data-astra-journal-page="next"]'); oldNext.click();
    const afterPage = JSON.stringify(journal.internals.state.data);
    oldClear.click(); oldNext.click();
    assert(oldPicker.dataset.timestamp === String(historyTimestamp) && JSON.stringify(journal.internals.state.data) === afterPage
      && journal.input('.astra-ep-textarea').dataset.ep === '101' && rowCount() === 100,
    'replaced journal controls must be inert and retain first-page edits/history');
    const jump = (episode: number) => {
      const control = journal.input('[data-astra-journal-jump]'); control.value = String(episode);
      control.dispatchEvent(new Event('change', { bubbles: true }));
    };
    jump(5000);
    const distantNote = journal.input('.astra-ep-textarea[data-ep="5000"]');
    assert(distantNote.value === 'Distant chapter note' && rowCount() === 100, 'jump must reach distant history without expanding rows');
    distantNote.value = 'Distant chapter edited'; distantNote.dispatchEvent(new Event('input', { bubbles: true }));
    jump(20500);
    assert(journal.input('.astra-ep-textarea[data-ep="20500"]').value === 'History beyond current metadata' && rowCount() === 100,
      'saved history beyond the current metadata total must remain reachable');
    journal.dirty('Journal edits retained'); await journal.internals.save();
    const committedNotes = journal.commits[0].seasons[0].episodeNotes!;
    assert(committedNotes[1].text === 'First page edited' && committedNotes[5000].text === 'Distant chapter edited'
      && committedNotes[20500].text === 'History beyond current metadata' && committedNotes[5000].timestamp === historyTimestamp,
    'paging and lower progress must preserve edited and off-page saved history');
    checks.push('Astra journal bounds native rows, jumps to saved history, preserves page edits and releases replaced date/page controls');
    journal.modal.dispose();

    for (const result of ['local', 'queued'] as const) {
      const saveClick = await open({ saveResult: result }); await frames();
      const saveRoot = saveClick.root();
      const gate = saveClick.gateSave(); saveClick.dirty(`Native ${result} save`);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await until(() => saveClick.writes.length === 1);
      assert(saveClick.writes.length === 1 && saveClick.commits.length === 0
        && saveRoot.isConnected && !saveRoot.classList.contains('astra-modal-overlay--closing'),
      'native close must wait for one durable acknowledgement before closing');
      gate.resolve(); await until(() => saveRoot.classList.contains('astra-modal-overlay--closing'));
      await until(() => !saveRoot.isConnected);
      assert(saveClick.commits.length === 1 && saveClick.feedback.length === 0
        && saveClick.writes[0].extra.notes === `Native ${result} save`,
      'both local and queued durable results must close with their accepted snapshot');
      saveClick.modal.dispose();
    }
    checks.push('Astra native Rating close waits for durable local/queued acknowledgement without duplicate writes');

    const changedSave = await open(); await frames(); const changedRoot = changedSave.root();
    const changedGate = changedSave.gateSave(); changedSave.dirty('Native first snapshot');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await until(() => changedSave.writes.length === 1);
    changedSave.dirty('Native newer edit'); changedGate.resolve(); await until(() => changedSave.commits.length === 1); await frames();
    assert(changedRoot.isConnected && !changedRoot.classList.contains('astra-modal-overlay--closing')
      && changedSave.internals.state.isDirty && changedSave.input('#astra-general-notes').value === 'Native newer edit'
      && changedSave.commits.length === 1 && changedSave.commits[0].seasons[0].notes === 'Native first snapshot',
    'a native edit during pending Save must remain open beyond the acknowledged snapshot');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await until(() => !changedRoot.isConnected);
    assert(changedSave.commits.length === 2 && changedSave.commits[1].seasons[0].notes === 'Native newer edit'
      && changedSave.feedback.length === 0, 'explicit retry must persist the newer snapshot before closing');
    checks.push('Astra native pending Save retains newer edits and closes only after their explicit retry is durable');
    changedSave.modal.dispose();

    const journalSave = await open();
    journalSave.input('[data-tab="journal"]').click();
    await until(() => journalSave.root().querySelector('.astra-tab-content--active')?.id === 'astra-tab-journal'); await frames();
    const journalSaveRoot = journalSave.root();
    const watchedPicker = journalSaveRoot.querySelector<HTMLElement>('.astra-ep-date-picker[data-ep="1"]')!;
    watchedPicker.querySelector<HTMLButtonElement>('.astra-ep-date-trigger')!.click(); await frames();
    const selectedDay = watchedPicker.querySelector<HTMLButtonElement>('[data-day]')!;
    const [year, month, day] = selectedDay.dataset.day!.split('-').map(Number);
    const localTime = watchedPicker.querySelector<HTMLInputElement>('input[type="time"]')!;
    assert(localTime.getClientRects().length > 0, 'shared journal calendar must expose its local time input in native CSS');
    localTime.value = '07:35'; localTime.dispatchEvent(new Event('input', { bubbles: true })); selectedDay.click();
    const expectedTimestamp = new Date(year, month - 1, day, 7, 35).getTime();
    const selectedLocalDate = new Date(Number(watchedPicker.dataset.timestamp));
    assert(Number(watchedPicker.dataset.timestamp) === expectedTimestamp
      && selectedLocalDate.getHours() === 7 && selectedLocalDate.getMinutes() === 35,
    'shared calendar selection must preserve the chosen local time');
    const journalSaveGate = journalSave.gateSave(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await until(() => journalSave.writes.length === 1);
    assert(journalSave.writes.length === 1 && journalSave.commits.length === 0
      && !journalSaveRoot.classList.contains('astra-modal-overlay--closing'), 'Journal close must also wait for durable acknowledgement');
    journalSaveGate.resolve(); await until(() => !journalSaveRoot.isConnected);
    assert(journalSave.commits.length === 1 && journalSave.commits[0].seasons[0].episodeNotes?.[1].timestamp === expectedTimestamp
      && journalSave.feedback.length === 0, 'Journal close must commit the selected local date/time before closing');
    checks.push('Astra native Journal close commits shared-calendar selection with its chosen local time');
    journalSave.modal.dispose();

    const scopeRoot = document.createElement('div'); const scopeButton = document.createElement('button');
    scopeRoot.append(scopeButton); document.body.append(scopeRoot);
    let failures = 0; let lateEffects = 0;
    const scope = new AstraRatingViewScope(scopeRoot, () => true, () => { failures++; });
    try {
      const scopeGate = deferred<void>(); let pending = scopeGate.promise;
      scope.listen(scopeButton, 'click', () => pending); scopeButton.click();
      scopeGate.reject(new Error('Synthetic scope callback failure')); await until(() => failures === 1);
      const staleGate = deferred<void>(); pending = staleGate.promise; scopeButton.click();
      scope.frame(() => { lateEffects++; }); scope.timeout(() => { lateEffects++; }, 10);
      scope.release(); scope.release(); staleGate.reject(new Error('Synthetic released callback failure')); scopeButton.click();
      await frames(); await new Promise(resolve => setTimeout(resolve, 20));
      assert(failures === 1 && lateEffects === 0 && !scope.active, 'released scope must cancel timers/frames/listeners and contain late async failures');
      checks.push('Astra native view scope contains async failures and cancels released listeners, frames and timers');
    } finally { scope.release(); scopeRoot.remove(); }
    return checks;
  } finally {
    for (const fixture of fixtures) { fixture.modal.dispose(); fixture.bus.clear(); }
    opener.remove(); document.body.style.overflow = previousOverflow;
  }
}
