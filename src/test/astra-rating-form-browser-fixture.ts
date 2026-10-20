import { AstraRatingModal } from '@modules/astra/ui/AstraRatingModal';
import { AstraOverlayService } from '@modules/astra/services/AstraOverlayService';
import { ratingInitialResponse } from '@modules/astra/services/AstraRatingResponse';
import type { AstraService } from '@modules/astra/AstraService';
import type { IApiClient } from '@core/interfaces/IApiClient';
import type { IEventBus } from '@core/interfaces/IEventBus';
import type { ToastService } from '@core/services/ToastService';
import type { IAstraRatingService, AstraSaveOptions } from '@modules/astra/interfaces/IAstraRatingService';
import type { AstraWork } from '@modules/astra/AstraInterfaces';
import { ratingResponse, rerenderRatingModal } from './astra-rating-fixtures';
import { AstraSaveFailure } from '@modules/astra/services/AstraSaveFailure';
import { BackgroundOperationError } from '@core/errors/OperationFailure';

export async function runAstraRatingFormBrowserFixture(): Promise<string[]> {
  const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
  const checks: string[] = []; const previousOverflow = document.body.style.overflow;
  const hostile = '\n</textarea><img data-astra-injected src=x onerror="alert(1)">';
  const listName = 'Favorites" ><img data-astra-injected> & manga';
  const raw = ratingResponse(); raw.Media.mediaListEntry.notes = hostile; raw.Media.coverImage.large = 'javascript:alert(1)';
  raw.Viewer.mediaListOptions.animeList.customLists = [listName, 'constructor'];
  Object.assign(raw.Media.mediaListEntry, { customLists: { [listName]: true } });
  const data = ratingInitialResponse(raw, 1, 42)!;
  const saves: AstraSaveOptions[] = []; let gate: Promise<void> | null = null;
  let errors = 0; let deletions = 0;
  const messages: string[] = []; let saveFailure: Error | null = null;
  const rating = { getMediaRatingData: async () => structuredClone(data),
    deleteEntry: async () => { deletions++; return 'queued' as const; },
    saveAndSync: async (_work: AstraWork, extra: AstraSaveOptions) => {
    if (saveFailure) throw saveFailure;
    saves.push(structuredClone(extra)); if (gate) await gate; return 'local' as const;
  } };
  const astra = { getFullWork: async () => undefined, getWorks: () => [], getSettings: () => ({ enableSeriesFinale: false }),
    hasFinaleSection: () => false, getSections: () => [{ id: 'story', name: 'Story', weight: 1 }],
    calcSectionScore: () => 8, calcSeasonScore: () => 8 };
  const modal = new AstraRatingModal(astra as unknown as AstraService, { getCurrentUserId: async () => 42 } as IApiClient,
    { emit: () => {} } as unknown as IEventBus, { error: (message: string) => { errors++; messages.push(message); }, info: () => {} } as unknown as ToastService,
    rating as unknown as IAstraRatingService, new AstraOverlayService());
  const root = () => document.querySelector<HTMLElement>('.astra-modal-overlay')!;
  const input = (selector: string) => root().querySelector<HTMLInputElement>(selector)!;
  const save = () => (modal as unknown as { save(): Promise<void> }).save();
  try {
    await modal.open(1);
    assert(!root().querySelector('[data-astra-injected]') && input('#astra-general-notes').value === hostile,
      'remote notes/list names must remain literal in Chromium parsing');
    assert(!input('#astra-cover').hasAttribute('src') && input('.astra-custom-list-cb').dataset.name === listName
      && root().querySelectorAll('.astra-custom-list-cb:checked').length === 1, 'unsafe covers and inherited list names must not bind/select');
    checks.push('Astra form renders notes/list names literally and rejects unsafe cover URLs in Chromium');

    for (const status of ['PLANNING', 'CURRENT']) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.id = 'astra-status-icon';
      root().querySelector('#astra-status-icon')!.replaceWith(svg);
      root().querySelector<HTMLElement>(`.astra-status-option[data-value="${status}"]`)!.click();
      assert((modal as unknown as { state: { data: AstraWork } }).state.data.status === status
        && root().querySelector('.astra-status-option.active')?.getAttribute('data-value') === status && errors === 0,
      'host SVG replacement must not interrupt status selection');
    }
    const deletionBox = input('#astra-delete-entry').getBoundingClientRect();
    const modalBox = root().querySelector('.astra-modal')!.getBoundingClientRect();
    assert(deletionBox.width > 0 && deletionBox.height > 0 && deletionBox.bottom <= modalBox.bottom + 1,
      'Delete entry must remain within the visible modal');
    checks.push('Astra status selection works with native read-only SVG className and Delete entry stays inside the modal');

    input('#astra-progress').value = '0'; input('#astra-repeat').value = '2'; input('#astra-private-cb').checked = true;
    input('.astra-custom-list-cb').checked = false; input('#astra-general-notes').value = 'Edited';
    rerenderRatingModal(modal); await save();
    assert(root().querySelectorAll('.astra-custom-list-cb').length === 2 && saves[0].progress === 0 && saves[0].repeat === 2
      && saves[0].private === true && saves[0].customLists?.length === 0 && saves[0].notes === 'Edited', 'view replacement must preserve all quick-edit fields');
    checks.push('Astra view replacement retains unsaved quick-edit fields and list choices before saving');

    assert(saves[0].startedAt?.year === 2026 && saves[0].startedAt.month === null && saves[0].startedAt.day === null,
      'an unrelated edit must preserve year-only dates');
    const picker = root().querySelector<HTMLElement>('[data-target="astra-start-date"]')!;
    picker.querySelector<HTMLButtonElement>('button')!.click();
    picker.querySelector<HTMLButtonElement>('[data-clear]')!.click(); await save();
    assert(saves[1].startedAt === null, 'explicit Clear must clear the fuzzy date');
    checks.push('Astra fuzzy dates survive unrelated edits and clear only after an explicit date change');

    let finish!: () => void; gate = new Promise(resolve => { finish = resolve; });
    input('#astra-general-notes').value = 'First'; input('#astra-general-notes').dispatchEvent(new Event('input', { bubbles: true }));
    const pending = save();
    input('#astra-general-notes').value = 'Second'; input('#astra-general-notes').dispatchEvent(new Event('input', { bubbles: true }));
    finish(); await pending; gate = null; await save();
    assert(saves.length === 4 && saves[2].notes === 'First' && saves[3].notes === 'Second', 'DOM-only edits during an accepted save must remain dirty');
    checks.push('Astra edits made during an accepted async save remain available for a second save');

    await modal.close(); await new Promise(resolve => setTimeout(resolve, 400));
    data.media.mediaListEntry = null;
    await modal.open(1);
    assert(input('#astra-status').value === '' && root().querySelector('#astra-status-label')?.textContent === 'Add to List'
      && !root().querySelector('.astra-status-option.active'), 'an unlisted work must have a neutral initial status');
    rerenderRatingModal(modal);
    let rejected = false;
    try { await save(); } catch { rejected = true; }
    assert(rejected && saves.length === 4 && root().querySelector('#astra-status-label')?.textContent === 'Add to List',
      'redrawing must preserve Add to List and no implicit Planning save may occur');
    root().querySelector<HTMLElement>('.astra-status-option[data-value="PLANNING"]')!.click();
    await save();
    assert(input('#astra-status').value === 'PLANNING' && root().querySelector('#astra-status-label')?.textContent === 'Planning'
      && saves.length === 5, 'explicit Planning selection must enable a normal save');
    checks.push('unlisted Astra works retain Add to List across redraws and save only after explicit status selection');
    saveFailure = new AstraSaveFailure('QUEUE', true, new BackgroundOperationError('Private error payload', 'STORAGE_WRITE'));
    input('#astra-general-notes').value = 'Retry after queue failure'; input('#astra-general-notes').dispatchEvent(new Event('input', { bubbles: true }));
    const closing = modal.close(); assert(modal.close() === closing, 'Repeated closes must share the pending automatic save'); await closing;
    assert(errors === 1 && messages[0].includes('AS-QUEUE-STORAGE_WRITE') && messages[0].includes('Saved to Astra')
      && !messages[0].includes('Private error payload') && !!root() && input('#astra-status').value === 'PLANNING',
    'Repeated closes must share one safe diagnostic and preserve the dirty form');
    saveFailure = null; await save();
    checks.push('Astra save failures show one fixed stage/code, preserve edits, and distinguish a local commit from synchronization');
    rerenderRatingModal(modal);
    const previousConfirm = window.confirm; window.confirm = () => true;
    try {
      input('#astra-delete-entry').click();
      const deadline = performance.now() + 4000;
      while (document.querySelector('.astra-modal-overlay')) {
        if (performance.now() > deadline) throw new Error('Entry deletion did not close the view');
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert(deletions === 1 && saves.length === 6 && errors === 1, 'accepted deletion must close without auto-saving the entry again');
    } finally { window.confirm = previousConfirm; }
    checks.push('Astra Delete entry accepts confirmation and retires the form without an automatic recreating save');
    return checks;
  } finally {
    await modal.close(); await new Promise(resolve => setTimeout(resolve, 400)); document.body.style.overflow = previousOverflow;
  }
}
