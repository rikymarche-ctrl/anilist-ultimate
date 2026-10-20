import { describe, expect, it } from 'vitest';
import { reservedSectionKeys, subSectionKey, uniqueSectionId } from './AstraSectionIds';
import type { AstraSection } from '../AstraInterfaces';

describe('uniqueSectionId', () => {
  it('slugs the display name when nothing is taken', () => {
    expect(uniqueSectionId('  Story Arc ', new Set())).toBe('story_arc');
  });

  it('suffixes a top-level id that matches an existing section id', () => {
    expect(uniqueSectionId('Story', new Set(['story', 'story_2']))).toBe('story_3');
  });

  it('avoids a top-level id that equals a sub-section composite key', () => {
    expect(uniqueSectionId('World Building', new Set(['world', 'world_building']))).toBe(
      'world_building_2'
    );
  });

  it('avoids a sub-section whose composite key is already taken', () => {
    expect(
      uniqueSectionId('Building', new Set(['world', 'world_building']), { parentId: 'world' })
    ).toBe('building_2');
  });

  it('keeps a sub-section id unique among its siblings', () => {
    expect(
      uniqueSectionId('Pacing', new Set(['story_pacing']), {
        parentId: 'story',
        siblingIds: new Set(['pacing']),
      })
    ).toBe('pacing_2');
  });

  it('does not treat a sibling id under another parent as a collision', () => {
    expect(
      uniqueSectionId('Pacing', new Set(['art']), { parentId: 'story', siblingIds: new Set() })
    ).toBe('pacing');
  });

  it('falls back to a non-empty id for blank names', () => {
    expect(uniqueSectionId('   ', new Set())).toBe('section');
    expect(uniqueSectionId('', new Set(['section']))).toBe('section_2');
  });

  it('never returns a key that the backup validator refuses', () => {
    expect(uniqueSectionId('Constructor', new Set())).toBe('constructor_2');
  });
});

describe('reservedSectionKeys', () => {
  it('lists section ids and composite sub-section keys in one namespace', () => {
    const sections: AstraSection[] = [
      {
        id: 'story',
        name: 'Story',
        weight: 1,
        subSections: [{ id: 'pacing', name: 'Pacing', weight: 1 }],
      },
      { id: 'art', name: 'Art', weight: 1 },
    ];
    expect([...reservedSectionKeys(sections)].sort()).toEqual(['art', 'story', 'story_pacing']);
    expect(subSectionKey('story', 'pacing')).toBe('story_pacing');
  });
});
