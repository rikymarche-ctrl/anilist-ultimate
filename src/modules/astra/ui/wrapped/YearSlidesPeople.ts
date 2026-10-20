/**
 * @file YearSlidesPeople.ts
 * @description The "people" chapter of Astra Wrapped: one spotlight per kind of creator
 * (voice actors, studios, directors, composers, authors) and the community that liked and
 * messaged the user. A spotlight features the #1 person; the runners-up can be swapped into
 * the hero in place, without moving the story along.
 */

import { html } from '@core/utils/Template';
import type {
  ReviewCreator,
  ReviewFan,
  ReviewVoiceActor,
  YearReviewReport,
} from '../../services/year/YearReviewTypes';
import { LIQUID_PALETTES, type LiquidPalette } from './LiquidBackground';
import { formatNumber, plural } from './WrappedFormat';
import {
  coverArt,
  counter,
  eyebrow,
  inner,
  note,
  rise,
  slideShell,
  stagger,
  type WrappedSlide,
} from './WrappedStory';
import { hours, portrait, tile } from './YearSlideParts';

/** Cards beside the hero: a voice actor's characters or a creator's top works. */
const CARDS = 3;
/** The #1 person plus four runners-up. */
const SPOTLIGHT_PEOPLE = 5;
/** Work titles named under a creator's title count. */
const WORK_NAMES = 2;
/** Covers stacked behind a studio's hero. */
const COLLAGE_COVERS = 3;

type SpotlightKind = 'voice' | 'studio' | 'director' | 'composer' | 'author';

interface SpotlightCard {
  readonly title: string;
  readonly image: string | null;
  /** Line under the card title (the media a character comes from); empty for works. */
  readonly caption: string;
}

/** A person reduced to what a spotlight shows. */
interface SpotlightEntry {
  readonly name: string;
  /** Portrait; studios have none and are drawn from their covers instead. */
  readonly image: string | null;
  readonly minutes: number;
  readonly titles: number;
  /** Characters played (voice actors only; null for creators). */
  readonly characters: number | null;
  /** Names of the top works (creators only). */
  readonly works: readonly string[];
  readonly cards: readonly SpotlightCard[];
}

interface SpotlightCopy {
  /** Role in the rank label: "YOUR #1 VOICE ACTOR". */
  readonly role: string;
  /** Story progress label. */
  readonly slide: string;
  readonly eyebrow: string;
  readonly palette: LiquidPalette;
  readonly footnote: (entry: SpotlightEntry) => string;
}

const CREATOR_NOTE = 'Ranked by titles followed, then minutes watched.';

const SPOTLIGHTS: Record<SpotlightKind, SpotlightCopy> = {
  voice: {
    role: 'VOICE ACTOR',
    slide: 'Top voice actor',
    eyebrow: 'Your voice of the year',
    palette: LIQUID_PALETTES.rose,
    footnote: (entry) =>
      `Ranked by time watched: a lead role counts fully, a supporting role about a third. ${formatNumber(hours(entry.minutes))} lead-equivalent hours for ${entry.name}.`,
  },
  studio: {
    role: 'STUDIO',
    slide: 'Top studio',
    eyebrow: 'Your studio of the year',
    palette: LIQUID_PALETTES.ocean,
    footnote: () => `${CREATOR_NOTE} Counts cover anime only.`,
  },
  director: {
    role: 'DIRECTOR',
    slide: 'Top director',
    eyebrow: 'Your director of the year',
    palette: LIQUID_PALETTES.lava,
    footnote: () => `${CREATOR_NOTE} Directors exclude episode directors.`,
  },
  composer: {
    role: 'COMPOSER',
    slide: 'Top composer',
    eyebrow: 'Your composer of the year',
    palette: LIQUID_PALETTES.violet,
    footnote: () => `${CREATOR_NOTE} Counts cover anime only.`,
  },
  author: {
    role: 'AUTHOR',
    slide: 'Top author',
    eyebrow: 'Your author of the year',
    palette: LIQUID_PALETTES.oil,
    footnote: () => `${CREATOR_NOTE} Counts cover anime and manga.`,
  },
};

export function peopleSlides(report: YearReviewReport): Array<WrappedSlide | null> {
  return [
    spotlightSlide('voice', report.voiceActors.map(voiceEntry)),
    spotlightSlide('studio', report.studios.map(creatorEntry)),
    spotlightSlide('director', report.directors.map(creatorEntry)),
    spotlightSlide('composer', report.composers.map(creatorEntry)),
    spotlightSlide('author', report.authors.map(creatorEntry)),
    socialSlide(report),
  ];
}

