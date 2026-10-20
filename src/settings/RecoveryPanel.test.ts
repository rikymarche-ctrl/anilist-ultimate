import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoveryPanel } from './RecoveryPanel';
import { MSG, AUTH_SESSION_KEY } from '@shared/messages';

const panels: RecoveryPanel[] = [];
const createPanel = (root: HTMLElement) => { const panel = new RecoveryPanel(root); panels.push(panel); return panel; };
const privateEntry = (userId = 42) => ({ id: 'queued', type: 'ASTRA_SAVE', userId, payload: { mediaId: 1, notes: 'private-preview' }, retries: 0 });
function setup() {
  const root = document.createElement('div'); document.body.append(root);
  const send = vi.mocked(chrome.runtime.sendMessage as (message: { type: string; operation?: string }) => Promise<unknown>);
  send.mockImplementation(async message => message.type === MSG.AUTH_STATUS
    ? { authenticated: true, userId: 42, sessionId: 'one' } : { success: true, data: [privateEntry()] });
  const panel = createPanel(root);
  const access = panel as unknown as { refresh(): Promise<void>; export(): Promise<void>; recover(operation: 'retry'): Promise<void> };
  return { root, panel, access, send };
}
describe('recovery settings account and DOM safety', () => {
  it('removes an already rendered private preview synchronously on an auth broadcast', async () => {
    const root = document.createElement('div'); document.body.append(root);
    vi.mocked(chrome.runtime.sendMessage as (message: { type: string }) => Promise<unknown>).mockImplementation(async message => message.type === MSG.AUTH_STATUS
      ? { authenticated: true, userId: 42, sessionId: 'one' }
      : { success: true, data: [{ id: 'queued', type: 'ASTRA_SAVE', userId: 42, payload: { mediaId: 1, notes: 'private-preview' }, retries: 0 }] });
    const panel = createPanel(root); await vi.waitFor(() => expect(root.textContent).toContain('private-preview'));
    const calls = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
    calls[calls.length - 1]?.[0]({ type: MSG.LOCAL_CHANGED, authChanged: true }, {} as never, () => {});
    expect(root.textContent).not.toContain('private-preview');
    (panel as unknown as { dispose?(): void }).dispose?.();
  });
  beforeEach(() => { vi.clearAllMocks(); chrome.storage.onChanged = { addListener: vi.fn(), removeListener: vi.fn() } as never; });
  afterEach(() => { panels.splice(0).forEach(panel => panel.dispose()); document.body.replaceChildren(); vi.restoreAllMocks(); });
  it('does not publish pending records after the account changes while loading', async () => {
    const root = document.createElement('div'); document.body.append(root);
    const send = vi.mocked(chrome.runtime.sendMessage as (message: { type: string }) => Promise<unknown>);
    send.mockImplementation(async (message: { type: string }) => {
      if (message.type === MSG.AUTH_STATUS) return { authenticated: true, userId: 42, sessionId: 'one' };
      return { success: true, data: [] };
    });
    const panel = createPanel(root); await vi.waitFor(() => expect(root.textContent).toContain('0 pending'));
    let authReads = 0;
    send.mockImplementation(async (message: { type: string }) => message.type === MSG.AUTH_STATUS
      ? { authenticated: true, userId: ++authReads === 1 ? 42 : 43, sessionId: authReads === 1 ? 'one' : 'two' }
      : { success: true, data: [{ id: 'queued', type: 'ASTRA_SAVE', userId: 42, payload: { mediaId: 1, notes: 'private' }, retries: 0 }] });
    await expect((panel as unknown as { refresh(): Promise<void> }).refresh()).rejects.toThrow('Account changed');
    expect(root.textContent).not.toContain('private'); expect(root.querySelector('[data-records]')?.children).toHaveLength(0);
  });
  it('renders stored notes as text without turning recovery previews into HTML', async () => {
    const root = document.createElement('div'); document.body.append(root);
    vi.mocked(chrome.runtime.sendMessage as (message: { type: string }) => Promise<unknown>).mockImplementation(async (message: { type: string }) => message.type === MSG.AUTH_STATUS
      ? { authenticated: true, userId: 42, sessionId: 'one' }
      : { success: true, data: [{ id: 'queued', type: 'ASTRA_SAVE', userId: 42, payload: { mediaId: 1, notes: '<img src=x onerror=alert(1)>' }, retries: 0 }] });
    createPanel(root); await vi.waitFor(() => expect(root.querySelector('pre')).not.toBeNull());
    expect(root.querySelector('img')).toBeNull(); expect(root.querySelector('pre')?.textContent).toContain('<img');
  });
  it('clears private records on native cross-tab storage signals without reading credentials', async () => {
    const f = setup(); await vi.waitFor(() => expect(f.root.textContent).toContain('private-preview'));
    const calls = vi.mocked(chrome.storage.onChanged.addListener).mock.calls;
    calls[calls.length - 1][0]({ [AUTH_SESSION_KEY]: { newValue: 'two' } }, 'local');
    expect(f.root.textContent).not.toContain('private-preview');
    expect([...f.root.querySelectorAll('button')].filter(button => !button.disabled).map(button => button.textContent)).toEqual(['Refresh']);
  });
  it('releases listeners and makes detached controls and pending responses inert after dispose', async () => {
    const f = setup(); await vi.waitFor(() => expect(f.root.textContent).toContain('private-preview'));
    let finish!: (value: unknown) => void;
    f.send.mockImplementation(async message => message.type === MSG.AUTH_STATUS
      ? { authenticated: true, userId: 42, sessionId: 'one' } : new Promise(resolve => { finish = resolve; }));
    const pending = f.access.refresh(); const rejected = expect(pending).rejects.toThrow('view changed');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function')); f.panel.dispose();
    const count = f.send.mock.calls.length; f.root.querySelector('button')!.click();
    finish({ success: true, data: [privateEntry()] }); await rejected;
    expect(f.send).toHaveBeenCalledTimes(count); expect(f.root.textContent).not.toContain('private-preview');
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalled(); expect(chrome.storage.onChanged.removeListener).toHaveBeenCalled();
  });
  it.each([null, {}, [{ ...privateEntry(), userId: 43 }], [{ ...privateEntry(), retries: -1 }]])('rejects malformed or foreign recovery data: %j', async data => {
    const f = setup(); await vi.waitFor(() => expect(f.root.querySelector('pre')).not.toBeNull());
    f.send.mockImplementation(async message => message.type === MSG.AUTH_STATUS
      ? { authenticated: true, userId: 42, sessionId: 'one' } : { success: true, data });
    await expect(f.access.refresh()).rejects.toThrow(); expect(f.root.querySelector('pre')).toBeNull();
  });
  it('keeps selected records and sends no mutation when recovery confirmation is cancelled', async () => {
    const f = setup(); await vi.waitFor(() => expect(f.root.querySelector('input')).not.toBeNull());
    f.root.querySelector<HTMLInputElement>('input')!.checked = true; vi.spyOn(window, 'confirm').mockReturnValue(false);
    const count = f.send.mock.calls.length; await f.access.recover('retry');
    expect(f.send).toHaveBeenCalledTimes(count); expect(f.root.textContent).toContain('private-preview');
  });
  it('also rejects foreign records before exporting them', async () => {
    const f = setup(); await vi.waitFor(() => expect(f.root.querySelector('pre')).not.toBeNull());
    f.send.mockImplementation(async message => message.type === MSG.AUTH_STATUS
      ? { authenticated: true, userId: 42, sessionId: 'one' } : { success: true, data: [privateEntry(43)] });
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(f.access.export()).rejects.toThrow('owner'); expect(download).not.toHaveBeenCalled();
  });

  it('exports Notes backups through the account-checked settings route', async () => {
    const f = setup(); await vi.waitFor(() => expect(f.root.querySelector('pre')).not.toBeNull());
    const access = f.panel as unknown as { exportNotesBackups(): Promise<void>; download(filename: string, data: unknown): void };
    const download = vi.spyOn(access, 'download').mockImplementation(() => {});
    await access.exportNotesBackups();
    expect(f.send).toHaveBeenCalledWith({ type: MSG.SYNC_RECOVERY, sessionId: 'one', operation: 'notes' });
    expect(download).toHaveBeenCalledWith('anilist-notes-backups.json', expect.objectContaining({ entries: [privateEntry()] }));
  });
  it('does not let an older refresh overwrite a newer snapshot for the same account', async () => {
    const f = setup(); await vi.waitFor(() => expect(f.root.querySelector('pre')).not.toBeNull());
    let finish!: (value: unknown) => void; let slow = true;
    f.send.mockImplementation(async message => message.type === MSG.AUTH_STATUS
      ? { authenticated: true, userId: 42, sessionId: 'one' }
      : slow ? new Promise(resolve => { finish = resolve; }) : { success: true, data: [] });
    const pending = f.access.refresh(); const rejected = expect(pending).rejects.toThrow('view changed');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function')); slow = false;
    await f.access.refresh(); finish({ success: true, data: [privateEntry()] }); await rejected;
    expect(f.root.querySelector('pre')).toBeNull(); expect(f.root.textContent).toContain('0 pending');
  });

  it('does not expose removed archive and unknown-owner association actions', async () => {
  const f = setup(); await vi.waitFor(() => expect(f.root.querySelector('pre')).not.toBeNull());
  const labels = [...f.root.querySelectorAll('button')].map(button => button.textContent).join(' ');
  expect(labels).not.toMatch(/legacy|friend lists|Associate selected/i);
  expect(labels).toContain('Retry selected');
});

});
