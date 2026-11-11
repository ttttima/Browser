// Settings rows added for the everyday features, and the Privacy,
// Bookmarks and Passwords pages.
import {
  PERMISSION_LABELS,
  SEARCH_ENGINES,
  type Bookmark,
  type PanelPage,
  type SavedLogin,
  type Settings,
  type SiteInfo,
} from './shared';
import {
  $,
  actionButton,
  emptyState,
  hostOf,
  letterBadge,
  listText,
  nya,
} from './ui-common';
import { setSearchSuggestions } from './ui-toolbar';

let currentPage: PanelPage | null = null;

/** renderer.ts tells us which page is showing. */
export function pageShown(page: PanelPage) {
  currentPage = page;
  if (page === 'features') void loadUpdates();
  if (page === 'privacy') void loadSites();
  if (page === 'bookmarks') {
    void loadBookmarks();
    void loadImportSources();
  }
  if (page === 'passwords') void loadLogins();
}

// ---------------------------------------------------------------- settings

const startup = $<HTMLSelectElement>('#setting-startup');
const suggestions = $<HTMLInputElement>('#setting-search-suggestions');
const suggestionsText = $<HTMLElement>('#search-suggestions-text');
const blockAds = $<HTMLInputElement>('#setting-block-ads');
const offerPasswords = $<HTMLInputElement>('#setting-offer-passwords');
const clearOnExit = $<HTMLInputElement>('#setting-clear-on-exit');
const autoUpdate = $<HTMLInputElement>('#setting-auto-update');

window.browser.onSettingsChanged((settings: Settings) => {
  startup.value = settings.startup;
  suggestions.checked = settings.searchSuggestions;
  suggestionsText.textContent = `Sends what you type in the address bar to ${SEARCH_ENGINES[settings.searchEngine].name}`;
  setSearchSuggestions(settings.searchSuggestions);
  blockAds.checked = settings.blockAds;
  offerPasswords.checked = settings.offerPasswords;
  clearOnExit.checked = settings.clearOnExit;
  autoUpdate.checked = settings.autoUpdate;
});

const update = (changes: Partial<Settings>) =>
  window.browser.updateSettings(changes);
startup.addEventListener('change', () =>
  update({ startup: startup.value as Settings['startup'] }),
);
suggestions.addEventListener('change', () =>
  update({ searchSuggestions: suggestions.checked }),
);
blockAds.addEventListener('change', () =>
  update({ blockAds: blockAds.checked }),
);
offerPasswords.addEventListener('change', () =>
  update({ offerPasswords: offerPasswords.checked }),
);
clearOnExit.addEventListener('change', () =>
  update({ clearOnExit: clearOnExit.checked }),
);
autoUpdate.addEventListener('change', () =>
  update({ autoUpdate: autoUpdate.checked }),
);

// ---------------------------------------------------------------- updates

const updateStatus = $<HTMLElement>('#update-status');
const updateButton = $<HTMLButtonElement>('#update-button');
let readyVersion: string | null = null;

function showReady(version: string) {
  readyVersion = version;
  updateStatus.textContent = `Nya ${version} is ready to install`;
  updateButton.textContent = 'Restart to update';
  updateButton.disabled = false;
}

async function loadUpdates() {
  const status = await nya.invoke<{
    supported: boolean;
    current: string;
    ready: string | null;
  }>('nya:update-status');
  if (status.ready) return showReady(status.ready);
  updateStatus.textContent = status.supported
    ? `You have Nya ${status.current}`
    : `Nya ${status.current}. Updates work in the installed app.`;
  updateButton.textContent = 'Check now';
  updateButton.disabled = !status.supported;
  autoUpdate.disabled = !status.supported;
}

updateButton.addEventListener('click', async () => {
  if (readyVersion) {
    nya.send('nya:update-install');
    return;
  }
  updateButton.disabled = true;
  updateStatus.textContent = 'Checking for a new version…';
  const version = await nya.invoke<string | null>('nya:update-check');
  if (version) showReady(version);
  else {
    updateStatus.textContent = 'Nya is up to date';
    updateButton.disabled = false;
  }
});
nya.on<string>('nya:update-ready', showReady);

// ---------------------------------------------------------------- privacy

const sitesList = $<HTMLDivElement>('#sites-list');

function chip(label: string, blocked: boolean, onRemove: () => void) {
  const element = document.createElement('span');
  element.className = `permission-chip${blocked ? ' block' : ''}`;
  element.textContent = label;
  const remove = document.createElement('button');
  remove.title = 'Forget';
  remove.ariaLabel = `Forget: ${label}`;
  remove.innerHTML =
    '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>';
  remove.addEventListener('click', onRemove);
  element.append(remove);
  return element;
}