function voiceEntry(actor: ReviewVoiceActor): SpotlightEntry {
  return {
    name: actor.name,
    image: actor.image,
    minutes: actor.minutes,
    titles: actor.titles,
    characters: actor.characters.length,
    works: [],
    cards: actor.characters.slice(0, CARDS).map((character) => ({
      title: character.name,
      image: character.image,
      caption: character.mediaTitle,
    })),
  };
}

function creatorEntry(person: ReviewCreator): SpotlightEntry {
  return {
    name: person.name,
    image: person.image,
    minutes: person.minutes,
    titles: person.titles,
    characters: null,
    works: person.works.slice(0, WORK_NAMES),
    cards: person.covers.map((work) => ({ title: work.title, image: work.cover, caption: '' })),
  };
}

/** Rank-one spotlight for a kind of person; null when the list is empty. */
function spotlightSlide(
  kind: SpotlightKind,
  entries: readonly SpotlightEntry[]
): WrappedSlide | null {
  const people = entries.slice(0, SPOTLIGHT_PEOPLE);
  if (!people.length) return null;
  const copy = SPOTLIGHTS[kind];
  const element = slideShell(`people-${kind}`);
  const host = html`<div class="aw-spot-stage"></div>`;
  let selected = 0;
  const show = (index: number, focus: boolean): void => {
    selected = index;
    host.replaceChildren(...stage(kind, people, selected, (next) => show(next, true)));
    if (focus) host.querySelector<HTMLElement>('[data-spot-title]')?.focus({ preventScroll: true });
  };
  show(0, false);
  inner(element).append(rise(eyebrow(copy.eyebrow), 0), host);
  return { label: copy.slide, palette: copy.palette, element };
}

/** Everything that changes when a runner is swapped in: headline, hero, cards, runners, footnote. */
function stage(
  kind: SpotlightKind,
  people: readonly SpotlightEntry[],
  selected: number,
  onSelect: (index: number) => void
): HTMLElement[] {
  const person = people[selected];
  const rank = String(selected + 1);
  const hero = html`<div class="aw-spot-hero" aria-current="true">
    <div class="aw-spot-art"></div>
    <div class="aw-spot-name">
      <span class="aw-panel-title">YOUR #${rank} ${SPOTLIGHTS[kind].role}</span>
      <h4 class="aw-title-xl aw-spot-title" tabindex="-1" data-spot-title>${person.name}</h4>
    </div>
  </div>`;
  hero.querySelector('.aw-spot-art')!.append(heroArt(kind, person));
  hero.querySelector('.aw-spot-name')!.append(...statsLines(person));

  const cards = html`<ul class="aw-characters aw-spot-cards"></ul>`;
  cards.toggleAttribute(kind === 'voice' ? 'data-wrapped-characters' : 'data-wrapped-covers', true);
  for (const card of person.cards) {
    const item = html`<li class="aw-character">
      <b>${card.title}</b><small>${card.caption}</small>
    </li>`;
    if (!card.caption) item.querySelector('small')!.remove();
    item.prepend(coverArt(card.image, card.title, 'aw-cover aw-cover--character'));
    cards.append(item);
  }

  const main = html`<div class="aw-spot-main"></div>`;
  main.append(hero, runnerRow(kind, people, selected, onSelect));
  const layout = html`<div class="aw-spot-layout"></div>`;
  layout.append(main, cards);
  // The big rank numeral fills the open space beside the headline, like the top-title slide.
  const ghost = html`<span class="aw-ghost-number aw-spot-ghost" aria-hidden="true">#${rank}</span>`;
  return [ghost, headline(kind, person), layout, note(SPOTLIGHTS[kind].footnote(person))];
}

/** Round portrait for people; a stack of top covers for studios (they have no picture). */
function heroArt(kind: SpotlightKind, person: SpotlightEntry): HTMLElement {
  if (kind !== 'studio') return portrait(person.image, person.name, 'xl');
  const collage = html`<div class="aw-collage" aria-hidden="true"></div>`;
  const covers = person.cards.slice(0, COLLAGE_COVERS);
  const sources = covers.length ? covers : [{ title: person.name, image: null, caption: '' }];
  for (const cover of sources)
    collage.append(coverArt(cover.image, cover.title, 'aw-cover aw-cover--collage'));
  return collage;
}

function statsLines(person: SpotlightEntry): HTMLElement[] {
  const lines = [
    person.characters === null
      ? html`<p class="aw-cast-stats">
          <b>${formatNumber(person.titles)}</b> ${plural(person.titles, 'title')}
        </p>`
      : html`<p class="aw-cast-stats">
          <b>${formatNumber(person.characters)}</b> ${plural(person.characters, 'character')} across
          <b>${formatNumber(person.titles)}</b> ${plural(person.titles, 'title')}
        </p>`,
  ];
  if (person.works.length)
    lines.push(html`<small class="aw-spot-works">${person.works.join(' · ')}</small>`);
  return lines;
}

