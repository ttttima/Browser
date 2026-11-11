// The open tabs, saved locally (session.json) so Terra can reopen them after a
// restart or crash. Private tabs are never saved.
import { isText, readJson, saveSoon } from './library';

export interface SavedTab {
  url: string;
  title: string;
  pinned: boolean;
}

export interface SavedSession {
  tabs: SavedTab[];
  active: number;
}

let current: SavedSession = { tabs: [], active: 0 };

export function loadSession(): SavedSession {
  const saved = readJson('session.json') as Partial<SavedSession> | null;
  const tabs = Array.isArray(saved?.tabs)
    ? saved.tabs
        .filter(
          (t): t is SavedTab =>
            t &&
            isText(t.url) &&
            /^(https?|file):/i.test(t.url) &&
            isText(t.title, 1024),
        )
        .map((t) => ({ url: t.url, title: t.title, pinned: t.pinned === true }))
        .slice(0, 500)
    : [];
  const active = Number(saved?.active);
  return {
    tabs,
    active:
      Number.isInteger(active) && active >= 0 && active < tabs.length
        ? active
        : 0,
  };
}

export function saveSession(session: SavedSession) {
  current = session;
  saveSoon('session.json', () => current);
}
