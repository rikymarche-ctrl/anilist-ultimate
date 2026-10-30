import { isRecord } from '@/api/GraphQLResponse';
import { isActivityId } from '@/modules/activity/ActivityResponse';
import type { ActivityDetails } from './NotificationFetchService';

export const NOTIFICATION_ACTIVITY_QUERY = `query NotificationActivity($id: Int!) {
  Activity(id: $id) {
    __typename
    ... on ListActivity { id type status progress media { id type title { romaji english userPreferred } } }
    ... on TextActivity { id type text(asHtml: false) }
    ... on MessageActivity { id type isPrivate message(asHtml: false) }
  }
}`;

function fail(): never {
  throw new Error('Invalid notification activity response');
}
function nullableText(value: unknown): string {
  if (value === null) return '';
  if (typeof value !== 'string') fail();
  return value;
}

/** The selected union discriminator and request identity are required; provider nulls are valid. */
export function parseNotificationActivity(
  value: unknown,
  requestedId: number
): ActivityDetails | undefined {
  if (!isActivityId(requestedId)) fail();
  if (value === null) return undefined;
  if (!isRecord(value) || value.id !== requestedId) fail();
  if (value.__typename === 'TextActivity') {
    if (value.type !== null && value.type !== 'TEXT') fail();
    return { text: nullableText(value.text) };
  }
  if (value.__typename === 'MessageActivity') {
    if (value.type !== null && value.type !== 'MESSAGE') fail();
    if (value.isPrivate !== null && typeof value.isPrivate !== 'boolean') fail();
    return { text: nullableText(value.message), isPrivate: value.isPrivate };
  }
  if (
    value.__typename !== 'ListActivity' ||
    (value.type !== null && value.type !== 'ANIME_LIST' && value.type !== 'MANGA_LIST')
  )
    fail();
  const status = [
    nullableText(value.status),
    value.progress === undefined ? '' : nullableText(value.progress),
  ]
    .filter(Boolean)
    .join(' ');
  if (value.media === null) return { text: '', status };
  const media = value.media;
  if (
    !isRecord(media) ||
    !isActivityId(media.id) ||
    (media.type !== null && media.type !== 'ANIME' && media.type !== 'MANGA')
  )
    fail();
  const expectedType =
    value.type === 'ANIME_LIST' ? 'ANIME' : value.type === 'MANGA_LIST' ? 'MANGA' : null;
  if (media.type !== null && expectedType !== null && media.type !== expectedType) fail();
  let mediaTitle = 'Unknown';
  if (media.title !== null) {
    if (!isRecord(media.title)) fail();
    // Follow the viewer's AniList title-language setting first, then romaji (AniList's default), then English.
    const userPreferred = nullableText(media.title.userPreferred);
    const romaji = nullableText(media.title.romaji);
    const english = nullableText(media.title.english);
    mediaTitle = userPreferred || romaji || english || 'Unknown';
  }
  const mediaType = media.type ?? expectedType;
  // Both nullable type fields can be absent. Keep the notification unchanged
  // instead of generating an anime link for a medium with unknown identity.
  if (mediaType === null) return { text: '', status };
  return {
    text: [status, mediaTitle].filter(Boolean).join(' '),
    mediaId: media.id,
    mediaTitle,
    status,
    mediaType,
  };
}

/** Cache values are another unknown boundary; copy only the canonical detail fields. */
export function parseNotificationDetails(value: unknown): ActivityDetails {
  if (!isRecord(value) || typeof value.text !== 'string') fail();
  if (value.isPrivate !== undefined) {
    if (
      (value.isPrivate !== null && typeof value.isPrivate !== 'boolean') ||
      value.mediaId !== undefined ||
      value.mediaTitle !== undefined ||
      value.mediaType !== undefined ||
      value.status !== undefined
    )
      fail();
    return { text: value.text, isPrivate: value.isPrivate };
  }
  if (value.mediaId === undefined) {
    if (
      value.mediaTitle !== undefined ||
      value.mediaType !== undefined ||
      (value.status !== undefined && (typeof value.status !== 'string' || value.text !== ''))
    )
      fail();
    return { text: value.text, ...(value.status === undefined ? {} : { status: value.status }) };
  }
  if (
    !isActivityId(value.mediaId) ||
    typeof value.mediaTitle !== 'string' ||
    !value.mediaTitle ||
    typeof value.status !== 'string' ||
    (value.mediaType !== 'ANIME' && value.mediaType !== 'MANGA') ||
    value.text !== [value.status, value.mediaTitle].filter(Boolean).join(' ')
  )
    fail();
  return {
    text: value.text,
    mediaId: value.mediaId,
    mediaTitle: value.mediaTitle,
    status: value.status,
    mediaType: value.mediaType,
  };
}
