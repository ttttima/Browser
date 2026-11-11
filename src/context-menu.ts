// Right-click menus for web pages: links, images, video, selected text,
// text fields (with spelling fixes) and the page itself.
import {
  Menu,
  clipboard,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';

export interface PageMenuActions {
  openTab: (
    url: string,
    options?: { private?: boolean; background?: boolean },
  ) => void;
  /** Starts a download with a Save dialog. */
  saveAs: (url: string) => void;
  search: (text: string) => void;
  searchEngineName: string;
  print: () => void;
  savePage: () => void;
  viewSource: () => void;
  toggleBookmark: () => void;
  isBookmarked: boolean;
  isPrivate: boolean;
}

const short = (text: string, max = 32) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Runs a media command on the video/audio element under the cursor. */
function media(
  contents: WebContents,
  params: ContextMenuParams,
  command: string,
) {
  const zoom = contents.getZoomFactor() || 1;
  const x = Math.round(params.x / zoom);
  const y = Math.round(params.y / zoom);
  const code = `(() => {
    const el = document.elementFromPoint(${x}, ${y});
    const m = el && (el.closest('video, audio') || el.querySelector?.('video, audio'));
    if (!m) return;
    ${command}
  })()`;
  // true = counts as a user gesture (needed for picture-in-picture).
  contents.executeJavaScript(code, true).catch(() => {});
}

export function showPageMenu(
  window: BrowserWindow,
  contents: WebContents,
  params: ContextMenuParams,
  actions: PageMenuActions,
) {
  const items: MenuItemConstructorOptions[] = [];
  const separator = () => {
    if (items.length && items[items.length - 1].type !== 'separator') {
      items.push({ type: 'separator' });
    }
  };
  const flags = params.editFlags;

  // Spelling fixes first, like other browsers.
  if (params.isEditable && params.misspelledWord) {
    for (const word of params.dictionarySuggestions.slice(0, 5)) {
      items.push({
        label: word,
        click: () => contents.replaceMisspelling(word),
      });
    }
    if (!params.dictionarySuggestions.length) {
      items.push({ label: 'No spelling suggestions', enabled: false });
    }
    items.push({
      label: 'Add to dictionary',
      click: () =>
        contents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
    });
    separator();
  }

  if (params.linkURL && /^(https?|file):/i.test(params.linkURL)) {
    const link = params.linkURL;
    items.push(
      {
        label: 'Open link in new tab',
        click: () => actions.openTab(link, { background: true }),
      },
      {
        label: 'Open link in private tab',
        click: () => actions.openTab(link, { private: true }),
      },
      { label: 'Copy link address', click: () => clipboard.writeText(link) },
      { label: 'Save link as…', click: () => actions.saveAs(link) },
    );
    if (params.linkText && !params.hasImageContents) {
      items.push({
        label: 'Copy link text',
        click: () => clipboard.writeText(params.linkText),
      });
    }
    separator();
  }

  if (params.mediaType === 'image' && params.srcURL) {
    const src = params.srcURL;
    items.push(
      {
        label: 'Open image in new tab',
        click: () => actions.openTab(src, { background: true }),
      },
      { label: 'Save image as…', click: () => actions.saveAs(src) },
      {
        label: 'Copy image',
        click: () => contents.copyImageAt(params.x, params.y),
      },
      { label: 'Copy image address', click: () => clipboard.writeText(src) },
    );
    separator();
  }

  if (params.mediaType === 'video' || params.mediaType === 'audio') {
    const m = params.mediaFlags;
    items.push(
      {
        label: m.isPaused ? 'Play' : 'Pause',
        click: () =>
          media(contents, params, 'm.paused ? m.play() : m.pause();'),
      },
      {
        label: m.isMuted ? 'Unmute' : 'Mute',
        click: () => media(contents, params, 'm.muted = !m.muted;'),
      },
      {
        label: 'Loop',
        type: 'checkbox',
        checked: m.isLooping,
        click: () => media(contents, params, 'm.loop = !m.loop;'),
      },
      {
        label: 'Show controls',
        type: 'checkbox',
        checked: m.isControlsVisible,
        click: () => media(contents, params, 'm.controls = !m.controls;'),
      },
    );
    if (params.mediaType === 'video') {
      items.push({
        label: 'Picture in picture',
        click: () =>
          media(
            contents,
            params,
            'document.pictureInPictureElement ? document.exitPictureInPicture() : m.requestPictureInPicture();',
          ),
      });
    }
    if (params.srcURL && /^https?:/i.test(params.srcURL)) {
      const src = params.srcURL;
      items.push({
        label: `Save ${params.mediaType} as…`,
        click: () => actions.saveAs(src),
      });
    }
    separator();
  }

  if (params.isEditable) {
    items.push(
      { label: 'Undo', role: 'undo', enabled: flags.canUndo },
      { label: 'Redo', role: 'redo', enabled: flags.canRedo },
      { type: 'separator' },
      { label: 'Cut', role: 'cut', enabled: flags.canCut },
      { label: 'Copy', role: 'copy', enabled: flags.canCopy },
      { label: 'Paste', role: 'paste', enabled: flags.canPaste },
      {
        label: 'Paste as plain text',
        role: 'pasteAndMatchStyle',
        enabled: flags.canPaste,
      },
      { label: 'Select all', role: 'selectAll', enabled: flags.canSelectAll },
    );
    separator();
  } else if (params.selectionText.trim()) {
    const text = params.selectionText.trim();
    items.push(
      { label: 'Copy', role: 'copy' },
      {
        label: `Search ${actions.searchEngineName} for “${short(text)}”`,
        click: () => actions.search(text),
      },
    );
    separator();
  }

  // Nothing special under the cursor: actions for the whole page.
  if (
    !params.linkURL &&
    params.mediaType === 'none' &&
    !params.isEditable &&
    !params.selectionText.trim()
  ) {
    items.push(
      {
        label: 'Back',
        enabled: contents.navigationHistory.canGoBack(),
        click: () => contents.navigationHistory.goBack(),
      },
      {
        label: 'Forward',
        enabled: contents.navigationHistory.canGoForward(),
        click: () => contents.navigationHistory.goForward(),
      },
      { label: 'Reload', click: () => contents.reload() },
      { type: 'separator' },
      {
        label: actions.isBookmarked ? 'Remove bookmark' : 'Bookmark this page',
        click: actions.toggleBookmark,
      },
      { label: 'Save page as…', click: actions.savePage },
      { label: 'Print…', click: actions.print },
      { label: 'View page source', click: actions.viewSource },
    );
    separator();
  }

  items.push({
    label: 'Inspect',
    click: () => contents.inspectElement(params.x, params.y),
  });
  Menu.buildFromTemplate(items).popup({ window });
}

/** Right-click in our own UI: just the text editing commands. */
export function showEditMenu(window: BrowserWindow, params: ContextMenuParams) {
  if (!params.isEditable && !params.selectionText) return;
  const flags = params.editFlags;
  Menu.buildFromTemplate(
    params.isEditable
      ? [
          { label: 'Undo', role: 'undo', enabled: flags.canUndo },
          { label: 'Redo', role: 'redo', enabled: flags.canRedo },
          { type: 'separator' },
          { label: 'Cut', role: 'cut', enabled: flags.canCut },
          { label: 'Copy', role: 'copy', enabled: flags.canCopy },
          { label: 'Paste', role: 'paste', enabled: flags.canPaste },
          {
            label: 'Select all',
            role: 'selectAll',
            enabled: flags.canSelectAll,
          },
        ]
      : [{ label: 'Copy', role: 'copy' }],
  ).popup({ window });
}
