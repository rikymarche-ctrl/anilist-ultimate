import { describe, expect, it } from 'vitest';
import { NotificationGroupService } from './NotificationGroupService';

describe('notification targets and wording', () => {
  const service = new NotificationGroupService({ extractActivityId: () => 7, fetchActivityDetails: async () => new Map([[7, { text: 'Parent activity text', mediaId: 7, mediaTitle: 'Manga', mediaType: 'MANGA' }]]), fetchActivityReplies: async () => [], viewerUserId: () => null } as never);
  it.each([
    ['Alice liked your activity reply', 'reply_like', 'activity replies'],
    ['Alice LIKED your forum comment', 'forum_comment_like', 'forum comments'],
    ['Alice replied to your forum comment', 'forum_comment_reply', 'forum comments'],
  ])('keeps the target for %s', (text, type, wording) => {
    expect(service.detectNotificationType(text)).toBe(type);
    expect(service.generateGroupText({ user: 'Alice', types: new Map([[type, 3]]), count: 3, elements: [], firstTime: '', latestTime: '' }).textContent).toContain(wording);
  });
  it('preserves reply-like wording while retaining the activity target and media title', async () => {
    const clone = document.createElement('div'); clone.innerHTML = '<div class="details">Alice liked your activity reply</div>';
    await service.enhanceNotificationsWithActivityDetails([clone]);
    expect(clone.querySelector('.details')?.firstChild?.textContent).toBe('Alice liked your activity reply');
    expect(clone.querySelector('.au-activity-context')?.textContent).toBe('Activity Manga');
  });
  it('links manga activity to the manga route', async () => {
    const clone = document.createElement('div'); clone.innerHTML = '<div class="details">Alice liked your activity</div>';
    await service.enhanceNotificationsWithActivityDetails([clone]);
    expect(clone.querySelector('a.au-title')?.getAttribute('href')).toBe('/manga/7');
    expect(clone.querySelector('a.au-activity-target')?.getAttribute('href')).toBe('/activity/7');
  });
  it('does not classify an activity excerpt as a site notification', () => {
    const notification = document.createElement('div');
    notification.innerHTML = '<a href="/user/Alice/">Alice</a> liked your activity.<span class="au-activity-context">A title was recently added to the site.</span>';
    expect(service.groupingFor(notification)).toMatchObject({ kind: 'user', type: 'activity_like' });
  });
  it('recognizes site airing notices without grouping unrelated text', () => {
    expect(service.detectNotificationType('Episode 3 of Title aired.')).toBe('site_airing');
    expect(service.detectNotificationType('A general unknown notification')).toBe('other');
  });
  it.each([
    ['Nova started following you.', 'follow'],
    ['Nova replied to your comment, in the forum thread', 'forum_comment_reply'],
    ['Nova mentioned you, in the forum thread', 'forum_comment_mention'],
    ['Nova commented in your subscribed forum thread', 'thread_subscribed'],
    ['Your media submission has been partially accepted.', 'media_submission_update'],
    ['Your staff submission has been rejected.', 'staff_submission_update'],
    ['Your character submission status was updated.', 'character_submission_update'],
  ])('recognizes AniList wording: %s', (text, type) => {
    expect(service.detectNotificationType(text)).toBe(type);
  });
  it('gives submission updates a site summary with natural singular and plural wording', () => {
    const notification = document.createElement('div');
    notification.innerHTML = '<a href="/anime/1">Title</a><span>Your media submission has been accepted.</span>';
    expect(service.groupingFor(notification)).toMatchObject({ kind: 'site', type: 'media_submission_update' });
    const single = service.generateGroupText({ user: '', types: new Map([['media_submission_update', 1]]), count: 1, elements: [], firstTime: '', latestTime: '' });
    const plural = service.generateGroupText({ user: '', types: new Map([['media_submission_update', 2]]), count: 2, elements: [], firstTime: '', latestTime: '' });
    expect(single.textContent).toBe('1 media submission update');
    expect(plural.textContent).toBe('2 media submission updates');
  });
  it('keeps a forum mention in the forum-specific type and summary', () => {
    const notification = document.createElement('div');
    notification.innerHTML = '<a href="/user/Nova/">Nova</a><span>mentioned you, in the forum thread</span>';
    expect(service.groupingFor(notification)).toMatchObject({ kind: 'user', type: 'forum_comment_mention', user: 'Nova' });
    const summary = service.generateGroupText({ user: 'Nova', types: new Map([['forum_comment_mention', 2]]), count: 2, elements: [], firstTime: '', latestTime: '' });
    expect(summary.textContent).toBe('mentioned you in 2 forum comments');
  });
});

