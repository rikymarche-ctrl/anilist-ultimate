import { describe, expect, it } from 'vitest';
import { NotificationGroupService } from './NotificationGroupService';

describe('notification targets and wording', () => {
  const service = new NotificationGroupService({ extractActivityId: () => 7, fetchActivityDetails: async () => new Map([[7, { text: 'Parent activity text', mediaId: 7, mediaTitle: 'Manga', mediaType: 'MANGA' }]]) } as never);
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
