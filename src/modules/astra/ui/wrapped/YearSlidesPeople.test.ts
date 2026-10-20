import { afterEach, describe, expect, it } from 'vitest';
import type {
  ReviewCreator,
  ReviewVoiceActor,
  YearReviewReport,
} from '../../services/year/YearReviewTypes';
import { WrappedStory, type WrappedSlide } from './WrappedStory';
import { peopleSlides } from './YearSlidesPeople';

const stories: WrappedStory[] = [];
afterEach(() => {
  for (const story of stories.splice(0)) story.dispose();
  document.body.replaceChildren();
});

const creator = (id: number, name: string, patch: Partial<ReviewCreator> = {}): ReviewCreator => ({
  id,
  name,
  image: null,
  titles: 2,
  minutes: 600,
  works: ['Alpha', 'Beta'],
  covers: [
    { title: 'Alpha', cover: 'https://s4.anilist.co/alpha.jpg' },
    { title: 'Beta', cover: null },
  ],
  ...patch,
});

const actor = (id: number, name: string, minutes = 900): ReviewVoiceActor => ({
  id,
  name,
  image: null,
  minutes,
  titles: 2,
  characters: [
    {
      id: id * 10,
      name: `Role of ${name}`,
      image: 'https://s4.anilist.co/role.jpg',
      role: 'MAIN',
      favourites: 1,
      voiceActor: null,
      mediaTitle: 'Show',
    },
  ],
});

/** Five voice actors in rank order: Ann is #1 and minutes fall by 100 per rank. */
const cast = () =>
  ['Ann', 'Ben', 'Cy', 'Dee', 'Eli'].map((name, index) =>
    actor(index + 1, name, 900 - index * 100)
  );

function report(patch: Partial<YearReviewReport> = {}): YearReviewReport {
  return {
    voiceActors: [],
    studios: [],
    directors: [],
    composers: [],
    authors: [],
    social: { likes: 0, replies: 0, posts: 0, messages: 0, fans: [] },
    ...patch,
  } as unknown as YearReviewReport;
}

function mount(data: YearReviewReport): WrappedSlide[] {
  const slides = peopleSlides(data).filter((slide): slide is WrappedSlide => slide !== null);
  document.body.replaceChildren(...slides.map((slide) => slide.element));
  return slides;
}

/** Rendered text with layout whitespace collapsed, as a reader sees it. */
const text = (root: ParentNode, selector: string) =>
  root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
const runnerTags = (root: ParentNode) =>
  [...root.querySelectorAll('.aw-spot-rank')].map((tag) => tag.textContent);
const runnerNames = (root: ParentNode) =>
  [...root.querySelectorAll('[data-spot-runner] b')].map((name) => name.textContent);
const runnerAt = (root: ParentNode, index: number) =>
  root.querySelector<HTMLButtonElement>(`[data-spot-runner="${index}"]`)!;
const swap = (root: ParentNode, index: number) => runnerAt(root, index).click();

