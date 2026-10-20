import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@core/di/tokens';
import type { ApiContext, IApiClient } from '@core/interfaces/IApiClient';
import { assertApiContext, captureApiContext } from '@/api/ApiContext';
import { isRecord } from '@/api/GraphQLResponse';
import type { ISyncQueueService } from '@core/interfaces/ISyncQueueService';

export type BulkMediaType = 'ANIME' | 'MANGA';
export const BULK_STATUSES = [
  'CURRENT',
  'PLANNING',
  'COMPLETED',
  'PAUSED',
  'DROPPED',
  'REPEATING',
] as const;
export type BulkStatus = (typeof BULK_STATUSES)[number];
export interface BulkEntry {
  id: number;
  mediaId: number;
  status: BulkStatus;
  customLists: string[];
}
export interface BulkSnapshot {
  context: ApiContext;
  ownerId: number;
  /** Profile name from the route, verified against the viewer when the run starts. */
  ownerName: string;
  type: BulkMediaType;
  entries: Map<number, BulkEntry>;
  lists: string[];
}
export interface BulkEdit {
  lists: Record<string, 'add' | 'remove'>;
  status?: BulkStatus;
}
export interface BulkResult {
  saved: number[];
  /** Entry whose write could not be confirmed, or null when the run did not stop on a write. */
  failed: number | null;
  remaining: number[];
  /** Set when the run paused before writing: a user Stop, or unrelated Astra sync changes. */
  reason?: 'stopped' | 'queue';
}

/** Thrown when the shared sync queue changed mid-run; the run pauses before writing. */
export class BulkQueueBusyError extends Error {
  constructor() {
    super('Wait for Astra synchronization to finish, then retry.');
    this.name = 'BulkQueueBusyError';
  }
}

