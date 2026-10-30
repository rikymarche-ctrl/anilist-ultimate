import type { AuthService } from '@core/auth/AuthService';
import type { ISyncQueueService } from '@core/interfaces/ISyncQueueService';
import { MSG } from '@shared/messages';
import { validateSyncPayload } from './SyncPayload';
import { AstraConflictError } from '@/modules/astra/store/AstraRepository';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { validateApiRequest } from '@/api/ApiBoundary';
import { dispatchLocalStorage } from '@core/storage/LocalStorageBridge';
import type { AstraRepositoryHost } from '@/modules/astra/store/AstraRepositoryHost';
import type { ConfigManager } from '@core/config/ConfigManager';
import { dispatchConfigCommand } from '@core/config/ConfigProtocol';
import type { CustomListHost } from '@/modules/social/CustomListHost';
import type { FriendAlertsHost } from '@/modules/notifications/FriendAlertsHost';
import { operationFailureCode } from '@core/errors/OperationFailure';
import { AstraWorkValidationError } from '@/modules/astra/store/AstraBackup';
import { MUSIC_THEMES_BASE_URL, PublicMediaClient } from './PublicMediaClient';
import { MusicVideoClient } from './MusicVideoClient';
import { dispatchCalendarSessionCache } from '@/modules/calendar/CalendarSessionCache';
import { isExtensionPageUrl } from '@core/utils/ExtensionPage';

export function isTrustedExtensionSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  try {
    const source = sender.url || sender.tab?.url || '';
    const url = new URL(source);
    return isExtensionPageUrl(source) || (url.protocol === 'https:' && url.hostname === 'anilist.co');
  } catch {
    return false;
  }
}

