import { afterEach, describe, expect, it } from 'vitest';
import { ensurePersistentLoadMore, removePersistentLoadMore } from './PersistentLoadMore';

describe('native Load More restoration', () => {
  afterEach(() => { removePersistentLoadMore(); document.body.replaceChildren(); });
  it('restores original visibility and priority after repeated reconciliation', () => {
    document.body.innerHTML = '<div class="activity-feed-wrap"><div class="activity-feed"></div><button class="load-more" style="display: inline-flex !important">More</button></div>';
    const feed = document.querySelector('.activity-feed')!; const native = document.querySelector<HTMLElement>('.load-more')!;
    ensurePersistentLoadMore(feed); ensurePersistentLoadMore(feed); expect(native.style.display).toBe('none');
    expect(document.querySelectorAll('.au-persistent-load-more').length).toBe(1);
    removePersistentLoadMore(); expect(native.style.display).toBe('inline-flex'); expect(native.style.getPropertyPriority('display')).toBe('important');
    expect(document.querySelector('.au-persistent-load-more')).toBeNull();
  });
  it('restores a control that originally had no display style', () => {
    document.body.innerHTML = '<div><div class="activity-feed"></div><button class="load-more">More</button></div>';
    const native = document.querySelector<HTMLElement>('.load-more')!;
    ensurePersistentLoadMore(document.querySelector('.activity-feed')!); removePersistentLoadMore();
    expect(native.style.display).toBe('');
  });
  it('does not mutate the feed when reconciling an unchanged control', async () => {
    document.body.innerHTML = '<div class="activity-feed-wrap"><div class="activity-feed"></div></div>';
    const feed = document.querySelector('.activity-feed')!;
    ensurePersistentLoadMore(feed);
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(list => records.push(...list));
    observer.observe(feed, { childList: true, subtree: true });
    ensurePersistentLoadMore(feed); ensurePersistentLoadMore(feed);
    await Promise.resolve();
    observer.disconnect();
    // A childList record here re-triggers the feed observers that call this again: an endless loop.
    expect(records).toHaveLength(0);
  });
});