/** Any profile's animelist or mangalist route, including list filters and trailing slashes. */
const ROUTE = /^\/user\/([^/?#]+)\/(animelist|mangalist)(?:\/[^?#]*)?\/?$/i;

/** Media type of a bulk editor route. Ownership is checked separately against the viewer. */
export function bulkRoute(path: string): BulkMediaType | null {
  const match = ROUTE.exec(path);
  return match ? (match[2].toLowerCase() === 'animelist' ? 'ANIME' : 'MANGA') : null;
}

/** Profile name in a bulk editor route, or null when the path is not one. */
export function bulkRouteOwner(path: string): string | null {
  return ROUTE.exec(path)?.[1] ?? null;
}

const COLLECTION = `query BulkEditorCollection($userId: Int!, $type: MediaType!, $chunk: Int!) {
  MediaListCollection(userId: $userId, type: $type, chunk: $chunk, perChunk: 500) {
    user { id name mediaListOptions { animeList { customLists } mangaList { customLists } } }
    hasNextChunk lists { entries { id userId mediaId status customLists media { id type } } }
  }
}`;
const SAVE = `mutation BulkEditorSave($id: Int!, $customLists: [String], $status: MediaListStatus) {
  SaveMediaListEntry(id: $id, customLists: $customLists, status: $status) { id userId mediaId status customLists }
}`;
const positiveId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
const invalid = (): never => {
  throw new Error('Invalid bulk editor response');
};
function strings(value: unknown): string[] {
  if (value === null) return [];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string' && item.trim().length > 0)
  )
    return invalid();
  return [...new Set(value)];
}
function memberships(value: unknown): string[] {
  if (value === null) return [];
  if (!isRecord(value) || !Object.values(value).every((item) => typeof item === 'boolean'))
    return invalid();
  return Object.keys(value)
    .filter((key) => value[key] === true)
    .sort();
}
function entry(value: unknown, ownerId: number): BulkEntry {
  if (
    !isRecord(value) ||
    !positiveId(value.id) ||
    !positiveId(value.mediaId) ||
    value.userId !== ownerId ||
    !BULK_STATUSES.includes(value.status as BulkStatus)
  )
    return invalid();
  return {
    id: value.id,
    mediaId: value.mediaId,
    status: value.status as BulkStatus,
    customLists: memberships(value.customLists),
  };
}

@injectable()
export class BulkEditorService {
  private saving = false;
  constructor(
    @inject(TOKENS.ApiClient) private api: IApiClient,
    @inject(TOKENS.SyncQueue) private queue: ISyncQueueService
  ) {}

  private assert(
    snapshot: Pick<BulkSnapshot, 'context' | 'ownerId' | 'ownerName' | 'type'>,
    active: () => boolean
  ): void {
    if (
      !active() ||
      bulkRoute(location.pathname) !== snapshot.type ||
      bulkRouteOwner(location.pathname)?.toLowerCase() !== snapshot.ownerName.toLowerCase() ||
      !this.api.isAuthenticated()
    )
      throw new Error('Bulk editor session ended');
    assertApiContext(this.api, snapshot.context, snapshot.ownerId);
  }

  /** Signed-in viewer's name, or null when signed out. Decides whether the editor activates. */
  async viewerName(): Promise<string | null> {
    if (!this.api.isAuthenticated()) return null;
    return (await this.api.getCurrentUser()).name;
  }

  async load(type: BulkMediaType, active: () => boolean): Promise<BulkSnapshot> {
    const context = await captureApiContext(this.api);
    if (!context?.sessionId || !positiveId(context.userId))
      throw new Error('Connect your AniList account to use the bulk editor.');
    const ownerName = bulkRouteOwner(location.pathname);
    if (!ownerName) throw new Error('Open your own list to use the bulk editor.');
    const snapshot: BulkSnapshot = {
      context,
      ownerId: context.userId,
      ownerName,
      type,
      entries: new Map(),
      lists: [],
    };
    this.assert(snapshot, active);
    const viewer = await this.api.getCurrentUser();
    this.assert(snapshot, active);
    if (viewer.id !== snapshot.ownerId || viewer.name.toLowerCase() !== ownerName.toLowerCase())
      throw new Error('Connect the account that owns this list to use the bulk editor.');
    const entryIds = new Map<number, number>();
    for (let chunk = 1; chunk <= 30; chunk++) {
      this.assert(snapshot, active);
      const raw = await this.api.query<unknown>(COLLECTION, {
        userId: snapshot.ownerId,
        type,
        chunk,
      });
      this.assert(snapshot, active);
      if (!isRecord(raw) || !isRecord(raw.MediaListCollection)) return invalid();
      const collection = raw.MediaListCollection;
      if (
        !isRecord(collection.user) ||
        collection.user.id !== snapshot.ownerId ||
        collection.user.name !== viewer.name ||
        (collection.hasNextChunk !== null && typeof collection.hasNextChunk !== 'boolean') ||
        !Array.isArray(collection.lists)
      )
        return invalid();
      const options = collection.user.mediaListOptions;
      if (!isRecord(options)) return invalid();
      const listOptions = options[type === 'ANIME' ? 'animeList' : 'mangaList'];
      if (!isRecord(listOptions)) return invalid();
      const names = strings(listOptions.customLists);
      if (chunk === 1) snapshot.lists = names;
      else if (JSON.stringify(names) !== JSON.stringify(snapshot.lists)) return invalid();
      const before = snapshot.entries.size;
      for (const group of collection.lists) {
        if (!isRecord(group) || !Array.isArray(group.entries)) return invalid();
        for (const value of group.entries) {
          const parsed = entry(value, snapshot.ownerId);
          if (
            !isRecord(value) ||
            !isRecord(value.media) ||
            value.media.id !== parsed.mediaId ||
            value.media.type !== type
          )
            return invalid();
          const previous = snapshot.entries.get(parsed.mediaId);
          if (previous && JSON.stringify(previous) !== JSON.stringify(parsed)) return invalid();
          if (entryIds.has(parsed.id) && entryIds.get(parsed.id) !== parsed.mediaId)
            return invalid();
          entryIds.set(parsed.id, parsed.mediaId);
          snapshot.entries.set(parsed.mediaId, parsed);
        }
      }
      if (snapshot.entries.size > 15000) return invalid();
      if (!collection.hasNextChunk) return snapshot;
      if (before === snapshot.entries.size) return invalid();
    }
    return invalid();
  }

  async apply(
    snapshot: BulkSnapshot,
    selected: number[],
    edit: BulkEdit,
    active: () => boolean,
    onSaved: (mediaId: number, done: number, total: number) => void,
    stopRequested: () => boolean = () => false
  ): Promise<BulkResult> {
    if (this.saving) throw new Error('A bulk save is already running.');
    const changes = structuredClone(edit);
    const ids = [...new Set(selected)];
    if (
      !ids.length ||
      ids.some((id) => !positiveId(id) || !snapshot.entries.has(id)) ||
      Object.entries(changes.lists).some(
        ([name, action]) => !snapshot.lists.includes(name) || !['add', 'remove'].includes(action)
      ) ||
      (changes.status !== undefined && !BULK_STATUSES.includes(changes.status)) ||
      (!Object.keys(changes.lists).length && !changes.status)
    )
      throw new Error('Choose entries and at least one change.');
    this.saving = true;
    const saved: number[] = [];
    try {
      this.assert(snapshot, active);
      const checkQueue = async (revision?: string): Promise<string> => {
        const pending = await this.queue.getSnapshot();
        this.assert(snapshot, active);
        if (
          (revision !== undefined && pending.revision !== revision) ||
          pending.entries.some(
            (item) => item.userId === snapshot.ownerId && ids.includes(item.payload.mediaId ?? 0)
          )
        ) {
          throw new BulkQueueBusyError();
        }
        return pending.revision;
      };
      const revision = await checkQueue();
      // Refresh once before writing, so additive list edits preserve memberships
      // changed since the panel opened. Identity changes invalidate the batch.
      const fresh = await this.load(snapshot.type, active);
      this.assert(snapshot, active);
      await checkQueue(revision);
      if (
        Object.keys(changes.lists).some((name) => !fresh.lists.includes(name)) ||
        ids.some((id) => fresh.entries.get(id)?.id !== snapshot.entries.get(id)?.id)
      )
        throw new Error('The list changed. Reopen the bulk editor.');
      for (const mediaId of ids) {
        // Stop is checked only between entries, so it never interrupts a request in flight.
        if (stopRequested())
          return {
            saved,
            failed: null,
            remaining: ids.filter((id) => !saved.includes(id)),
            reason: 'stopped',
          };
        try {
          this.assert(snapshot, active);
          await checkQueue(revision);
          const current = fresh.entries.get(mediaId)!;
          const lists = new Set(current.customLists);
          for (const [name, action] of Object.entries(changes.lists)) {
            if (action === 'add') lists.add(name);
            else lists.delete(name);
          }
          const customLists = [...lists].sort();
          if (
            JSON.stringify(customLists) !== JSON.stringify(current.customLists) ||
            (changes.status && changes.status !== current.status)
          ) {
            const variables: Record<string, unknown> = { id: current.id };
            if (Object.keys(changes.lists).length) variables.customLists = customLists;
            if (changes.status) variables.status = changes.status;
            const raw = await this.api.mutate<unknown>(SAVE, variables);
            this.assert(snapshot, active);
            if (!isRecord(raw)) return invalid();
            const confirmed = entry(raw.SaveMediaListEntry, snapshot.ownerId);
            if (
              confirmed.id !== current.id ||
              confirmed.mediaId !== mediaId ||
              (changes.status && confirmed.status !== changes.status) ||
              (Object.keys(changes.lists).length &&
                JSON.stringify(confirmed.customLists) !== JSON.stringify(customLists))
            )
              return invalid();
          }
          saved.push(mediaId);
          onSaved(mediaId, saved.length, ids.length);
        } catch (error) {
          const remaining = ids.filter((id) => !saved.includes(id));
          return error instanceof BulkQueueBusyError
            ? { saved, failed: mediaId, remaining, reason: 'queue' }
            : { saved, failed: mediaId, remaining };
        }
      }
      return { saved, failed: null, remaining: [] };
    } finally {
      this.saving = false;
    }
  }
}