/** Install synchronously so MV3 can wake the worker before its async DI setup finishes. */
export function createBackgroundMessageHandler(
  ready: Promise<void>,
  auth: () => AuthService,
  queue: () => ISyncQueueService,
  api?: () => IApiClient,
  repositoryHost?: () => AstraRepositoryHost,
  config?: () => ConfigManager,
  lists?: () => CustomListHost,
  friendAlerts?: () => FriendAlertsHost
): (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (response: unknown) => void
) => boolean {
  const publicMedia = new PublicMediaClient();
  const musicThemes = new PublicMediaClient(MUSIC_THEMES_BASE_URL, 550);
  const musicVideos = new MusicVideoClient();
  return (input, sender, respond) => {
    if (
      !isTrustedExtensionSender(sender) ||
      !input ||
      typeof input !== 'object' ||
      !('type' in input) ||
      typeof input.type !== 'string'
    ) {
      respond({ success: false, error: 'Invalid message or sender' });
      return false;
    }
    const message = input as Record<string, unknown>;
    void ready
      .then(async () => {
        switch (message.type) {
          case MSG.FRIEND_ALERTS:
            if (!friendAlerts) throw new Error('Friend alerts writer unavailable');
            return respond({
              success: true,
              data: await friendAlerts().dispatch(
                message.operation,
                message.value,
                message.sessionId
              ),
            });
          case MSG.ASTRA_RECOVERY:
            if (
              !repositoryHost ||
              !isExtensionPageUrl(sender.url)
            )
              throw new Error('Extension page required');
            return respond({
              success: true,
              data: await repositoryHost().recovery(message.operation, message.sessionId),
            });
          case MSG.CUSTOM_LISTS:
            if (!lists) throw new Error('Custom lists writer unavailable');
            return respond({
              success: true,
              data: await lists().dispatch(message.operation, message.value, message.sessionId),
            });
          case MSG.SYNC_PROGRESS:
          case MSG.SYNC_NOTE: {
            const status = await auth().getStatus();
            if (
              !status.authenticated ||
              !status.userId ||
              typeof message.sessionId !== 'string' ||
              message.sessionId !== status.sessionId
            )
              throw new Error('Sync account changed');
            validateSyncPayload('ASTRA_SAVE', {
              mediaId: message.mediaId,
              ...(message.type === MSG.SYNC_PROGRESS
                ? { progress: message.progress }
                : { notes: message.notes }),
            });
            if (
              message.type === MSG.SYNC_NOTE &&
              (!Number.isSafeInteger(message.episode) || (message.episode as number) <= 0)
            )
              throw new Error('Invalid episode');
            const data =
              message.type === MSG.SYNC_PROGRESS
                ? await queue().updateProgress(
                    message.mediaId as number,
                    message.progress as number | undefined,
                    message.sessionId
                  )
                : await queue().appendNote(
                    message.mediaId as number,
                    message.episode as number,
                    message.notes as string,
                    message.sessionId
                  );
            if ((await auth().getStatus()).sessionId !== status.sessionId)
              throw new Error('Sync account changed');
            return respond({ success: true, data });
          }
          case MSG.SYNC_RECOVERY: {
            // Recovery payloads are restricted to trusted extension pages.
            if (!isExtensionPageUrl(sender.url))
              throw new Error('Extension page required');
            const status = await auth().getStatus();
            if (
              !status.authenticated ||
              !status.userId ||
              typeof message.sessionId !== 'string' ||
              message.sessionId !== status.sessionId
            )
              throw new Error('Sync account changed');
            if (!['export', 'retry', 'notes'].includes(message.operation as string))
              throw new Error('Invalid recovery operation');
            const data = await queue().recovery(
              message.operation as 'export' | 'retry' | 'notes',
              message.ids as string[] | undefined,
              message.sessionId
            );
            if ((await auth().getStatus()).sessionId !== status.sessionId)
              throw new Error('Sync account changed');
            return respond({ success: true, data });
          }
          case MSG.CALENDAR_CACHE: {
            const status = await auth().getStatus();
            if (typeof message.sessionId !== 'string' || message.sessionId !== status.sessionId)
              throw new Error('Calendar account changed');
            const data = await dispatchCalendarSessionCache(
              message.operation,
              message.value,
              status
            );
            if ((await auth().getStatus()).sessionId !== status.sessionId)
              throw new Error('Calendar account changed');
            return respond({ success: true, data });
          }
          case MSG.CONFIG_COMMAND:
            if (!config) throw new Error('Configuration writer unavailable');
            return respond({
              success: true,
              data: await dispatchConfigCommand(config(), message.operation, message.value),
            });
          case MSG.LOCAL_STORAGE:
            return respond({
              success: true,
              data: await dispatchLocalStorage(message.operation, message.value),
            });
          case MSG.API_REQUEST: {
            if (!api) throw new Error('API unavailable');
            const request = validateApiRequest(message);
            const status = await auth().getStatus();
            if (typeof message.sessionId !== 'string' || message.sessionId !== status.sessionId)
              throw new Error('API account changed');
            if ((request.method === 'mutate' || request.method === 'mutateOnce') && !status.authenticated)
              throw new Error('Authentication required');
            const client = api();
            const options = { priority: request.priority };
            let data: unknown;
            if (request.method === 'queryRaw') {
              data = await client.queryRaw(request.query, request.variables, options);
            } else if (request.method === 'mutate') {
              data = await client.mutate(request.query, request.variables);
            } else if (request.method === 'mutateOnce') {
              // Non-idempotent writes must never be retried by the background client.
              if (!client.mutateOnce) throw new Error('mutateOnce unavailable');
              data = await client.mutateOnce(request.query, request.variables);
            } else {
              data = await client.query(request.query, request.variables, true, options);
            }
            if ((await auth().getStatus()).sessionId !== message.sessionId)
              throw new Error('API account changed');
            return respond({ success: true, data });
          }
          case MSG.MEDIA_MUSIC_THEMES: {
            const idMal = message.idMal;
            if (
              typeof idMal !== 'number' ||
              !Number.isSafeInteger(idMal) ||
              idMal <= 0 ||
              idMal > 2147483647
            ) {
              throw new Error('Invalid music theme media ID');
            }
            return respond({
              success: true,
              data: await musicThemes.get(`/anime/${idMal}/themes`),
            });
          }
          case MSG.MEDIA_MUSIC_VIDEOS:
            if (typeof message.idMal !== 'number') throw new Error('Invalid music video MAL ID');
            return respond({ success: true, data: await musicVideos.get(message.idMal) });
          case MSG.MEDIA_METADATA_SCORE: {
            const { idMal, mediaType } = message;
            if (
              typeof idMal !== 'number' ||
              !Number.isSafeInteger(idMal) ||
              idMal <= 0 ||
              idMal > 2147483647 ||
              (mediaType !== 'ANIME' && mediaType !== 'MANGA')
            )
              throw new Error('Invalid metadata identity');
            return respond({
              success: true,
              data: await publicMedia.get(`/${mediaType === 'ANIME' ? 'anime' : 'manga'}/${idMal}`),
            });
          }
          case MSG.MEDIA_MUSIC_SEARCH: {
            const title = message.title;
            if (
              typeof title !== 'string' ||
              !title.trim() ||
              title.length > 200 ||
              [...title].some((char) => char.charCodeAt(0) < 32)
            ) {
              throw new Error('Invalid music search title');
            }
            // Edge accepts q up to 64 characters and does not support limit here.
            // The content parser still requires an exact full-title match.
            const query = new URLSearchParams({ q: [...title.trim()].slice(0, 64).join('') });
            return respond({
              success: true,
              data: await publicMedia.get(`/anime?${query.toString()}`),
            });
          }
          case MSG.ASTRA_COMMAND:
            if (!repositoryHost) throw new Error('Astra account host unavailable');
            return respond({
              success: true,
              data: await repositoryHost().dispatch(
                message.command,
                message.args,
                message.sessionId
              ),
            });
          case MSG.AUTH_LOGIN:
            return respond(await auth().performOAuthLogin());
          case MSG.AUTH_LOGOUT:
            return respond(await auth().performLogout());
          case MSG.AUTH_STATUS:
            return respond(await auth().getStatus());
          case MSG.SYNC_ENQUEUE: {
            validateSyncPayload(message.mutationType, message.payload);
            const status = await auth().getStatus();
            if (typeof message.sessionId !== 'string' || status.sessionId !== message.sessionId)
              throw new Error('Sync account changed');
            await queue().enqueue(
              message.mutationType as 'ASTRA_SAVE' | 'ASTRA_DELETE',
              message.payload,
              message.sessionId
            );
            return respond({ success: true });
          }
          case MSG.SYNC_PROCESS:
            await queue().process();
            return respond({ success: true });
          case MSG.SYNC_SNAPSHOT: {
            const status = await auth().getStatus();
            if (message.sessionId !== status.sessionId) throw new Error('Sync account changed');
            const snapshot = await queue().getSnapshot();
            if ((await auth().getStatus()).sessionId !== status.sessionId)
              throw new Error('Sync account changed');
            return respond({
              success: true,
              data: {
                revision: snapshot.revision,
                entries:
                  status.authenticated && status.userId
                    ? snapshot.entries.filter((item) => item.userId === status.userId)
                    : [],
              },
            });
          }
          case MSG.SYNC_GET: {
            const status = await auth().getStatus();
            if (message.sessionId !== status.sessionId) throw new Error('Sync account changed');
            const pending = await queue().getQueue();
            if ((await auth().getStatus()).sessionId !== status.sessionId)
              throw new Error('Sync account changed');
            return respond({
              success: true,
              data:
                status.authenticated && status.userId
                  ? pending.filter((item) => item.userId === status.userId)
                  : [],
            });
          }
          case MSG.SYNC_CLEAR: {
            const status = await auth().getStatus();
            if (message.sessionId !== status.sessionId) throw new Error('Sync account changed');
            if (!status.authenticated || !status.userId) throw new Error('Queue owner required');
            await queue().clear(status.userId);
            return respond({ success: true });
          }
          default:
            return respond({ success: false, error: 'Unknown message type' });
        }
      })
      .catch((error) =>
        respond({
          success: false,
          error: 'Background operation failed',
          ...(operationFailureCode(error) !== 'UNKNOWN'
            ? { failureCode: operationFailureCode(error) }
            : message.type === MSG.API_REQUEST
              ? { failureCode: 'API_REQUEST' }
              : {}),
          ...(error instanceof AstraWorkValidationError
            ? { validationField: error.validationField }
            : {}),
          ...(message.type === MSG.AUTH_LOGIN ? { code: 'AUTH_BACKGROUND' } : {}),
          ...(error instanceof AstraConflictError ? { code: 'ASTRA_CONFLICT' } : {}),
          ...(error instanceof Error && /account changed/i.test(error.message)
            ? { code: 'ACCOUNT_CHANGED' }
            : {}),
          ...(typeof error?.statusCode === 'number' ? { statusCode: error.statusCode } : {}),
        })
      );
    return true;
  };
}
