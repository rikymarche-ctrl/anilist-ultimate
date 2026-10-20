/**
 * @file YearPeople.ts
 * @description The people behind a year: voice actors weighted by time actually watched,
 * studios, directors, composers, authors, and the fans who liked or messaged the user.
 */

import type {
  ReviewCharacter,
  ReviewCreator,
  ReviewFan,
  ReviewMedia,
  ReviewMessage,
  ReviewPost,
  ReviewTitle,
  ReviewUser,
  ReviewVoiceActor,
} from './YearReviewTypes';

/** A supporting role counts for about a third of a lead; background voices are not credited. */
const ROLE_WEIGHT: Record<ReviewCharacter['role'], number> = {
  MAIN: 1,
  SUPPORTING: 0.35,
  BACKGROUND: 0,
};
/** Weighting fallback when AniList has no episode duration. */
const DEFAULT_EPISODE_MINUTES = 24;
const TOP_PEOPLE = 8;
const WORK_COVERS = 3;
const TOP_FANS = 5;
const MESSAGE_WEIGHT = 2;

const DIRECTOR = /^(Chief |Series )?Director(\s*\(|$)/;
const COMPOSER = /^Music(\s*\(|$)/;
const AUTHOR = /^(Original Creator|Original Story|Story & Art|Story|Art)(\s*\(|$)/;

const attention = (title: ReviewTitle) =>
  title.type === 'ANIME' ? title.minutes || title.units * DEFAULT_EPISODE_MINUTES : 0;

export function voiceActors(
  titles: ReviewTitle[],
  media: Map<number, ReviewMedia>
): ReviewVoiceActor[] {
  const actors = new Map<number, ReviewVoiceActor & { score: number; seen: Set<number> }>();
  const order = new Map<number, number>();
  for (const title of titles) {
    const minutes = attention(title);
    if (!minutes) continue;
    for (const character of media.get(title.mediaId)!.characters) {
      const person = character.voiceActor;
      const weight = ROLE_WEIGHT[character.role];
      if (!person || !weight) continue;
      const actor = actors.get(person.id) ?? {
        ...person,
        minutes: 0,
        titles: 0,
        characters: [],
        score: 0,
        seen: new Set<number>(),
      };
      actor.score += weight * minutes;
      if (!actor.seen.has(title.mediaId)) {
        actor.seen.add(title.mediaId);
        actor.titles++;
      }
      if (!actor.characters.some((item) => item.id === character.id)) {
        actor.characters.push({ ...character, mediaTitle: title.title });
        order.set(character.id, minutes);
      }
      actors.set(person.id, actor);
    }
  }
  const characterRank = (a: ReviewCharacter, b: ReviewCharacter) =>
    Number(b.role === 'MAIN') - Number(a.role === 'MAIN') ||
    (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0) ||
    b.favourites - a.favourites;
  return [...actors.values()]
    .sort((a, b) => b.score - a.score || b.titles - a.titles || a.name.localeCompare(b.name))
    .slice(0, TOP_PEOPLE)
    .map(({ score, seen: _seen, ...actor }) => ({
      ...actor,
      minutes: Math.round(score),
      characters: [...actor.characters].sort(characterRank),
    }));
}

type Credit = { person: { id: number; name: string; image: string | null }; title: ReviewTitle };

function rankCreators(credits: Credit[]): ReviewCreator[] {
  const creators = new Map<number, ReviewCreator & { units: Map<number, ReviewTitle> }>();
  for (const { person, title } of credits) {
    const creator = creators.get(person.id) ?? {
      ...person,
      titles: 0,
      minutes: 0,
      works: [],
      covers: [],
      units: new Map(),
    };
    if (!creator.units.has(title.mediaId)) {
      creator.titles++;
      creator.minutes += title.minutes;
      creator.units.set(title.mediaId, title);
    }
    creators.set(person.id, creator);
  }
  return [...creators.values()]
    .sort((a, b) => b.titles - a.titles || b.minutes - a.minutes || a.name.localeCompare(b.name))
    .slice(0, TOP_PEOPLE)
    .map(({ units, ...creator }) => {
      const works = [...units.values()].sort(
        (a, b) => b.units - a.units || a.title.localeCompare(b.title)
      );
      return {
        ...creator,
        works: works.map((title) => title.title),
        covers: works.slice(0, WORK_COVERS).map(({ title, cover }) => ({ title, cover })),
      };
    });
}

export function creators(
  titles: ReviewTitle[],
  media: Map<number, ReviewMedia>
): {
  studios: ReviewCreator[];
  directors: ReviewCreator[];
  composers: ReviewCreator[];
  authors: ReviewCreator[];
} {
  const staff = (pattern: RegExp, type?: ReviewTitle['type']) =>
    rankCreators(
      titles
        .filter((title) => !type || title.type === type)
        .flatMap((title) =>
          media
            .get(title.mediaId)!
            .staff.filter((person) => pattern.test(person.role))
            .map((person) => ({ person, title }))
        )
    );
  return {
    studios: rankCreators(
      titles
        .filter((title) => title.type === 'ANIME')
        .flatMap((title) =>
          media
            .get(title.mediaId)!
            .studios.map((studio) => ({ person: { ...studio, image: null }, title }))
        )
    ),
    directors: staff(DIRECTOR, 'ANIME'),
    composers: staff(COMPOSER, 'ANIME'),
    authors: staff(AUTHOR),
  };
}

/** People who liked the user's activity and posts or left messages, owner excluded. */
export function fans(
  likers: ReviewUser[],
  posts: ReviewPost[],
  messages: ReviewMessage[],
  ownerId: number
): ReviewFan[] {
  const people = new Map<number, ReviewFan>();
  const add = (user: ReviewUser | null, likes: number, sent: number) => {
    if (!user || user.id === ownerId) return;
    const fan = people.get(user.id) ?? { ...user, likes: 0, messages: 0 };
    fan.likes += likes;
    fan.messages += sent;
    people.set(user.id, fan);
  };
  for (const user of likers) add(user, 1, 0);
  for (const post of posts) for (const user of post.likers) add(user, 1, 0);
  for (const message of messages) add(message.sender, 0, 1);
  const weight = (fan: ReviewFan) => fan.likes + MESSAGE_WEIGHT * fan.messages;
  return [...people.values()]
    .sort((a, b) => weight(b) - weight(a) || b.likes - a.likes || a.name.localeCompare(b.name))
    .slice(0, TOP_FANS);
}
