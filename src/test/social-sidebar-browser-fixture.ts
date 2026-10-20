/** Real SocialSidebar component and CSS over synthetic, account-free activity for visual checks. */
import 'reflect-metadata';
import '@/styles/tokens.css';
import '@/styles/main.css';
import '@/styles/social-activity.css';
import '@core/ui/Icons';
import { SocialSidebar } from '@modules/social/components/SocialSidebar';
import { EventBus } from '@core/events/EventBus';
import {
  MediaListStatus,
  type ScoreFormat,
  type SocialActivityDetailed,
  type SocialFilter,
} from '@core/types';

interface FixtureImages {
  cover?: string;
  avatars: string[];
}
interface FixtureOptions {
  pending?: boolean;
  empty?: boolean;
  theme?: 'dark' | 'light';
}
type Row = [
  name: string,
  status: MediaListStatus,
  progress: number,
  score: number,
  format: ScoreFormat,
  notes: string | null,
  hoursAgo: number,
];

const SELF: Row[] = [
  ['ExAstra', MediaListStatus.CURRENT, 3, 0, 'POINT_10_DECIMAL', 'intro 9 outro 7.8', 74],
];
const FOLLOWING: Row[] = [
  [
    'Kurozora',
    MediaListStatus.CURRENT,
    3,
    85,
    'POINT_100',
    'The OP is stuck in my head. Episode 2 fight choreography was way better than expected.',
    2,
  ],
  ['mikanbox', MediaListStatus.COMPLETED, 12, 78, 'POINT_10_DECIMAL', null, 26],
  ['Haruno_', MediaListStatus.CURRENT, 2, 0, 'POINT_10', 'waiting for the BD release', 49],
  ['TsundereTax', MediaListStatus.PLANNING, 0, 0, 'POINT_100', null, 120],
  ['lumen', MediaListStatus.PAUSED, 1, 60, 'POINT_5', 'will pick it up later', 300],
  ['sora.wav', MediaListStatus.DROPPED, 1, 30, 'POINT_10', 'not for me', 720],
  ['Akagi', MediaListStatus.COMPLETED, 12, 92, 'POINT_10_DECIMAL', 'malSync::hidden::', 1400],
];

let view: SocialSidebar | undefined;
let anchor: HTMLElement | undefined;
let images: FixtureImages = { avatars: [] };
let options: FixtureOptions = {};

function rows(
  filter: SocialFilter,
  status: MediaListStatus | 'all',
  userIds?: readonly number[]
): SocialActivityDetailed[] {
  if (options.empty) return [];
  const source = filter === 'self' ? SELF : FOLLOWING;
  return source
    .map(
      (
        [name, rowStatus, progress, score, format, notes, hoursAgo],
        index
      ): SocialActivityDetailed => ({
        id: index + 1,
        status: rowStatus,
        progress,
        score,
        notes,
        updatedAt: Math.floor(Date.now() / 1000 - hoursAgo * 3600),
        user: {
          id: index + 1,
          name,
          avatar: { medium: images.avatars[index % images.avatars.length] ?? '' },
          mediaListOptions: { scoreFormat: format },
        },
      })
    )
    .filter(
      (row) =>
        (status === 'all' || row.status === status) && (!userIds || userIds.includes(row.user.id))
    );
}

export async function mountSocialSidebar(
  nextImages: FixtureImages,
  nextOptions: FixtureOptions = {}
): Promise<void> {
  disposeSocialSidebar();
  images = nextImages;
  options = nextOptions;
  document.body.classList.toggle('au-theme-light', options.theme === 'light');
  const service = {
    getDetailedActivity: (
      _mediaId: number,
      filter: SocialFilter,
      _page: number,
      status: MediaListStatus | 'all',
      userIds?: readonly number[]
    ) =>
      options.pending
        ? new Promise(() => undefined)
        : Promise.resolve({ nodes: rows(filter, status, userIds), hasNextPage: false }),
  };
  const lists: Record<string, { id: number; name: string; avatar: string }[]> = {
    'Best Friends': [
      { id: 1, name: 'Kurozora', avatar: '' },
      { id: 3, name: 'Haruno_', avatar: '' },
    ],
    'Seasonal watch party': [
      { id: 2, name: 'mikanbox', avatar: '' },
      { id: 5, name: 'lumen', avatar: '' },
    ],
  };
  const customLists = {
    init: async () => undefined,
    getLists: () => lists,
    getList: (name: string) => lists[name] ?? [],
    isUserInList: (name: string, id: number) => (lists[name] ?? []).some((user) => user.id === id),
  };
  const api = { getContext: () => ({ sessionId: 'fixture', userId: 99 }) };
  view = new SocialSidebar(service as never, customLists as never, api as never, new EventBus(), {
    error: () => undefined,
  } as never);
  view.mount(document.body);
  anchor = document.createElement('div');
  anchor.className = 'au-fixture-anchor';
  anchor.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  if (images.cover) {
    const cover = document.createElement('img');
    cover.src = images.cover;
    anchor.append(cover);
  }
  document.body.append(anchor);
  await new Promise(requestAnimationFrame);
}

export function openSocialSidebar(title = 'FX Fighter Kurumi-chan'): void {
  view?.open(176496, title, anchor, 'ANIME');
}

export function clickSocialSidebar(selector: string): void {
  view?.getElement().querySelector<HTMLElement>(selector)?.click();
}

export function typeSocialSearch(value: string): void {
  const input = view?.getElement().querySelector<HTMLInputElement>('#au-social-search');
  if (!input) return;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Layout invariants that a screenshot alone does not prove. */
export function verifySocialSidebar(): Record<string, boolean | number> {
  const root = view?.getElement();
  if (!root) return { mounted: false };
  const box = root.getBoundingClientRect();
  // The blurred backdrop bleeds on purpose and is clipped by the header.
  const overflowing = [...root.querySelectorAll<HTMLElement>('*:not(.au-social-backdrop)')].filter(
    (element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 0 &&
        (rect.right > box.right + 0.5 || rect.left < box.left - 0.5) &&
        !element.closest('[style*="display: none"]')
      );
    }
  );
  return {
    mounted: true,
    insideViewport:
      box.left >= 0 &&
      box.right <= innerWidth + 0.5 &&
      box.top >= 0 &&
      box.bottom <= innerHeight + 0.5,
    horizontalOverflow: overflowing.length,
    rows: root.querySelectorAll('.au-friend-row').length,
    width: Math.round(box.width),
  };
}

export function disposeSocialSidebar(): void {
  view?.unmount();
  view = undefined;
  anchor?.remove();
  anchor = undefined;
  document.body.classList.remove('au-theme-light');
}
