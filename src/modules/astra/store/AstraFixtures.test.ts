/// <reference types="node" />
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { AstraRepository } from './AstraRepository';
import { EventBus } from '@core/events/EventBus';
import { AstraFilterService } from '../services/AstraFilterService';
import { AstraStatsService } from '../services/AstraStatsService';
import { parseAstraBackup } from './AstraBackup';
import type { AstraWork } from '../AstraInterfaces';

describe('large archive fixture correctness and measurement', () => {
  it('keeps bulk persistence bounded and produces importable backups at 1k/5k/10k works', async () => {
    const results = [];
    for (const size of [1000, 5000, 10000]) {
      const data = new Map<string, unknown>(); let writes = 0; let reads = 0;
      const storage = { get: async (key: string) => { reads++; return structuredClone(data.get(key) ?? null); },
        set: async (key: string, value: unknown) => { writes++; data.set(key, structuredClone(value)); return true; },
        setMultiple: async (items: Record<string, unknown>) => { writes++; for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value)); return true; },
        remove: async (key: string) => { data.delete(key); return true; } };
      const repo = new AstraRepository(new EventBus(), storage as never);
      const works: (Partial<AstraWork> & { mediaId: number })[] = Array.from({ length: size }, (_, index) => ({ mediaId: index + 1, title: `Fixture ${String(index).padStart(5, '0')}`, notes: 'Fixture notes', progress: index % 13 }));
      const start = performance.now(); await repo.saveWorks(works); const saved = performance.now();
      const summaries = repo.getWorks(); const filter = new AstraFilterService();
      const sorted = filter.sort(filter.search(summaries, 'Fixture'), 'title-desc');
      const stats = new AstraStatsService().calculateStats(sorted); const filtered = performance.now();
      const backup = await repo.exportJSON(); const exported = performance.now();
      expect(parseAstraBackup(backup).manifest).toHaveLength(size); const validated = performance.now();
      expect(stats.totalCount).toBe(size); expect(sorted[0].mediaId).toBe(size); expect(writes).toBe(2);
      const countsBeforeRead = reads; await repo.getFullWork(size); expect(reads - countsBeforeRead).toBeLessThanOrEqual(1);
      const original = repo.getWorks();
      await repo.factoryReset();
      expect(await repo.importJSON(backup)).toBe(true);
      expect(repo.getWorks().map(work => work.mediaId)).toEqual(original.map(work => work.mediaId));
      expect(new AstraStatsService().calculateStats(repo.getWorks())).toEqual(stats);
      expect((await repo.getFullWork(size))?.notes).toBe('Fixture notes');
      results.push({ size, saveMs: saved - start, filterSortStatsMs: filtered - saved, exportMs: exported - filtered, validateMs: validated - exported,
        backupCharacters: backup.length, durableWriteCalls: 2, totalFixtureWriteCalls: writes, reads, environment: 'Node + jsdom, memory storage; no Chrome serialization or rendering' });
    }
    mkdirSync('.cache', { recursive: true }); writeFileSync('.cache/performance-fixtures.json', JSON.stringify({ measuredAt: new Date().toISOString(), results }, null, 2));
  }, 30000);
});
