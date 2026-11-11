// Bookmarks: saved as bookmarks.json in the user data folder, nowhere else.
import { isText, newId, readJson, saveSoon } from './library';
import type { Bookmark } from './shared';

const MAX_BOOKMARKS = 20_000;

/** Newest first. */
let bookmarks: Bookmark[] = [];
let onChange = () => {};

function changed() {
  saveSoon('bookmarks.json', () => bookmarks);
  onChange();
}

export function initBookmarks(notify: () => void) {
  onChange = notify;
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
        .map((b) =>
          validFavicon(b.favicon) ? b : { ...b, favicon: undefined },
        )
        .slice(0, MAX_BOOKMARKS)
    : [];
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
