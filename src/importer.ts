// Imports bookmarks and history from other browsers on this computer.
// Everything is read from their local files and copied into Terra's own files;
// nothing goes over the network. Their databases are copied to a temporary
// folder first, so a browser that is still open isn't disturbed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { importBookmarks } from './bookmarks';
import { importHistory } from './library';

export interface ImportSource {
  id: string;
  name: string;
}

interface Source extends ImportSource {
  kind: 'chromium' | 'firefox';
  /** Profile folder. */
  dir: string;
}

const local = process.env.LOCALAPPDATA ?? '';
const roaming = process.env.APPDATA ?? '';

function chromium(id: string, name: string, userData: string): Source | null {
  const dir = path.join(userData, 'Default');
  return fs.existsSync(path.join(dir, 'History')) ||
    fs.existsSync(path.join(dir, 'Bookmarks'))
    ? { id, name, kind: 'chromium', dir }
    : null;
}

/** Opera keeps its profile directly in "Opera Stable", not in "Default". */
function opera(): Source | null {
  const dir = path.join(roaming, 'Opera Software', 'Opera Stable');
  return fs.existsSync(path.join(dir, 'History'))
    ? { id: 'opera', name: 'Opera', kind: 'chromium', dir }
    : null;
}

/** The newest Firefox profile that has a places database. */
function firefox(): Source | null {
  const profiles = path.join(roaming, 'Mozilla', 'Firefox', 'Profiles');
  try {
    const dirs = fs
      .readdirSync(profiles)
      .map((name) => path.join(profiles, name))
      .filter((dir) => fs.existsSync(path.join(dir, 'places.sqlite')))
      .sort(
        (a, b) =>
          fs.statSync(path.join(b, 'places.sqlite')).mtimeMs -
          fs.statSync(path.join(a, 'places.sqlite')).mtimeMs,
      );
    return dirs[0]
      ? { id: 'firefox', name: 'Firefox', kind: 'firefox', dir: dirs[0] }
      : null;
  } catch {
    return null;
  }
}

function findSources(): Source[] {
  if (process.platform !== 'win32') return [];
  return [
    chromium(
      'chrome',
      'Google Chrome',
      path.join(local, 'Google', 'Chrome', 'User Data'),
    ),
    chromium(
      'edge',
      'Microsoft Edge',
      path.join(local, 'Microsoft', 'Edge', 'User Data'),
    ),
    chromium(
      'brave',
      'Brave',
      path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'),
    ),
    chromium('vivaldi', 'Vivaldi', path.join(local, 'Vivaldi', 'User Data')),
    opera(),
    firefox(),
  ].filter((s): s is Source => !!s);
}

export const importSources = (): ImportSource[] =>
  findSources().map(({ id, name }) => ({ id, name }));

/** Opens a copy of a database (plus its write-ahead log) read-only. */
function openCopy(
  file: string,
): { db: DatabaseSync; cleanup: () => void } | null {
  if (!fs.existsSync(file)) return null;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'terra-import-'));
  const copy = path.join(temp, path.basename(file));
  try {
    fs.copyFileSync(file, copy);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(file + suffix))
        fs.copyFileSync(file + suffix, copy + suffix);
    }
    const db = new DatabaseSync(copy, { readOnly: true });
    return {
      db,
      cleanup: () => {
        try {
          db.close();
        } catch {
          // already closed
        }
        fs.rmSync(temp, { recursive: true, force: true });
      },
    };
  } catch {
    fs.rmSync(temp, { recursive: true, force: true });
    return null;
  }
}

// Chromium stores times as microseconds since 1601, too big for a normal
// JavaScript number, so they are read as BigInt.
const fromChromeTime = (value: unknown) => {
  if (typeof value === 'bigint') {
    return value > 0n ? Number(value / 1000n) - 11_644_473_600_000 : Date.now();
  }
  const micro = Number(value);
  return micro > 0 ? Math.round(micro / 1000 - 11_644_473_600_000) : Date.now();
};

interface Item {
  url: string;
  title: string;
  time: number;
}

function chromiumBookmarks(dir: string): Item[] {
  const items: Item[] = [];
  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(dir, 'Bookmarks'), 'utf-8'),
    );
    const walk = (node: Record<string, unknown>) => {
      if (node.type === 'url' && typeof node.url === 'string') {
        items.push({
          url: node.url,
          title: String(node.name ?? ''),
          time: fromChromeTime(node.date_added),
        });
      }
      if (Array.isArray(node.children)) node.children.forEach(walk);
    };
    for (const root of Object.values(data.roots ?? {})) {
      if (root && typeof root === 'object')
        walk(root as Record<string, unknown>);
    }
  } catch {
    // No bookmarks file or unreadable: nothing to import.
  }
  return items;
}

function chromiumHistory(dir: string): Item[] {
  const copy = openCopy(path.join(dir, 'History'));
  if (!copy) return [];
  try {
    const query = copy.db.prepare(
      'SELECT url, title, last_visit_time FROM urls WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT 10000',
    );
    query.setReadBigInts(true);
    return query.all().map((row) => ({
      url: String(row.url),
      title: String(row.title ?? ''),
      time: fromChromeTime(row.last_visit_time),
    }));
  } catch {
    return [];
  } finally {
    copy.cleanup();
  }
}

function firefoxData(dir: string): { bookmarks: Item[]; history: Item[] } {
  const copy = openCopy(path.join(dir, 'places.sqlite'));
  if (!copy) return { bookmarks: [], history: [] };
  try {
    // Firefox stores microseconds since 1970.
    const toMs = (value: unknown) =>
      Math.round(Number(value) / 1000) || Date.now();
    const bookmarks = copy.db
      .prepare(
        'SELECT p.url AS url, b.title AS title, b.dateAdded AS time FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk WHERE b.type = 1',
      )
      .all()
      .map((row) => ({
        url: String(row.url),
        title: String(row.title ?? ''),
        time: toMs(row.time),
      }));
    const history = copy.db
      .prepare(
        'SELECT url, title, last_visit_date AS time FROM moz_places WHERE last_visit_date IS NOT NULL AND hidden = 0 ORDER BY last_visit_date DESC LIMIT 10000',
      )
      .all()
      .map((row) => ({
        url: String(row.url),
        title: String(row.title ?? ''),
        time: toMs(row.time),
      }));
    return { bookmarks, history };
  } catch {
    return { bookmarks: [], history: [] };
  } finally {
    copy.cleanup();
  }
}

export interface ImportResult {
  bookmarks: number;
  history: number;
}

export function importFrom(id: string): ImportResult | null {
  const source = findSources().find((s) => s.id === id);
  if (!source) return null;
  const data =
    source.kind === 'firefox'
      ? firefoxData(source.dir)
      : {
          bookmarks: chromiumBookmarks(source.dir),
          history: chromiumHistory(source.dir),
        };
  return {
    bookmarks: importBookmarks(data.bookmarks),
    history: importHistory(data.history),
  };
}
