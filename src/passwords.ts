// Saved passwords, kept only on this computer in passwords.json. Each
// password is encrypted with Windows' per-user encryption (DPAPI, through
// Electron's safeStorage), so the file is useless to anyone else or on any
// other account. Passwords are only decrypted in the main process, when a
// site needs them filled in or the user asks to see one.
import { safeStorage } from 'electron';
import { isText, newId, readJson, saveSoon } from './library';
import type { SavedLogin } from './shared';

interface StoredLogin {
  id: string;
  origin: string;
  username: string;
  /** base64 of the encrypted password. */
  secret: string;
  time: number;
}

let logins: StoredLogin[] = [];
let onChange = () => {};

function changed() {
  saveSoon('passwords.json', () => logins);
  onChange();
}

export const canStorePasswords = () => safeStorage.isEncryptionAvailable();

export function initPasswords(notify: () => void) {
  onChange = notify;
  const saved = readJson('passwords.json');
  logins = Array.isArray(saved)
    ? saved.filter(
        (l): l is StoredLogin =>
          l &&
          isText(l.id, 64) &&
          isText(l.origin, 512) &&
          isText(l.username, 512) &&
          isText(l.secret, 16_384) &&
          typeof l.time === 'number',
      )
    : [];
}

const encrypt = (password: string) =>
  safeStorage.encryptString(password).toString('base64');

function decrypt(secret: string): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(secret, 'base64'));
  } catch {
    return null;
  }
}

const toPublic = ({ id, origin, username, time }: StoredLogin): SavedLogin => ({
  id,
  origin,
  username,
  time,
});

export const listLogins = (): SavedLogin[] =>
  [...logins]
    .sort(
      (a, b) =>
        a.origin.localeCompare(b.origin) ||
        a.username.localeCompare(b.username),
    )
    .map(toPublic);

export const loginsFor = (origin: string): SavedLogin[] =>
  logins.filter((l) => l.origin === origin).map(toPublic);

/** Is this exact login already saved (same site, user and password)? */
export function isSaved(origin: string, username: string, password: string) {
  return logins.some(
    (l) =>
      l.origin === origin &&
      l.username === username &&
      decrypt(l.secret) === password,
  );
}

/** Saves a login, replacing the password if this user is already saved. */
export function saveLogin(origin: string, username: string, password: string) {
  if (!canStorePasswords() || !origin || !password) return;
  const existing = logins.find(
    (l) => l.origin === origin && l.username === username,
  );
  if (existing) {
    existing.secret = encrypt(password);
    existing.time = Date.now();
  } else {
    logins.push({
      id: newId(),
      origin,
      username: username.slice(0, 512),
      secret: encrypt(password),
      time: Date.now(),
    });
  }
  changed();
}

export function revealPassword(id: string): string | null {
  const login = logins.find((l) => l.id === id);
  return login ? decrypt(login.secret) : null;
}

export function deleteLogin(id: string) {
  logins = logins.filter((l) => l.id !== id);
  changed();
}

/** Splits one CSV line, honoring quotes ("a, b" and "" for a quote). */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

/** Splits CSV text into lines, keeping line breaks inside quotes. */
function csvRows(text: string): string[] {
  const rows: string[] = [];
  let row = '';
  let quoted = false;
  for (const char of text.replace(/^﻿/, '')) {
    if (char === '"') quoted = !quoted;
    if ((char === '\n' || char === '\r') && !quoted) {
      if (row.trim()) rows.push(row);
      row = '';
    } else {
      row += char;
    }
  }
  if (row.trim()) rows.push(row);
  return rows;
}

/**
 * Imports a passwords CSV exported from Chrome, Edge, Brave, Firefox or
 * most password managers (columns url/origin, username, password).
 * Returns how many logins were added or updated.
 */
export function importPasswordsCsv(text: string): number {
  const rows = csvRows(text);
  if (rows.length < 2) return 0;
  const header = parseCsvLine(rows[0]).map((h) => h.trim().toLowerCase());
  const column = (...names: string[]) =>
    header.findIndex((h) => names.includes(h));
  const urlCol = column('url', 'origin', 'website', 'login_uri', 'login uri');
  const userCol = column('username', 'login', 'login_username', 'user');
  const passCol = column('password', 'login_password');
  if (urlCol < 0 || passCol < 0) return 0;

  let count = 0;
  for (const row of rows.slice(1)) {
    const cells = parseCsvLine(row);
    let origin = '';
    try {
      const url = new URL(cells[urlCol] ?? '');
      if (url.protocol === 'http:' || url.protocol === 'https:')
        origin = url.origin;
    } catch {
      continue;
    }
    const password = cells[passCol] ?? '';
    if (!origin || !password) continue;
    saveLogin(origin, userCol >= 0 ? (cells[userCol] ?? '') : '', password);
    count++;
  }
  return count;
}