describe('Wrapped people spotlights', () => {
  it('orders the spotlights from voice actors to authors and omits empty lists', () => {
    const slides = mount(
      report({
        voiceActors: [actor(1, 'Ann')],
        studios: [creator(7, 'Madhouse')],
        composers: [creator(8, 'Kenji')],
        authors: [creator(9, 'Ito')],
        social: { likes: 3, replies: 0, posts: 0, messages: 0, fans: [] },
      })
    );
    expect(slides.map((slide) => slide.label)).toEqual([
      'Top voice actor',
      'Top studio',
      'Top composer',
      'Top author',
      'Your community',
    ]);
  });

  it('renders no people slides when there is nobody to feature', () => {
    expect(mount(report())).toEqual([]);
  });

  it('phrases the rank label and headline stat for each kind of person', () => {
    const cases: Array<[string, YearReviewReport, string, string, string]> = [
      [
        'Top voice actor',
        report({ voiceActors: [actor(1, 'Ann', 2091)] }),
        'Your voice of the year',
        'YOUR #1 VOICE ACTOR',
        'You listened to Ann for 2,091 minutes',
      ],
      [
        'Top studio',
        report({ studios: [creator(7, 'Madhouse', { minutes: 2091 })] }),
        'Your studio of the year',
        'YOUR #1 STUDIO',
        "You spent 2,091 minutes in Madhouse's worlds",
      ],
      [
        'Top director',
        report({ directors: [creator(1, 'Dir', { minutes: 2091 })] }),
        'Your director of the year',
        'YOUR #1 DIRECTOR',
        'You watched 2,091 minutes directed by Dir',
      ],
      [
        'Top composer',
        report({ composers: [creator(2, 'Kenji', { minutes: 2091 })] }),
        'Your composer of the year',
        'YOUR #1 COMPOSER',
        "You heard Kenji's music for 2,091 minutes",
      ],
      [
        'Top author',
        report({ authors: [creator(3, 'Ito', { minutes: 2091 })] }),
        'Your author of the year',
        'YOUR #1 AUTHOR',
        "You lived in Ito's stories for 2,091 minutes",
      ],
    ];
    for (const [label, data, eyebrow, rank, headline] of cases) {
      const [slide] = mount(data);
      expect(slide.label).toBe(label);
      expect(text(slide.element, '.aw-eyebrow')).toBe(eyebrow);
      expect(text(slide.element, '.aw-spot-name .aw-panel-title')).toBe(rank);
      expect(text(slide.element, '.aw-spot-headline')).toBe(headline);
      expect(text(slide.element, '.aw-ghost-number')).toBe('#1');
    }
  });

  it('falls back to a title count when the person has no minutes (manga-only authors)', () => {
    const [slide] = mount(report({ authors: [creator(3, 'Ada', { minutes: 0, titles: 3 })] }));
    expect(text(slide.element, '.aw-spot-headline')).toBe(
      "Ada's stories filled 3 titles this year"
    );
  });

  it('draws studio heroes as a stack of covers and people as portraits', () => {
    const [studio] = mount(report({ studios: [creator(7, 'Madhouse', { minutes: 60 })] }));
    expect(
      studio.element.querySelectorAll('.aw-spot-hero .aw-collage .aw-cover--collage')
    ).toHaveLength(2);
    expect(studio.element.querySelector('.aw-portrait--xl')).toBeNull();
    const [voice] = mount(report({ voiceActors: cast() }));
    expect(voice.element.querySelector('.aw-portrait--xl')).not.toBeNull();
    expect(voice.element.querySelector('.aw-collage')).toBeNull();
  });

  it('shows the top works of a creator as cover cards and the characters of a voice actor', () => {
    const covers = [
      { title: 'Alpha', cover: null },
      { title: 'Beta', cover: null },
      { title: 'Gamma', cover: null },
    ];
    const [director] = mount(
      report({ directors: [creator(1, 'Dir', { covers, works: ['Alpha', 'Beta', 'Gamma'] })] })
    );
    const cards = [...director.element.querySelectorAll('[data-wrapped-covers] > li')];
    expect(cards.map((card) => card.querySelector('b')!.textContent)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
    expect(director.element.querySelector('[data-wrapped-characters]')).toBeNull();
    const [voice] = mount(report({ voiceActors: cast() }));
    expect(voice.element.querySelectorAll('[data-wrapped-characters] > li')).toHaveLength(1);
    expect(text(voice.element, '[data-wrapped-characters] > li b')).toBe('Role of Ann');
  });

  it('keeps the other four in rank order with their own tags and swaps one into the hero', () => {
    const [slide] = mount(report({ voiceActors: cast() }));
    const { element } = slide;
    expect(runnerTags(element)).toEqual(['#2', '#3', '#4', '#5']);
    swap(element, 2);
    expect(text(element, '.aw-spot-name .aw-panel-title')).toBe('YOUR #3 VOICE ACTOR');
    expect(text(element, '.aw-ghost-number')).toBe('#3');
    expect(text(element, '[data-spot-title]')).toBe('Cy');
    expect(text(element, '.aw-spot-headline')).toBe('You listened to Cy for 700 minutes');
    expect(text(element, '[data-wrapped-characters] > li b')).toBe('Role of Cy');
    expect(runnerTags(element)).toEqual(['#1', '#2', '#4', '#5']);
    expect(runnerNames(element)).toEqual(['Ann', 'Ben', 'Dee', 'Eli']);
    expect(element.querySelector('.aw-spot-hero')!.getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(element.querySelector('[data-spot-title]'));
    swap(element, 4);
    expect(text(element, '[data-spot-title]')).toBe('Eli');
    expect(runnerTags(element)).toEqual(['#1', '#2', '#3', '#4']);
  });

  it('keeps clicks and arrow keys in the runner row away from the story, but lets Escape through', () => {
    const slides = mount(report({ voiceActors: cast(), studios: [creator(7, 'Madhouse')] }));
    const story = new WrappedStory(slides, null);
    stories.push(story);
    document.body.append(story.element);
    story.go(0, false);
    // The view forwards keydown to the story from above, as AstraWrappedView does.
    const keys: string[] = [];
    let storyClicks = 0;
    story.element.addEventListener('keydown', (event) => {
      keys.push(event.key);
      story.handleKey(event);
    });
    story.element.addEventListener('click', () => storyClicks++);
    const { element } = slides[0];
    runnerAt(element, 1).click();
    expect(storyClicks).toBe(0);
    expect(story.current).toBe(0);
    const press = (target: Element, key: string) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    press(runnerAt(element, 0), 'ArrowRight');
    press(runnerAt(element, 0), 'End');
    press(runnerAt(element, 0), 'Escape');
    expect(story.current).toBe(0);
    expect(keys).toEqual(['Escape']);
    press(element.querySelector('[data-spot-title]')!, 'ArrowRight');
    expect(story.current).toBe(1);
    expect(keys).toEqual(['Escape', 'ArrowRight']);
  });

  it('escapes names and keeps markup and unsafe cover URLs out of the spotlight', () => {
    const hostile = actor(1, '<img src=x onerror=alert(1)>Mallory');
    const [slide] = mount(
      report({
        voiceActors: [hostile, actor(2, 'Ben')],
        studios: [
          creator(7, '<svg onload=alert(1)>', {
            covers: [{ title: 'Evil', cover: 'javascript:alert(1)' }],
          }),
        ],
      })
    );
    const name = slide.element.querySelector('[data-spot-title]')!;
    expect(name.textContent).toBe('<img src=x onerror=alert(1)>Mallory');
    expect(name.querySelector('img')).toBeNull();
    expect(
      [...slide.element.querySelectorAll('img')].map((image) => image.getAttribute('src'))
    ).toEqual(['https://s4.anilist.co/role.jpg']);
    const [studio] = mount(
      report({
        studios: [
          creator(7, '<svg onload=alert(1)>', {
            covers: [{ title: 'Evil', cover: 'javascript:alert(1)' }],
          }),
        ],
      })
    );
    expect(studio.element.querySelector('img')).toBeNull();
    expect(text(studio.element, '[data-spot-title]')).toBe('<svg onload=alert(1)>');
  });

  it('footnotes the voice weighting for the person in the hero and adds the creator notes', () => {
    const [voice] = mount(report({ voiceActors: cast() }));
    expect(text(voice.element, '.aw-note')).toContain('lead-equivalent hours for Ann');
    swap(voice.element, 1);
    expect(text(voice.element, '.aw-note')).toContain('lead-equivalent hours for Ben');
    const [director] = mount(report({ directors: [creator(1, 'Dir')] }));
    expect(text(director.element, '.aw-note')).toContain('Directors exclude episode directors.');
  });
});