describe('reply snippets pair each row with its own reply', () => {
  const PARENT = 'Parent activity text';

  function serviceWith(replies: unknown[], viewerId: number | null = 1, text = PARENT) {
    return new NotificationGroupService({
      extractActivityId: () => 7,
      fetchActivityDetails: async () => new Map([[7, { text }]]),
      fetchActivityReplies: async () => replies,
      viewerUserId: () => viewerId,
    } as never);
  }

  function row(markup: string): HTMLElement {
    const element = document.createElement('div');
    element.innerHTML = `<div class="details">${markup}</div>`;
    return element;
  }

  function attachRows(rows: HTMLElement[]): HTMLElement {
    const list = document.createElement('div');
    document.body.append(list);
    list.append(...rows);
    return list;
  }

  it('shows the newest and then older replies of the same actor, in DOM order', async () => {
    const replies = [
      { id: 1, text: 'first reply', userId: 2, userName: 'Nova', likedBy: [] },
      { id: 2, text: 'second reply', userId: 2, userName: 'Nova', likedBy: [] },
      { id: 3, text: 'someone else', userId: 3, userName: 'Other', likedBy: [] },
    ];
    const rows = [
      row('<a href="/user/Nova/">Nova</a> replied to your activity'),
      row('<a href="/user/Nova/">Nova</a> replied to your activity'),
    ];
    const list = attachRows(rows);
    await serviceWith(replies).enhanceNotificationsWithActivityDetails(rows);
    expect(rows[0].querySelector('.au-activity-target')?.textContent).toBe('“second reply”');
    expect(rows[1].querySelector('.au-activity-target')?.textContent).toBe('“first reply”');
    list.remove();
  });

  it('pairs reply-like rows with the viewer replies the actor liked, newest first', async () => {
    const replies = [
      { id: 1, text: 'mine A', userId: 1, userName: 'Me', likedBy: ['Nova'] },
      { id: 2, text: 'theirs', userId: 2, userName: 'Other', likedBy: ['Nova'] },
      { id: 3, text: 'mine B', userId: 1, userName: 'Me', likedBy: ['Nova'] },
      { id: 4, text: 'mine not liked', userId: 1, userName: 'Me', likedBy: [] },
    ];
    const rows = [
      row('<a href="/user/Nova/">Nova</a> liked your activity reply'),
      row('<a href="/user/Nova/">Nova</a> liked your activity reply'),
    ];
    const list = attachRows(rows);
    await serviceWith(replies).enhanceNotificationsWithActivityDetails(rows);
    expect(rows[0].querySelector('.au-activity-target')?.textContent).toBe('“mine B”');
    expect(rows[1].querySelector('.au-activity-target')?.textContent).toBe('“mine A”');
    list.remove();
  });

  it('keeps the parent text when no reply matches', async () => {
    const rows = [row('<a href="/user/Nova/">Nova</a> replied to your activity')];
    const list = attachRows(rows);
    await serviceWith([]).enhanceNotificationsWithActivityDetails(rows);
    expect(rows[0].querySelector('.au-activity-target')?.textContent).toBe(`“${PARENT}”`);
    list.remove();
  });

  it('adds no quote when the parent text is only an image', async () => {
    const rows = [row('<a href="/user/Nova/">Nova</a> liked your activity')];
    const list = attachRows(rows);
    await serviceWith([], 1, 'img300(https://files.example/a.png)').enhanceNotificationsWithActivityDetails(rows);
    expect(rows[0].querySelector('.au-activity-context')).toBeNull();
    list.remove();
  });

  it('fetches replies once per activity even for several rows', async () => {
    let calls = 0;
    const service = new NotificationGroupService({
      extractActivityId: () => 7,
      fetchActivityDetails: async () => new Map([[7, { text: PARENT }]]),
      fetchActivityReplies: async () => {
        calls++;
        return [];
      },
      viewerUserId: () => 1,
    } as never);
    const rows = [
      row('<a href="/user/Nova/">Nova</a> replied to your activity'),
      row('<a href="/user/Nova/">Nova</a> replied to your activity'),
    ];
    const list = attachRows(rows);
    await service.enhanceNotificationsWithActivityDetails(rows);
    expect(calls).toBe(1);
    list.remove();
  });
});
