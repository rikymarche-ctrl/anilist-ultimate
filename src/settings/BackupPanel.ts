/**
 * @file BackupPanel.ts
 * @description Settings block to move everything to another browser: one file with every
 * preference, custom list and Astra record. Login stays out of it.
 */

import { buildBackup, parseBackup, restoreBackup } from '@core/storage/ExtensionBackup';

const DESCRIPTION =
  'Save every preference, custom list and Astra rating to a file, then load it in another browser. ' +
  'Your AniList login is not included: sign in again after importing.';

export class BackupPanel {
  private busy = false;

  constructor(
    private root: HTMLElement,
    private reload: () => void = () => chrome.runtime.reload()
  ) {
    root.classList.add('settings-recovery');
    const title = document.createElement('h4');
    title.textContent = 'Backup';
    const description = document.createElement('p');
    description.className = 'settings-recovery__description';
    description.textContent = DESCRIPTION;
    const actions = document.createElement('div');
    actions.className = 'settings-recovery__actions';
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'application/json,.json';
    file.hidden = true;
    file.addEventListener('change', () => {
      const chosen = file.files?.[0];
      file.value = '';
      if (chosen) void this.run(() => this.importFile(chosen));
    });
    actions.append(
      this.button('Export backup', () => void this.run(() => this.exportFile())),
      this.button('Import backup', () => file.click()),
      file
    );
    const status = document.createElement('p');
    status.className = 'settings-recovery__status';
    status.setAttribute('role', 'status');
    status.dataset.status = '';
    root.replaceChildren(title, description, actions, status);
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'settings-recovery__button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  private message(text: string): void {
    this.root.querySelector('[data-status]')!.textContent = text;
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await action();
    } catch (error) {
      this.message(error instanceof Error ? error.message : 'The backup could not be completed.');
    } finally {
      this.busy = false;
    }
  }

  private async exportFile(): Promise<void> {
    const [sync, local] = await Promise.all([
      chrome.storage.sync.get(null),
      chrome.storage.local.get(null),
    ]);
    const backup = buildBackup(sync, local);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup)], { type: 'application/json' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `anilist-ultimate-backup-${backup.exportedAt.slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const count = Object.keys(backup.sync).length + Object.keys(backup.local).length;
    this.message(`Backup saved (${count} items).`);
  }

  private async importFile(file: File): Promise<void> {
    const backup = parseBackup(await file.text());
    const when = backup.exportedAt ? ` from ${new Date(backup.exportedAt).toLocaleString()}` : '';
    const ok = window.confirm(
      `Replace this browser's AniList Ultimate settings and data with the backup${when}? ` +
        'Your login stays as it is. The extension restarts afterwards.'
    );
    if (!ok) return;
    await restoreBackup(backup);
    this.message('Backup restored. Restarting the extension…');
    // Background state (Astra, caches) reloads from the restored storage.
    setTimeout(this.reload, 600);
  }
}
