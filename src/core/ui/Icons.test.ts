import { describe, expect, it } from 'vitest';
import { iconDefinitions } from './IconDefinitions';

describe('Font Awesome inventory renderer', () => {
  it('renders all inventoried canonical variants using the bundled SVG runtime', async () => {
    await import('./Icons');
    const api = window.FontAwesome as unknown as { icon(definition: { prefix: string; iconName: string }): { html: string[] } | undefined };
    for (const definition of iconDefinitions) {
      const svg = api.icon({ prefix: definition.prefix, iconName: definition.iconName });
      expect(svg?.html[0]).toContain('<path');
      expect(svg?.html[0]).toContain(`data-icon="${definition.iconName}"`);
      expect(definition.icon[2]).toEqual([]);
    }
  });
});
