// Bookmarks and their folders: saved as bookmarks.json and
// bookmark-folders.json in the user data folder, nowhere else.
import { isText, newId, readJson, saveSoon } from './library';
import type { Bookmark, BookmarkFolder } from './shared';

const MAX_BOOKMARKS = 20_000;

const MAX_FOLDERS = 500;

/** Newest first. */
let bookmarks: Bookmark[] = [];
/** In the order they were made. */
let folders: BookmarkFolder[] = [];
let onChange = () => {};

function changed() {
  saveSoon('bookmarks.json', () => bookmarks);
  onChange();
}

function foldersChanged() {
  saveSoon('bookmark-folders.json', () => folders);
  changed();
}

export function initBookmarks(notify: () => void) {
  onChange = notify;
  const savedFolders = readJson('bookmark-folders.json');
  folders = Array.isArray(savedFolders)
    ? savedFolders
        .filter(
          (f): f is BookmarkFolder =>
            f &&
            isText(f.id, 64) &&
            isText(f.title, 256) &&
            typeof f.time === 'number',
        )
        .slice(0, MAX_FOLDERS)
    : [];
  const folderIds = new Set(folders.map((f) => f.id));
  const saved = readJson('bookmarks.json');
  bookmarks = Array.isArray(saved)
    ? saved
        .filter(
          (b): b is Bookmark =>
            b &&
            isText(b.id, 64) &&
            isText(b.url) &&
            /^(https?|file):/i.test(b.url) &&
            isText(b.title, 1024) &&
            typeof b.time === 'number',
        )
        .map((b) => ({
          ...b,
          favicon: validFavicon(b.favicon) ? b.favicon : undefined,
          // A folder that no longer exists: back to the top level.
          folderId:
            isText(b.folderId, 64) && folderIds.has(b.folderId)
              ? b.folderId
              : undefined,
        }))
        .slice(0, MAX_BOOKMARKS)
    : [];
}

export const getFolders = () => folders;

/** Makes a folder and returns its id. */
export function createFolder(title: string) {
  if (folders.length >= MAX_FOLDERS) return null;
  const folder = {
    id: newId(),
    title: title.trim().slice(0, 256) || 'New folder',
    time: Date.now(),
  };
  folders.push(folder);
  foldersChanged();
  return folder.id;
}

export function renameFolder(id: string, title: string) {
  const folder = folders.find((f) => f.id === id);
  const name = title.trim().slice(0, 256);
  if (!folder || !name) return;
  folder.title = name;
  foldersChanged();
}

/** Deletes the folder only; its bookmarks move to the top level. */
export function deleteFolder(id: string) {
  folders = folders.filter((f) => f.id !== id);
  for (const bookmark of bookmarks) {
    if (bookmark.folderId === id) bookmark.folderId = undefined;
  }
  foldersChanged();
}

/** Puts a bookmark in a folder, or at the top level with null. */
export function moveBookmark(id: string, folderId: string | null) {
  const bookmark = bookmarks.find((b) => b.id === id);
  if (!bookmark) return;
  if (folderId !== null && !folders.some((f) => f.id === folderId)) return;
  bookmark.folderId = folderId ?? undefined;
  changed();
}

function validFavicon(favicon: unknown): favicon is string {
  return (
    isText(favicon, 8192) && /^(https?:|data:image\/)/i.test(favicon as string)
  );
}

function originOf(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * A page is open with this icon: bookmarks of that page get it, and
 * bookmarks of the same site that have none yet (imported ones) too.
 */
export function setBookmarkFavicon(pageUrl: string, favicon: string) {
  if (!validFavicon(favicon)) return;
  const origin = originOf(pageUrl);
  let updated = false;
  for (const bookmark of bookmarks) {
    const exact = bookmark.url === pageUrl;
    const sameSite = !bookmark.favicon && originOf(bookmark.url) === origin;
    if ((exact || sameSite) && bookmark.favicon !== favicon) {
      bookmark.favicon = favicon;
      updated = true;
    }
  }
  if (updated) changed();
}

export const getBookmarks = () => bookmarks;

export const isBookmarked = (url: string) =>
  bookmarks.some((bookmark) => bookmark.url === url);

/** Adds the page, or removes it if it's already bookmarked. Returns the new state. */
export function toggleBookmark(
  url: string,
  title: string,
  favicon: string | null = null,
): boolean {
  if (isBookmarked(url)) {
    bookmarks = bookmarks.filter((bookmark) => bookmark.url !== url);
    changed();
    return false;
  }
  bookmarks.unshift({
    id: newId(),
    url,
    title: title.slice(0, 1024),
    time: Date.now(),
    ...(validFavicon(favicon) ? { favicon } : {}),
  });
  if (bookmarks.length > MAX_BOOKMARKS) bookmarks.length = MAX_BOOKMARKS;
  changed();
  return true;
}

export function removeBookmark(id: string) {
  bookmarks = bookmarks.filter((bookmark) => bookmark.id !== id);
  changed();
}

export function renameBookmark(id: string, title: string) {
  const bookmark = bookmarks.find((b) => b.id === id);
  if (!bookmark) return;
  bookmark.title = title.trim().slice(0, 1024);
  changed();
}

/** Adds bookmarks from another browser, skipping addresses already saved. */
export function importBookmarks(
  items: { url: string; title: string; time: number }[],
) {
  const known = new Set(bookmarks.map((b) => b.url));
  let added = 0;
  for (const item of items) {
    if (!/^https?:\/\//i.test(item.url) || item.url.length > 4096) continue;
    if (known.has(item.url)) continue;
    known.add(item.url);
    bookmarks.push({
      id: newId(),
      url: item.url,
      title: item.title.slice(0, 1024),
      time: item.time,
    });
    added++;
  }
  bookmarks.sort((a, b) => b.time - a.time);
  if (bookmarks.length > MAX_BOOKMARKS) bookmarks.length = MAX_BOOKMARKS;
  if (added) changed();
  return added;
}
