import { beforeEach, describe, expect, it } from 'vitest';
import { ensurePlaced, musicPlacement, watchOrderPlacement } from './OverviewPlacement';

const order = () =>
  Array.from(document.querySelector('.overview')!.children).map((el) => el.className);

function section(cls: string, label?: string): HTMLElement {
  const el = document.createElement('div');
  el.className = cls;
  if (label) el.innerHTML = `<h2>${label}</h2>`;
  return el;
}

describe('OverviewPlacement', () => {
  let overview: HTMLElement;
  let wo: HTMLElement;
  let music: HTMLElement;

  const place = () => [
    ensurePlaced(wo, overview, watchOrderPlacement(overview)),
    ensurePlaced(music, overview, musicPlacement(overview)),
  ];

  beforeEach(() => {
    document.body.innerHTML = '<div class="overview"></div>';
    overview = document.querySelector('.overview')!;
    wo = section('au-watchorder-section');
    music = section('au-music-section');
  });

  it('puts Watch Order after Relations and the themes after Characters', () => {
    overview.append(section('relations'), section('characters'), section('staff'));
    place();
    expect(order()).toEqual([
      'relations',
      'au-watchorder-section',
      'characters',
      'au-music-section',
      'staff',
    ]);
    expect(place()).toEqual([false, false]); // already in place: no DOM writes
  });

  it('moves our sections back when AniList inserts Relations/Characters after them', () => {
    overview.append(section('staff'));
    place();
    expect(order()).toEqual(['au-watchorder-section', 'au-music-section', 'staff']);

    // Vue inserts its new sections before its own next element (staff), below ours.
    overview.querySelector('.staff')!.before(section('relations'), section('characters'));
    expect(order()).toEqual([
      'au-watchorder-section',
      'au-music-section',
      'relations',
      'characters',
      'staff',
    ]);

    place();
    expect(order()).toEqual([
      'relations',
      'au-watchorder-section',
      'characters',
      'au-music-section',
      'staff',
    ]);
  });

  it('keeps one order when both sections fall back to Staff, whoever mounts first', () => {
    overview.append(section('staff'));
    ensurePlaced(music, overview, musicPlacement(overview));
    ensurePlaced(wo, overview, watchOrderPlacement(overview));
    const first = order();

    document.body.innerHTML = '<div class="overview"><div class="staff"></div></div>';
    overview = document.querySelector('.overview')!;
    ensurePlaced(wo, overview, watchOrderPlacement(overview));
    ensurePlaced(music, overview, musicPlacement(overview));
    expect(order()).toEqual(first);
    expect(first).toEqual(['au-watchorder-section', 'au-music-section', 'staff']);
  });

  it('finds sections by heading when the class is missing, and appends without anchors', () => {
    overview.append(section('', 'Characters'));
    ensurePlaced(music, overview, musicPlacement(overview));
    expect(overview.children[1]).toBe(music);

    const empty = document.createElement('div');
    ensurePlaced(wo, empty, watchOrderPlacement(empty));
    expect(empty.lastElementChild).toBe(wo);
  });
});
