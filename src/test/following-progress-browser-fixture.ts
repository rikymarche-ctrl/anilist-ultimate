/** Native DOM and alias batching with synthetic identities, never an AniList account. */
import 'reflect-metadata';
import { GraphQLBatcher } from '@core/api/GraphQLBatcher';
import { EventBus } from '@core/events/EventBus';
import { EVENT_TYPES } from '@core/events/EventTypes';
import type { IApiClient } from '@core/interfaces/IApiClient';
import { FollowingProgressService } from '@modules/social/FollowingProgressService';
import { FollowingProgressModule } from '@modules/social/FollowingProgressModule';
import { HoverCommentsModule } from '@modules/social/HoverCommentsModule';
import { CommentTooltip } from '@modules/social/CommentTooltip';
import { CommentReader } from '@modules/social/CommentReader';

export async function runFollowingProgressBrowserFixture(preview = false): Promise<string[]> {
  const checks: string[] = [];
  const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
  const until = async (condition: () => boolean) => {
    const deadline = performance.now() + 5000;
    while (!condition()) {
      if (performance.now() > deadline) throw new Error('Following fixture timed out');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  const bus = new EventBus();
  let context = { sessionId: 'following-one', userId: 1 };
  let requests = 0; let progress = 8;
  let pause = false; let release: (() => void) | undefined;
  const api = {
    isAuthenticated: () => true, getContext: () => ({ ...context }), ensureContext: async () => ({ ...context }),
    queryRaw: async (_query: string, variables: Record<string, unknown>) => {
      requests++;
      const data: Record<string, unknown> = {};
      for (const key of Object.keys(variables).filter(key => key.endsWith('_userName'))) {
        const alias = key.slice(0, -'_userName'.length); const name = variables[key];
        data[alias] = { id: 90, mediaId: variables[`${alias}_mediaId`], userId: name === 'Viewer' ? 1 : 2,
          progress: name === 'Zero' ? 0 : name === 'Invalid' ? 1.5 : progress,
          user: { id: name === 'Viewer' ? 1 : 2, name } };
      }
      if (pause) { pause = false; await new Promise<void>(resolve => { release = resolve; }); }
      return { data };
    },
  } as unknown as IApiClient;
  const batcher = new GraphQLBatcher(api);
  const service = new FollowingProgressService(batcher, api);
  const module = new FollowingProgressModule(api, service, bus);
  const parent = document.createElement('div'); parent.className = 'following';
  const row = (name: string) => `<a class="follow" href="/user/${name}/"><div class="name">${name}</div><div class="status">Watching</div><span class="native-comment">Notes</span></a>`;
  const previousLocation = location.pathname + location.search + location.hash;
  try {
    history.replaceState({}, '', '/anime/1/title');
    parent.innerHTML = ['Viewer', 'Friend', 'Zero', 'Invalid'].map(row).join(''); document.body.append(parent);
    const original = parent.querySelector('.native-comment')!; let clicks = 0;
    original.addEventListener('click', () => { clicks++; });
    await module.init();
    const badges = () => [...parent.querySelectorAll('.au-following-progress')];
    await until(() => badges().length === 2);
    assert(badges().every(node => node.textContent === ' · 8 ep'), 'only positive integers may appear');
    assert(requests === 1 && parent.firstElementChild?.querySelector('.au-following-progress') !== null, 'viewer and visible users must share an alias request');
    checks.push('production alias batching includes viewer, validates positive integers and omits zero/invalid progress');
    original.dispatchEvent(new MouseEvent('click'));
    assert(clicks === 1 && parent.querySelector('.native-comment') === original, 'native controls must survive');
    checks.push('native status, profile and comment nodes retain identity and handlers');
    parent.replaceChildren(...[...parent.children].map(node => node.cloneNode(true)));
    await until(() => parent.querySelectorAll('.au-following-progress').length === 2);
    await new Promise(resolve => setTimeout(resolve, 500));
    assert(badges().length === 2 && badges().every(node => node.parentElement?.textContent === 'Watching · 8 ep'), 'cloned badges must not duplicate');
    checks.push('native observer cleans cloned counters and restores one indicator per rerendered row');
    pause = true; progress = 99;
    parent.insertAdjacentHTML('beforeend', row('Late'));
    await until(() => release !== undefined);
    context = { sessionId: 'following-two', userId: 3 }; progress = 2;
    bus.emit(EVENT_TYPES.AUTH_STATE_CHANGED, { isAuthenticated: true, userId: 3, timestamp: new Date() });
    assert(badges().length === 0, 'account change must immediately clear old counters');
    release!();
    await until(() => badges().length === 3);
    assert(badges().every(node => node.textContent === ' · 2 ep'), 'late old account response must not be applied or cached');
    checks.push('account reset clears indicators synchronously and retires a real pending alias batch');
    progress = 4; history.replaceState({}, '', '/anime/2/other');
    bus.emit(EVENT_TYPES.PAGE_CHANGED, { previousPath: '/anime/1/title', path: '/anime/2/other', timestamp: new Date() });
    await until(() => badges().length === 3 && badges().every(node => node.textContent === ' · 4 ep'));
    checks.push('SPA media changes retire old rows and query the current user/media pairs');
    await module.destroy();
    assert(badges().length === 0 && parent.querySelector('.status')?.textContent === 'Watching', 'destroy must preserve native status');
    checks.push('destroy releases observer/timer and removes only extension indicators');
    checks.push(...await runFollowingLayoutBrowserFixture(preview));
    return checks;
  } finally {
    release?.(); await module.destroy(); batcher.destroy(); parent.remove(); history.replaceState({}, '', previousLocation);
  }
}

async function runFollowingLayoutBrowserFixture(preview: boolean): Promise<string[]> {
  const host = document.createElement('div'); host.className = 'following au-following-layout-fixture';
  const nativeStyle = document.createElement('style');
  nativeStyle.textContent = `
    .au-following-layout-fixture { font: 14px Arial,sans-serif; color: #9fadbd; background: #0b1622; padding: 16px; box-sizing: border-box; }
    .au-following-layout-fixture a.follow { display: grid; grid-template-columns: 30px 1fr 110px 70px; gap: 10px; position: relative; padding: 10px; margin: 10px 0; background: #151f2e; color: inherit; text-decoration: none; border-radius: 3px; box-sizing: border-box; }
    .au-following-layout-fixture .avatar { width: 30px; height: 30px; background: #465775; border-radius: 3px; }
    .au-following-layout-fixture .name { font-weight: bold; }
    .au-following-layout-fixture .hover-icon { position: absolute; right: 96px; }
    .au-following-layout-fixture svg { width: 20px; height: 20px; fill: currentColor; }
  `;
  const bubble = '<span class="hover-icon clickable"><svg data-icon="comment" viewBox="0 0 20 20"><ellipse cx="10" cy="8" rx="9" ry="7"/><path d="M4 10v8l7-7z"/></svg></span>';
  const users = [
    { name: 'Hadama123', status: 'Completed', score: '6.8/10', notes: false },
    { name: 'greeed0', status: 'Planning', score: '', notes: false },
    { name: 'ExAstra', status: 'Watching', score: '', notes: true },
    { name: 'TheRealKyuubeyWithALongProfileName', status: 'Completed', score: '7/10', notes: false },
    { name: 'JK2K', status: 'Completed', score: '10/10', notes: true },
  ];
  const context = { sessionId: 'layout', userId: 1 };
  const api = { isAuthenticated: () => true, getContext: () => context, ensureContext: async () => context };
  const service = new FollowingProgressService({ query: async (_q: string, vars: Record<string, unknown>) => ({ id: 90, mediaId: 1, userId: 2,
    user: { id: 2, name: vars.userName }, progress: vars.userName === 'greeed0' ? 0 : 9 }) } as never, api as never);
  const bus = new EventBus(); const module = new FollowingProgressModule(api as never, service, bus);
  const comments = { init: async () => {}, clear: () => {}, getComment: async (username: string, mediaId: number) => users.find(user => user.name === username)?.notes
    ? { username, mediaId, notes: 'Fixture notes', timestamp: Date.now() } : null };
  const hover = new HoverCommentsModule(api as never, { debug: () => {} } as never, bus, comments as never, new CommentTooltip(), new CommentReader());
  const previousLocation = location.pathname + location.search + location.hash;
  const previousFollowing = document.querySelector('.following');
  // The first fixture's rows must not be mistaken for this layout's target.
  previousFollowing?.classList.remove('following');
  let keep = false;
  try {
    history.replaceState({}, '', '/anime/1/title');
    host.innerHTML = `<h3>Following</h3>` + users.map(user => `<a class="follow" href="/user/${user.name}/"><div class="avatar"></div><div class="name">${user.name}</div><div class="status">${user.status}</div>${user.notes ? bubble : ''}${user.score ? `<div class="score">${user.score}</div>` : ''}</a>`).join('');
    host.style.width = '520px'; document.head.append(nativeStyle); document.body.append(host);
    await module.init(); await new Promise(resolve => setTimeout(resolve, 0));
    const assertLayout = () => {
      for (const row of host.querySelectorAll<HTMLElement>('.follow')) {
        const score = row.querySelector<HTMLElement>('.score');
        const comment = row.querySelector<HTMLElement>('.comment-icon-ghost')
          ?? row.querySelector<HTMLElement>('.hover-icon');
        const status = row.querySelector<HTMLElement>('.status')!;
        const fail = (message: string) => { throw new Error(`${message} (${row.querySelector('.name')!.textContent}, width ${host.style.width})`); };
        if (score && Math.abs(score.getBoundingClientRect().right - (row.getBoundingClientRect().right - 10)) > 1) fail('Score must end at the right padding');
        if (comment && score && comment.getBoundingClientRect().right > score.getBoundingClientRect().left - 4) fail('Comment overlaps score');
        if (comment && status.getBoundingClientRect().right > comment.getBoundingClientRect().left - 4) fail('Status overlaps comment');
        if (row.scrollWidth > row.clientWidth + 1) fail('Row overflows');
        if (status.textContent?.startsWith('Completed') && status.querySelector('.au-following-progress')) fail('Completed must be sufficient');
      }
    };
    for (const width of [520, 375]) { host.style.width = `${width}px`; assertLayout(); }
    await hover.init(); await new Promise(resolve => setTimeout(resolve, 20));
    if (host.querySelectorAll('.comment-icon-ghost').length !== 2) throw new Error('Actual comments module must inject both notes controls');
    for (const width of [520, 375]) { host.style.width = `${width}px`; assertLayout(); }
    host.classList.remove('following'); history.replaceState({}, '', '/anime/1/title/social');
    bus.emit(EVENT_TYPES.PAGE_CHANGED, { previousPath: '/anime/1/title', path: '/anime/1/title/social', timestamp: new Date() });
    await new Promise(resolve => setTimeout(resolve, 50));
    if (host.querySelectorAll('.au-following-progress').length !== 1) throw new Error('Social Following must keep the Watching counter');
    if (host.querySelectorAll('.comment-icon-ghost').length !== 2) throw new Error('Social Following must keep both comment controls');
    for (const width of [520, 375]) { host.style.width = `${width}px`; assertLayout(); }
    keep = preview;
    return ['score right alignment and separate native comment/status columns at 520/375px',
      'actual HoverComments replacement preserves non-overlapping columns at both widths',
      'Completed omits episodes while Watching keeps progress, including long profile names',
      'social route finds Following by heading and keeps progress/comment/score layout at 520/375px'];
  } finally {
    const snapshot = keep ? host.cloneNode(true) : null;
    await hover.destroy(); await module.destroy(); host.remove();
    if (snapshot) { (snapshot as HTMLElement).style.width = '520px'; document.body.append(snapshot); }
    else nativeStyle.remove();
    previousFollowing?.classList.add('following'); history.replaceState({}, '', previousLocation);
  }
}