async function loadSites() {
  const sites = await nya.invoke<SiteInfo[]>('nya:sites');
  if (!sites.length) {
    sitesList.replaceChildren(
      emptyState('No website has asked for anything yet'),
    );
    return;
  }
  sitesList.replaceChildren(
    ...sites.map((site) => {
      const row = document.createElement('div');
      row.className = 'list-row';
      const text = document.createElement('span');
      text.className = 'list-text';
      const title = document.createElement('span');
      title.className = 'list-title';
      title.textContent = hostOf(site.origin);
      const chips = document.createElement('span');
      chips.className = 'site-permissions';
      for (const [name, decision] of Object.entries(site.permissions)) {
        const label = `${PERMISSION_LABELS[name] ?? name} · ${decision === 'allow' ? 'Allowed' : 'Blocked'}`;
        chips.append(
          chip(label, decision === 'block', () =>
            nya.send('nya:site-reset', site.origin, name),
          ),
        );
      }
      if (site.allowAds) {
        chips.append(
          chip('Ads allowed', false, () =>
            nya.send('nya:site-set', site.origin, 'allowAds', false),
          ),
        );
      }
      if (site.neverSavePasswords) {
        chips.append(
          chip('Never save passwords', true, () =>
            nya.send('nya:site-set', site.origin, 'neverSavePasswords', false),
          ),
        );
      }
      if (site.zoom !== 0) {
        chips.append(
          chip(`Zoom ${Math.round(1.2 ** site.zoom * 100)}%`, false, () =>
            nya.send('nya:site-set', site.origin, 'zoom', 0),
          ),
        );
      }
      text.append(title, chips);
      row.append(
        letterBadge(hostOf(site.origin)),
        text,
        actionButton('remove', 'Forget this site', () =>
          nya.send('nya:site-reset', site.origin),
        ),
      );
      return row;
    }),
  );
}

nya.on('nya:sites-changed', () => {
  if (currentPage === 'privacy') void loadSites();
});

// ---------------------------------------------------------------- bookmarks

const bookmarksList = $<HTMLDivElement>('#bookmarks-list');
const bookmarksSearch = $<HTMLInputElement>('#bookmarks-search');
let bookmarks: Bookmark[] = [];

async function loadBookmarks() {
  bookmarks = await nya.invoke<Bookmark[]>('nya:bookmarks');
  renderBookmarks();
}

function renameRow(row: HTMLElement, bookmark: Bookmark) {
  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'rename';
  field.value = bookmark.title;
  field.ariaLabel = 'Bookmark name';
  const finish = (save: boolean) => {
    if (save && field.value.trim()) {
      nya.send('nya:bookmark-rename', bookmark.id, field.value);
    }
    renderBookmarks();
  };
  field.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') finish(false);
  });
  field.addEventListener('blur', () => finish(true));
  field.addEventListener('click', (event) => event.stopPropagation());
  row.querySelector('.list-text')?.replaceWith(field);
  field.focus();
  field.select();
}

function renderBookmarks() {
  const query = bookmarksSearch.value.trim().toLowerCase();
  const matches = query
    ? bookmarks.filter(
        (b) =>
          b.title.toLowerCase().includes(query) ||
          b.url.toLowerCase().includes(query),
      )
    : bookmarks;
  if (!matches.length) {
    bookmarksList.replaceChildren(
      emptyState(
        query
          ? 'Nothing matches your search'
          : 'No bookmarks yet. Press Ctrl+D or the star to add one.',
      ),
    );
    return;
  }
  bookmarksList.replaceChildren(
    ...matches.slice(0, 1000).map((bookmark) => {
      const row = document.createElement('div');
      row.className = 'list-row clickable';
      row.tabIndex = 0;
      row.title = bookmark.url;
      const actions = document.createElement('span');
      actions.className = 'list-actions';
      actions.append(
        actionButton('pencil', 'Rename', () => renameRow(row, bookmark)),
        actionButton('remove', 'Remove bookmark', () =>
          nya.send('nya:bookmark-remove', bookmark.id),
        ),
      );
      row.append(
        letterBadge(hostOf(bookmark.url)),
        listText(bookmark.title || hostOf(bookmark.url), hostOf(bookmark.url)),
        actions,
      );
      const open = () => nya.send('nya:open-links', [bookmark.url]);
      row.addEventListener('click', open);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') open();
      });
      return row;
    }),
  );
}

