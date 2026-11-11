// History and downloads: what Terra remembers between runs. Both are saved as
// JSON in the app's user data folder, written shortly after each change.
import { app, shell, type DownloadItem, type Session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type {
  DownloadAction,
  DownloadInfo,
  DownloadState,
  HistoryEntry,
} from './shared';

const MAX_HISTORY = 10_000;
const MAX_DOWNLOADS = 500;

export const newId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------------------------------------------------------------- storage

const dataFile = (name: string) => path.join(app.getPath('userData'), name);

export function readJson(name: string): unknown {
  try {
    const text = fs.readFileSync(dataFile(name), 'utf-8').replace(/^﻿/, '');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const pendingWrites = new Map<string, () => unknown>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;

export function flushWrites() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
  for (const [name, getData] of pendingWrites) {
    try {
      fs.writeFileSync(dataFile(name), JSON.stringify(getData()));
    } catch (error) {
      console.error(`Could not save ${name}`, error);
    }
  }
  pendingWrites.clear();
}

/** Saves a second after the last change, and always before quitting. */
export function saveSoon(name: string, getData: () => unknown) {
  pendingWrites.set(name, getData);
  writeTimer ??= setTimeout(flushWrites, 1000);
}

app.on('will-quit', flushWrites);

export const isText = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length <= max;

// ---------------------------------------------------------------- history

/** Newest first. */
let history: HistoryEntry[] = [];
let historyChanged = () => {};
let historyNotifyTimer: ReturnType<typeof setTimeout> | null = null;

function onHistoryChange() {
  saveSoon('history.json', () => history);
  // Tell the UI at most twice a second; it re-reads when it needs to.
  historyNotifyTimer ??= setTimeout(() => {
    historyNotifyTimer = null;
    historyChanged();
  }, 500);
}

export function initHistory(onChange: () => void) {
  historyChanged = onChange;
  const saved = readJson('history.json');
  history = Array.isArray(saved)
    ? saved
        .filter(
          (e): e is HistoryEntry =>
            e &&
            isText(e.id, 64) &&
            isText(e.url) &&
            /^https?:\/\//i.test(e.url) &&
            isText(e.title, 1024) &&
            typeof e.time === 'number',
        )
        .slice(0, MAX_HISTORY)
    : [];
}

/** Records a visit and returns its id (so the title can be added later). */
export function recordVisit(url: string, title: string): string {
  const latest = history[0];
  // Reloading or re-opening the same page right away: just move it up.
  if (latest && latest.url === url) {
    latest.time = Date.now();
    if (title) latest.title = title;
    onHistoryChange();
    return latest.id;
  }
  const entry: HistoryEntry = { id: newId(), url, title, time: Date.now() };
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  onHistoryChange();
  return entry.id;
}

export function updateVisitTitle(id: string, title: string) {
  const entry = history.find((e) => e.id === id);
  if (!entry || entry.title === title) return;
  entry.title = title.slice(0, 1024);
  onHistoryChange();
}

export const getHistory = () => history;

/**
 * Adds visits imported from another browser, skipping ones already here,
 * and keeps the list newest first. Returns how many were added.
 */
export function importHistory(
  entries: { url: string; title: string; time: number }[],
) {
  const known = new Set(history.map((e) => `${e.url} ${e.time}`));
  let added = 0;
  for (const entry of entries) {
    if (!/^https?:\/\//i.test(entry.url) || entry.url.length > 4096) continue;
    if (known.has(`${entry.url} ${entry.time}`)) continue;
    history.push({
      id: newId(),
      url: entry.url,
      title: entry.title.slice(0, 1024),
      time: entry.time,
    });
    added++;
  }
  history.sort((a, b) => b.time - a.time);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  onHistoryChange();
  return added;
}

/** Forgets every visit to one address (Shift+Delete in the address bar). */
export function deleteHistoryUrl(url: string) {
  const before = history.length;
  history = history.filter((e) => e.url !== url);
  if (history.length !== before) onHistoryChange();
}

export function deleteHistoryEntry(id: string) {
  history = history.filter((e) => e.id !== id);
  onHistoryChange();
}

export function clearHistory() {
  history = [];
  onHistoryChange();
}

// ---------------------------------------------------------------- downloads

interface Tracked {
  info: DownloadInfo;
  item: DownloadItem | null;
}

/** Newest first. */
let downloads: Tracked[] = [];
let downloadsSession: Session | null = null;
let downloadsChanged = () => {};
let downloadsNotifyTimer: ReturnType<typeof setTimeout> | null = null;

const ACTIVE: DownloadState[] = ['progressing', 'paused'];

function onDownloadsChange(immediate: boolean) {
  saveSoon('downloads.json', () =>
    downloads.map((d) => d.info).filter((info) => !ACTIVE.includes(info.state)),
  );
  if (immediate) {
    if (downloadsNotifyTimer) clearTimeout(downloadsNotifyTimer);
    downloadsNotifyTimer = null;
    downloadsChanged();
    return;
  }
  // Progress ticks: at most four updates a second.
  downloadsNotifyTimer ??= setTimeout(() => {
    downloadsNotifyTimer = null;
    downloadsChanged();
  }, 250);
}

/** "file.zip" -> "file (1).zip" if it already exists. */
function uniquePath(folder: string, filename: string) {
  const { name, ext } = path.parse(filename || 'download');
  let candidate = path.join(folder, `${name}${ext}`);
  for (let n = 1; fs.existsSync(candidate); n++) {
    candidate = path.join(folder, `${name} (${n})${ext}`);
  }
  return candidate;
}

export function initDownloads(
  session: Session,
  options: { askWhere: () => boolean; onChange: () => void },
) {
  downloadsSession = session;
  downloadsChanged = options.onChange;

  const saved = readJson('downloads.json');
  downloads = Array.isArray(saved)
    ? saved
        .filter(
          (d): d is DownloadInfo =>
            d &&
            isText(d.id, 64) &&
            isText(d.filename, 1024) &&
            isText(d.url, 8192) &&
            isText(d.path, 4096) &&
            typeof d.received === 'number' &&
            typeof d.total === 'number' &&
            typeof d.started === 'number',
        )
        .slice(0, MAX_DOWNLOADS)
        .map((info) => ({
          // Anything that was still running when Terra closed is gone now.
          info: {
            ...info,
            state: ACTIVE.includes(info.state) ? 'interrupted' : info.state,
            canResume: false,
          },
          item: null,
        }))
    : [];

  session.on('will-download', (_event, item) => {
    // Straight into Downloads, like other browsers, unless the user asked
    // to pick a place every time (then Electron shows a Save dialog).
    if (!options.askWhere()) {
      item.setSavePath(
        uniquePath(app.getPath('downloads'), item.getFilename()),
      );
    }

    const tracked: Tracked = {
      info: {
        id: newId(),
        filename: item.getFilename(),
        url: item.getURL(),
        path: item.getSavePath(),
        received: 0,
        total: item.getTotalBytes(),
        state: 'progressing',
        started: Date.now(),
        canResume: false,
        exists: false,
      },
      item,
    };
    downloads.unshift(tracked);
    if (downloads.length > MAX_DOWNLOADS) downloads.length = MAX_DOWNLOADS;
    onDownloadsChange(true);

    item.on('updated', (_e, state) => {
      const info = tracked.info;
      const before = info.state;
      info.state =
        state === 'interrupted'
          ? 'interrupted'
          : item.isPaused()
            ? 'paused'
            : 'progressing';
      info.received = item.getReceivedBytes();
      info.total = item.getTotalBytes();
      info.canResume = item.canResume();
      const savePath = item.getSavePath();
      if (savePath) {
        info.path = savePath;
        info.filename = path.basename(savePath);
      }
      onDownloadsChange(before !== info.state);
    });

    item.once('done', (_e, state) => {
      const info = tracked.info;
      info.state = state;
      info.received = item.getReceivedBytes();
      info.total = item.getTotalBytes() || info.received;
      info.canResume = false;
      info.path = item.getSavePath() || info.path;
      tracked.item = null;
      // Cancelled in the Save dialog before anything happened: forget it.
      if (state === 'cancelled' && !info.path) {
        downloads = downloads.filter((d) => d !== tracked);
      }
      onDownloadsChange(true);
    });
  });
}

/** The list for the UI, with "is the file still there?" filled in. */
export function getDownloads(): DownloadInfo[] {
  return downloads.map(({ info }) => ({
    ...info,
    exists:
      info.state === 'completed' && !!info.path && fs.existsSync(info.path),
  }));
}

export const hasActiveDownloads = () =>
  downloads.some((d) => ACTIVE.includes(d.info.state));

export function downloadAction(id: string, action: DownloadAction) {
  const tracked = downloads.find((d) => d.info.id === id);
  if (!tracked) return;
  const { info, item } = tracked;

  switch (action) {
    case 'pause':
      item?.pause();
      break;
    case 'resume':
      if (item?.canResume()) item.resume();
      break;
    case 'cancel':
      item?.cancel();
      break;
    case 'open':
      if (info.state === 'completed' && fs.existsSync(info.path)) {
        void shell.openPath(info.path);
      }
      return;
    case 'show':
      if (info.path && fs.existsSync(info.path)) {
        shell.showItemInFolder(info.path);
      } else {
        void shell.openPath(app.getPath('downloads'));
      }
      return;
    case 'retry':
      if (/^https?:\/\//i.test(info.url)) {
        downloads = downloads.filter((d) => d !== tracked);
        downloadsSession?.downloadURL(info.url);
      }
      break;
    case 'remove':
      item?.cancel();
      downloads = downloads.filter((d) => d !== tracked);
      break;
  }
  onDownloadsChange(true);
}

/** Removes finished entries from the list (files stay on disk). */
export function clearDownloads() {
  downloads = downloads.filter((d) => ACTIVE.includes(d.info.state));
  onDownloadsChange(true);
}

export function openDownloadsFolder() {
  void shell.openPath(app.getPath('downloads'));
}
