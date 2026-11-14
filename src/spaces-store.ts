// Spaces (sets of tabs of their own), saved locally in spaces.json: their
// names, colors and which one is open. The tabs themselves are saved with
// the session (session-store.ts), each with the id of its space.
import { isText, readJson, saveSoon } from './library';
import { SPACE_COLORS } from './shared';

export interface Space {
  id: string;
  name: string;
  color: string;
}

export interface SavedSpaces {
  spaces: Space[];
  active: string;
}

export const FIRST_SPACE: Space = {
  id: 'main',
  name: 'Main',
  color: SPACE_COLORS[0].color,
};

const isColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

let current: SavedSpaces = { spaces: [FIRST_SPACE], active: FIRST_SPACE.id };

export function loadSpaces(): SavedSpaces {
  const saved = readJson('spaces.json') as Partial<SavedSpaces> | null;
  const spaces = Array.isArray(saved?.spaces)
    ? saved.spaces
        .filter(
          (s): s is Space =>
            !!s && isText(s.id, 64) && isText(s.name, 64) && isColor(s.color),
        )
        .map((s) => ({ id: s.id, name: s.name, color: s.color.toLowerCase() }))
        .slice(0, 50)
    : [];
  if (!spaces.length) spaces.push({ ...FIRST_SPACE });
  const active =
    typeof saved?.active === 'string' &&
    spaces.some((s) => s.id === saved.active)
      ? saved.active
      : spaces[0].id;
  current = { spaces, active };
  return { spaces: spaces.map((s) => ({ ...s })), active };
}

export function saveSpaces(value: SavedSpaces) {
  current = value;
  saveSoon('spaces.json', () => current);
}