/** Headline stat, phrased per kind; falls back to a title count when there are no minutes. */
function headline(kind: SpotlightKind, person: SpotlightEntry): HTMLElement {
  const { name, minutes, titles } = person;
  if (!minutes) {
    return html`<h3 class="aw-heading aw-spot-headline">
      <em>${name}</em>'s stories filled ${counter(titles, 0, 'aw-spot-figure')}
      ${plural(titles, 'title')} this year
    </h3>`;
  }
  const figure = counter(minutes, 0, 'aw-spot-figure');
  switch (kind) {
    case 'voice':
      return html`<h3 class="aw-heading aw-spot-headline">
        You listened to <em>${name}</em> for ${figure} minutes
      </h3>`;
    case 'studio':
      return html`<h3 class="aw-heading aw-spot-headline">
        You spent ${figure} minutes in <em>${name}</em>'s worlds
      </h3>`;
    case 'director':
      return html`<h3 class="aw-heading aw-spot-headline">
        You watched ${figure} minutes directed by <em>${name}</em>
      </h3>`;
    case 'composer':
      return html`<h3 class="aw-heading aw-spot-headline">
        You heard <em>${name}</em>'s music for ${figure} minutes
      </h3>`;
    case 'author':
      return html`<h3 class="aw-heading aw-spot-headline">
        You lived in <em>${name}</em>'s stories for ${figure} minutes
      </h3>`;
  }
}

/**
 * Runners-up (every person but the selected one, in rank order, keeping their own rank tags).
 * Keys and clicks inside the row belong to the runners: they are stopped before the story sees them,
 * so tapping or arrowing through the row never advances the story. Escape still reaches the view.
 */
function runnerRow(
  kind: SpotlightKind,
  people: readonly SpotlightEntry[],
  selected: number,
  onSelect: (index: number) => void
): HTMLElement {
  const row = html`<ul class="aw-people-row aw-spot-runners" data-wrapped-runners></ul>`;
  row.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLElement>('[data-spot-runner]');
    if (button && row.contains(button)) onSelect(Number(button.dataset.spotRunner));
  });
  row.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') event.stopPropagation();
  });
  people.forEach((person, index) => {
    if (index === selected) return;
    const item = html`<li>
      <button type="button" class="aw-spot-runner" data-spot-runner="${String(index)}">
        <span><small class="aw-spot-rank">#${String(index + 1)}</small><b>${person.name}</b></span>
      </button>
    </li>`;
    const art =
      kind === 'studio'
        ? coverArt(person.cards[0]?.image ?? null, person.name, 'aw-cover aw-cover--mini')
        : portrait(person.image, person.name, 'sm');
    item.querySelector('button')!.prepend(art);
    row.append(item);
  });
  return row;
}

const fanCaption = (fan: ReviewFan) =>
  [
    fan.likes ? `${formatNumber(fan.likes)} ${plural(fan.likes, 'like')}` : '',
    fan.messages ? `${formatNumber(fan.messages)} ${plural(fan.messages, 'message')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

function socialSlide(report: YearReviewReport): WrappedSlide | null {
  const { likes, replies, posts, messages, fans } = report.social;
  if (!likes && !replies && !posts && !messages) return null;
  const element = slideShell('social');
  const tiles = html`<div class="aw-year-tiles"></div>`;
  const values: Array<[number, string]> = [
    [likes, 'Likes received'],
    [replies, 'Replies'],
    [posts, 'Status posts'],
    [messages, 'Messages received'],
  ];
  values.forEach(([value, label], index) =>
    tiles.append(stagger(tile(formatNumber(value), label), index))
  );
  inner(element).append(
    rise(eyebrow('Your community'), 0),
    rise(
      html`<h3 class="aw-heading">
        <em>${formatNumber(likes)}</em> ${plural(likes, 'like')} came your way.
      </h3>`,
      1
    ),
    rise(tiles, 2)
  );
  if (fans.length) {
    const [top, ...rest] = fans;
    const fan = html`<div class="aw-glass aw-fan">
      <span
        ><span class="aw-panel-title">Biggest fan</span><b>${top.name}</b>
        <small>${fanCaption(top)}</small></span
      >
    </div>`;
    fan.prepend(portrait(top.avatar, top.name, 'md'));
    if (rest.length) {
      const row = html`<ul class="aw-people-row"></ul>`;
      rest.forEach((person, index) => {
        const item = html`<li>
          <span><b>${person.name}</b><small>${fanCaption(person)}</small></span>
        </li>`;
        item.prepend(portrait(person.avatar, person.name, 'sm'));
        row.append(stagger(item, index));
      });
      fan.append(row);
    }
    inner(element).append(rise(fan, 3));
  }
  return { label: 'Your community', palette: LIQUID_PALETTES.ocean, element };
}
