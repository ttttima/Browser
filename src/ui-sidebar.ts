// Bookmarks in the sidebar, above the tabs: the newest few, with the site's
// icon. Click opens (or switches to) the page, middle click opens a new tab,
// right click shows more. The rest are on the Bookmarks page.
import { SIDEBAR_BOOKMARKS, type Bookmark } from './shared';
import { $, hostOf, icon, terra } from './ui-common';

const list = $<HTMLUListElement>('#bookmark-list');

function siteIcon(bookmark: Bookmark) {
  const box = document.createElement('span');
  box.className = 'tab-icon';
  const letter = () => {
    box.replaceChildren();
    box.classList.add('letter');
    box.textContent = (
      (bookmark.title || hostOf(bookmark.url)).trim()[0] ?? '•'
    ).toUpperCase();
  };
  if (bookmark.favicon) {
    const image = document.createElement('img');
    image.src = bookmark.favicon;
    image.alt = '';
    image.addEventListener('error', letter);
    box.append(image);
  } else {
    letter();
  }
  return box;
}

function row(
  title: string,
  tooltip: string,
  iconElement: HTMLElement,
  open: (inNewTab: boolean) => void,
  menu?: () => void,
) {
  const item = document.createElement('li');
  item.className = 'tab bookmark';
  item.tabIndex = 0;
  item.title = tooltip;
  const label = document.createElement('span');
  label.className = 'tab-title';
  label.textContent = title;
  item.append(iconElement, label);
  item.addEventListener('click', (event) => open(event.ctrlKey));
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open(event.ctrlKey);
    }
  });
  item.addEventListener('mousedown', (event) => {
    if (event.button === 1) event.preventDefault();
  });
  item.addEventListener('auxclick', (event) => {
    if (event.button === 1) open(true);
  });
  if (menu) {
    item.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      menu();
    });
  }
  return item;
}

async function render() {
  const bookmarks = await terra.invoke<Bookmark[]>('terra:bookmarks');
  const shown = bookmarks.slice(0, SIDEBAR_BOOKMARKS);
  const items = shown.map((bookmark) => {
    const title = bookmark.title || hostOf(bookmark.url);
    return row(
      title,
      `${title}\n${bookmark.url}`,
      siteIcon(bookmark),
      (inNewTab) => terra.send('terra:bookmark-open', bookmark.id, inNewTab),
      () => terra.send('terra:bookmark-menu', bookmark.id),
    );
  });
  if (bookmarks.length > shown.length) {
    const more = document.createElement('span');
    more.className = 'tab-icon';
    more.innerHTML = icon('list');
    items.push(
      row('All bookmarks', `All ${bookmarks.length} bookmarks`, more, () =>
        terra.send('terra:open-bookmarks'),
      ),
    );
    items.at(-1)!.classList.add('bookmark-more');
  }
  list.replaceChildren(...items);
  list.hidden = items.length === 0;
}

terra.on('terra:bookmarks-changed', () => void render());

/** Resolves once the bookmarks are drawn the first time. */
export const bookmarksReady = render().catch(() => {});
