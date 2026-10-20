import { MSG, AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY, AUTH_SESSION_KEY, type AuthStatusResponse } from '@shared/messages';
import type { QueuedMutation } from '@core/interfaces/ISyncQueueService';
import { diagnosticText } from '@core/errors/DiagnosticPrivacy';
import { parseAuthStatus } from '@core/auth/AuthMetadata';
import { isRecord } from '@/api/GraphQLResponse';
import { syncQueueSnapshot } from '@core/services/SyncQueueSnapshot';

/** Recovery actions are explicit and restricted to the extension's settings page. */
export class RecoveryPanel {
  private entries: QueuedMutation[] = [];
  private status: AuthStatusResponse | null = null;
  private version = 0;
  private disposed = false;
  private busy: object | null = null;
  private controller = new AbortController();
  private downloads = new Map<ReturnType<typeof setTimeout>, string>();
  private runtimeEvents = chrome.runtime.onMessage;
  private storageEvents = chrome.storage.onChanged;
  private runtimeListener = (message: unknown): void => {
    if (isRecord(message) && message.type === MSG.LOCAL_CHANGED && message.authChanged) this.invalidate();
  };
  private storageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area === 'local' && [AUTH_STORAGE_KEY, AUTH_USER_CACHE_KEY, AUTH_SESSION_KEY].some(key => Object.prototype.hasOwnProperty.call(changes, key))) this.invalidate();
  };
  private pageHide = () => this.dispose();
  constructor(private root: HTMLElement) {
    root.classList.add('settings-recovery');
    root.innerHTML = '<h4>Data recovery</h4><p class="settings-recovery__description">Export and review your account’s pending changes before retrying.</p><div class="settings-recovery__actions" data-actions></div><p class="settings-recovery__status" role="status" data-status></p><div class="settings-recovery__records" data-records></div>';
    const actions = root.querySelector('[data-actions]')!;
    for (const [label, action] of [
      ['Refresh', () => this.refresh()], ['Export pending changes', () => this.export()],
      ['Export Notes backups', () => this.exportNotesBackups()],
      ['Retry selected', () => this.recover('retry')],
      ['Export local Astra', () => this.astra('exportLocal')], ['Copy local Astra to account', () => this.astra('claimLocal')],
    ] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'settings-recovery__button'; button.textContent = label;
      button.addEventListener('click', () => { void this.run(action); }, { signal: this.controller.signal }); actions.append(button);
    }
    this.runtimeEvents.addListener(this.runtimeListener);
    this.storageEvents?.addListener(this.storageListener);
    window.addEventListener('pagehide', this.pageHide);
    void this.run(() => this.refresh());
  }
  private invalidate(): void {
    if (this.disposed) return;
    this.version++; this.entries = []; this.status = null; this.busy = null;
    this.root.querySelector('[data-records]')!.replaceChildren();
    this.message('Account changed. Refresh before continuing.');
    this.root.querySelectorAll('button').forEach(button => { button.disabled = button.textContent !== 'Refresh'; });
  }
  public dispose(): void {
    if (this.disposed) return;
    this.invalidate(); this.disposed = true; this.version++; this.controller.abort();
    this.runtimeEvents.removeListener(this.runtimeListener); this.storageEvents?.removeListener(this.storageListener);
    window.removeEventListener('pagehide', this.pageHide);
    for (const [timer, url] of this.downloads) { clearTimeout(timer); URL.revokeObjectURL(url); }
    this.downloads.clear();
  }
  private assertCurrent(version: number): void {
    if (this.disposed || version !== this.version || !this.root.isConnected) throw new Error('Recovery view changed. Refresh before continuing.');
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.disposed || this.busy || !this.root.isConnected) return;
    const token = {}; this.busy = token;
    const buttons = this.root.querySelectorAll('button'); buttons.forEach(button => { button.disabled = true; });
    try { await action(); }
    catch (error) { if (!this.disposed && this.busy === token) this.message(diagnosticText(error instanceof Error ? error.message : 'Recovery unavailable')); }
    finally { if (!this.disposed && this.busy === token) { this.busy = null; buttons.forEach(button => { button.disabled = false; }); } }
  }
  private message(value: string): void { this.root.querySelector('[data-status]')!.textContent = value; }
  private async request(type: string, args: Record<string, unknown>): Promise<unknown> {
    const version = this.version; const capturedArgs = structuredClone(args);
    this.assertCurrent(version);
    let current: AuthStatusResponse;
    try { current = parseAuthStatus(await chrome.runtime.sendMessage({ type: MSG.AUTH_STATUS })); }
    catch (error) { this.assertCurrent(version); this.invalidate(); throw error; }
    this.assertCurrent(version);
    if (!current.authenticated || !current.userId || !current.sessionId) { this.invalidate(); throw new Error('Log in before opening recovery.'); }
    if (this.status && (this.status.sessionId !== current.sessionId || this.status.userId !== current.userId)) { this.invalidate(); throw new Error('Account changed. Refresh before continuing.'); }
    this.status = current;
    const response: unknown = await chrome.runtime.sendMessage({ type, sessionId: current.sessionId, ...capturedArgs });
    this.assertCurrent(version);
    let latest: AuthStatusResponse;
    try { latest = parseAuthStatus(await chrome.runtime.sendMessage({ type: MSG.AUTH_STATUS })); }
    catch (error) { this.assertCurrent(version); this.invalidate(); throw error; }
    this.assertCurrent(version);
    if (latest?.sessionId !== current.sessionId || latest?.userId !== current.userId || !latest?.authenticated) {
      this.invalidate();
      throw new Error('Account changed. Refresh before continuing.');
    }
    if (!isRecord(response) || response.success !== true) throw new Error('Recovery operation failed. Data has been preserved.');
    return response.data;
  }
  private async refresh(): Promise<void> {
    this.version++;
    const version = this.version;
    this.entries = []; this.root.querySelector('[data-records]')!.replaceChildren();
    this.status = null;
    const data = await this.request(MSG.SYNC_RECOVERY, { operation: 'export' });
    this.assertCurrent(version);
    this.entries = this.recoveryEntries(data);
    const records = this.root.querySelector('[data-records]')!; records.replaceChildren();
    for (const entry of this.entries) {
      const label = document.createElement('label'); label.className = 'settings-recovery__record';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'settings-recovery__checkbox'; checkbox.dataset.id = entry.id;
      label.append(checkbox, document.createTextNode(` Media ${entry.payload.mediaId} — ${`account ${entry.userId}`} — ${entry.blocked ? 'remote conflict' : entry.retries >= 10 ? 'retry limit' : 'pending'}`));
      const preview = document.createElement('pre'); preview.className = 'settings-recovery__preview'; preview.textContent = JSON.stringify(entry.payload, null, 2);
      label.append(preview); records.append(label);
    }
    this.message(`${this.entries.length} pending records visible for this account.`);
  }
  private async export(): Promise<void> {
    const version = this.version;
    const data = await this.request(MSG.SYNC_RECOVERY, { operation: 'export' });
    this.assertCurrent(version);
    const entries = this.recoveryEntries(data);
    this.download('anilist-sync-recovery.json', { schemaVersion: 1, exportedAt: new Date().toISOString(), entries });
  }
  private recoveryEntries(data: unknown): QueuedMutation[] {
    if (!Array.isArray(data)) throw new Error('Invalid recovery records; original data preserved.');
    const entries = syncQueueSnapshot({ revision: 'recovery', entries: data }).entries;
    if (entries.some(entry => entry.userId !== this.status?.userId)) { this.invalidate(); throw new Error('Invalid recovery owner'); }
    return entries;
  }
  private async exportNotesBackups(): Promise<void> {
    const version = this.version;
    const data = await this.request(MSG.SYNC_RECOVERY, { operation: 'notes' });
    this.assertCurrent(version);
    const entries = this.recoveryEntries(data);
    this.download('anilist-notes-backups.json', { schemaVersion: 1, exportedAt: new Date().toISOString(), entries });
    this.message(`${entries.length} Notes backups exported for this account (up to 20 recent versions).`);
  }
  private download(filename: string, value: unknown): void {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    const timer = setTimeout(() => { this.downloads.delete(timer); URL.revokeObjectURL(url); }, 1000);
    this.downloads.set(timer, url);
  }
  private async recover(operation: 'retry'): Promise<void> {
    const version = this.version;
    const ids = Array.from(this.root.querySelectorAll<HTMLInputElement>('input:checked')).map(input => input.dataset.id!);
    if (!ids.length) throw new Error('Select the records to recover.');
    if (!window.confirm('Retrying accepts these local changes, including notes, as the desired version. Review/export first. Continue?')) return;
    await this.request(MSG.SYNC_RECOVERY, { operation, ids });
    this.assertCurrent(version);
    await this.refresh();
  }
  private async astra(operation: 'exportLocal' | 'claimLocal'): Promise<void> {
    const version = this.version;
    if (operation.startsWith('claim') && !window.confirm(`Associate this Astra archive with account ${this.status?.userId}? This requires an empty account archive and imports its sections/settings too. Export and review it first.`)) return;
    const data = await this.request(MSG.ASTRA_RECOVERY, { operation });
    this.assertCurrent(version);
    if (typeof data === 'string') this.download(`astra-${operation}.json`, JSON.parse(data));
    else this.message('Astra archive copied. Original data preserved.');
  }
}