bookmarksSearch.addEventListener('input', renderBookmarks);
nya.on('nya:bookmarks-changed', () => {
  if (currentPage === 'bookmarks') void loadBookmarks();
});

// ---- import from another browser

const importSource = $<HTMLSelectElement>('#import-source');
const importButton = $<HTMLButtonElement>('#import-button');
const importStatus = $<HTMLElement>('#import-status');

async function loadImportSources() {
  const sources =
    await nya.invoke<{ id: string; name: string }[]>('nya:import-sources');
  importSource.replaceChildren(
    ...sources.map((source) => new Option(source.name, source.id)),
  );
  importSource.disabled = importButton.disabled = sources.length === 0;
  if (!sources.length) {
    importSource.add(new Option('No other browsers found', ''));
  }
}

importButton.addEventListener('click', async () => {
  const name = importSource.selectedOptions[0]?.text ?? '';
  importButton.disabled = true;
  importStatus.textContent = `Importing from ${name}…`;
  const result = await nya.invoke<{
    bookmarks: number;
    history: number;
  } | null>('nya:import', importSource.value);
  importButton.disabled = false;
  importStatus.textContent = result
    ? `Added ${result.bookmarks.toLocaleString()} bookmarks and ${result.history.toLocaleString()} history entries from ${name}`
    : `Couldn't read ${name}'s data`;
});

// ---------------------------------------------------------------- passwords

const passwordsList = $<HTMLDivElement>('#passwords-list');
const passwordsSearch = $<HTMLInputElement>('#passwords-search');
const passwordsTitle = $<HTMLElement>('#passwords-title');
const passwordsImport = $<HTMLButtonElement>('#passwords-import');
let logins: SavedLogin[] = [];
let available = true;

async function loadLogins() {
  const result = await nya.invoke<{ available: boolean; logins: SavedLogin[] }>(
    'nya:logins',
  );
  available = result.available;
  logins = result.logins;
  passwordsImport.disabled = !available;
  renderLogins();
}

function renderLogins() {
  passwordsTitle.textContent = `Saved passwords${logins.length ? ` (${logins.length})` : ''}`;
  if (!available) {
    passwordsList.replaceChildren(
      emptyState("Saving passwords isn't available on this computer"),
    );
    return;
  }
  const query = passwordsSearch.value.trim().toLowerCase();
  const matches = query
    ? logins.filter(
        (l) =>
          l.origin.toLowerCase().includes(query) ||
          l.username.toLowerCase().includes(query),
      )
    : logins;
  if (!matches.length) {
    passwordsList.replaceChildren(
      emptyState(
        query
          ? 'Nothing matches your search'
          : 'No saved passwords. Nya offers to save them when you sign in.',
      ),
    );
    return;
  }
  passwordsList.replaceChildren(
    ...matches.map((login) => {
      const row = document.createElement('div');
      row.className = 'list-row';
      const text = listText(
        hostOf(login.origin),
        login.username || '(no name)',
      );
      const secret = document.createElement('small');
      secret.className = 'password-value';
      secret.hidden = true;
      text.append(secret);
      const reveal = actionButton('eye', 'Show password', async () => {
        if (!secret.hidden) {
          secret.hidden = true;
          secret.textContent = '';
          return;
        }
        secret.textContent =
          (await nya.invoke<string | null>('nya:login-reveal', login.id)) ?? '';
        secret.hidden = false;
      });
      const actions = document.createElement('span');
      actions.className = 'list-actions';
      actions.append(
        reveal,
        actionButton('copy', 'Copy password', async () => {
          const password = await nya.invoke<string | null>(
            'nya:login-reveal',
            login.id,
          );
          if (password) await navigator.clipboard.writeText(password);
        }),
        actionButton('remove', 'Delete', () => {
          if (
            confirm(`Delete the saved password for ${hostOf(login.origin)}?`)
          ) {
            nya.send('nya:login-delete', login.id);
          }
        }),
      );
      row.append(letterBadge(hostOf(login.origin)), text, actions);
      return row;
    }),
  );
}

passwordsSearch.addEventListener('input', renderLogins);
passwordsImport.addEventListener('click', async () => {
  const count = await nya.invoke<number | null>('nya:logins-import');
  if (count === null) return;
  passwordsTitle.textContent =
    count > 0
      ? `Imported ${count} passwords`
      : 'No passwords found in that file';
  setTimeout(() => void loadLogins(), 2500);
});
nya.on('nya:logins-changed', () => {
  if (currentPage === 'passwords') void loadLogins();
});
