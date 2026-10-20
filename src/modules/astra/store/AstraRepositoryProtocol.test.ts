import { describe, expect, it, vi } from 'vitest';
import { dispatchAstraCommand } from './AstraRepositoryProtocol';
import { MAX_ASTRA_BACKUP_CHARACTERS, parseAstraBackup } from './AstraBackup';

describe('Astra import RPC size contract', () => {
  it('allows a validated backup whose escaped RPC representation exceeds the file limit', async () => {
    const backup = JSON.stringify({
      schemaVersion: 1, manifest: [{ mediaId: 1 }], sections: [], settings: {}, works: {
        1: { id: 'fixture', mediaId: 1, title: 'Fixture', type: 'anime', status: 'CURRENT',
          // Quotes double in the file and quadruple once wrapped as an RPC argument.
          notes: '"'.repeat(9_000_000), updatedAt: 1, seasons: [] },
      },
    });
    expect(backup.length).toBeLessThan(MAX_ASTRA_BACKUP_CHARACTERS);
    expect(JSON.stringify([backup]).length).toBeGreaterThan(MAX_ASTRA_BACKUP_CHARACTERS);
    expect(parseAstraBackup(backup).manifest).toHaveLength(1);
    const importJSON = vi.fn(async () => true);
    expect(await dispatchAstraCommand({ importJSON } as never, 'importJSON', [backup])).toBe(true);
    expect(importJSON).toHaveBeenCalledWith(backup);
  });
  it('rejects an oversized original backup before invoking its repository', async () => {
    const importJSON = vi.fn();
    await expect(dispatchAstraCommand({ importJSON } as never, 'importJSON', ['x'.repeat(MAX_ASTRA_BACKUP_CHARACTERS + 1)]))
      .rejects.toThrow('Invalid Astra backup');
    expect(importJSON).not.toHaveBeenCalled();
  });
  it('keeps the serialized size limit for ordinary mutation arguments', async () => {
    const saveWork = vi.fn();
    await expect(dispatchAstraCommand({ saveWork } as never, 'saveWork', [{ mediaId: 1, notes: 'x'.repeat(MAX_ASTRA_BACKUP_CHARACTERS) }]))
      .rejects.toThrow('Invalid Astra command');
    expect(saveWork).not.toHaveBeenCalled();
  });
});
