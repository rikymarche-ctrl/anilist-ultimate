/** Resolve only media routes, never media links nested in character/staff paths. */
export function getMediaRoute(path: string): { id: number; type: 'ANIME' | 'MANGA' } | null {
  const match = /^\/(anime|manga)\/([1-9]\d*)(?:\/|$)/.exec(path);
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id)) return null;
  return { id, type: match[1] === 'anime' ? 'ANIME' : 'MANGA' };
}
