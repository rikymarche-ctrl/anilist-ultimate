import { afterEach, describe, expect, it } from 'vitest';
import { AstraEnhancementService } from '../services/AstraEnhancementService';
import { PillUIBuilder } from '../ui/PillUIBuilder';
import { ActivityCardStrategy } from './ActivityCardStrategy';

afterEach(() => { document.body.innerHTML = ''; });

describe('ActivityCardStrategy', () => {
  it('adds a pill to each media activity cover and skips text activities', () => {
    document.body.innerHTML = `
      <div class="activity-entry activity-anime">
        <div class="list"><a class="cover" href="/anime/101/first"></a>
          <a class="title" href="/anime/101/first">First Anime</a></div>
      </div>
      <div class="activity-entry activity-manga">
        <div class="list"><a class="cover" href="/manga/202/second"></a>
          <a class="title" href="/manga/202/second">Second Manga</a></div>
      </div>
      <div class="activity-entry activity-text"><div class="list">A text post</div></div>`;
    const strategy = new ActivityCardStrategy();
    const service = new AstraEnhancementService(
      new PillUIBuilder(), [strategy], { isFeatureEnabled: () => true } as never,
      { getPreferences: () => ({ socialEnabled: false, socialShowAvatars: false }) } as never,
    );

    service.enhanceCards('/');

    expect(Array.from(document.querySelectorAll('.activity-entry .au-pill-wrapper'))
      .map(wrapper => wrapper.getAttribute('data-au-media-id'))).toEqual(['101', '202']);
    expect(document.querySelectorAll('.activity-entry [data-action="edit-entry"]')).toHaveLength(2);
    expect(document.querySelector('.activity-text .au-pill-wrapper')).toBeNull();
  });

  it('adds pills to homepage activity cards that omit the generic entry wrapper class', () => {
    document.body.innerHTML = `
      <div class="activity-anime">
        <a class="cover" href="/anime/303/third"></a>
        <a class="title" href="/anime/303/third">Third Anime</a>
      </div>
      <div class="activity-manga">
        <a class="cover" href="/manga/404/fourth"></a>
        <a class="title" href="/manga/404/fourth">Fourth Manga</a>
      </div>
      <div class="activity-entry">
        <a class="cover" href="/anime/505/fifth"></a>
        <a class="title" href="/anime/505/fifth">Fifth Anime</a>
      </div>`;
    const strategy = new ActivityCardStrategy();
    const service = new AstraEnhancementService(
      new PillUIBuilder(), [strategy], { isFeatureEnabled: () => true } as never,
      { getPreferences: () => ({ socialEnabled: false, socialShowAvatars: false }) } as never,
    );

    service.enhanceCards('/');

    expect(Array.from(document.querySelectorAll('.au-pill-wrapper'))
      .map(wrapper => wrapper.getAttribute('data-au-media-id'))).toEqual(['303', '404', '505']);
  });
});
