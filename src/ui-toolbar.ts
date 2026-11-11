// Address bar suggestions, find on page, the site / bookmark / zoom buttons,
// the question bar under the toolbar, and dropping files or links on Nya.
import type { BrowserState, FindResult, Notice, Suggestion } from './shared';
import { $, icon, nya, type IconName } from './ui-common';

// ---------------------------------------------------------------- suggestions

const suggestPanel = $<HTMLDivElement>('#suggest');
const suggestList = $<HTMLUListElement>('#suggest-list');
const backdrop = $<HTMLImageElement>('#suggest-backdrop');
const addressBox = $<HTMLDivElement>('#address-box');

const KIND_ICONS: Record<Suggestion['kind'], IconName> = {
  search: 'search',
  url: 'globe',
  tab: 'tab',
  bookmark: 'star',
  history: 'clock',
};

let input: HTMLInputElement | null = null;
let items: Suggestion[] = [];
let selected = -1;
/** What the user typed, without the inline completion. */
let typed = '';
let request = 0;
let covering = false;
let searchSuggestions = false;

export function setSearchSuggestions(on: boolean) {
  searchSuggestions = on;
}

function position() {
  if (!input) return;
  const area = suggestPanel.getBoundingClientRect();
  const anchor =
    input.id === 'address'
      ? addressBox.getBoundingClientRect()
      : (input.closest('form') ?? input).getBoundingClientRect();
  suggestList.style.left = `${anchor.left - area.left}px`;
  suggestList.style.width = `${anchor.width}px`;
  // 4px under the toolbar, or 8px under the big search box.
  suggestList.style.top =
    input.id === 'address' ? '4px' : `${anchor.bottom - area.top + 8}px`;
}

function render() {
  suggestList.replaceChildren(
    ...items.map((item, index) => {
      const row = document.createElement('li');
      row.className = 'suggest-item';
      row.role = 'option';
      row.ariaSelected = String(index === selected);
      row.classList.toggle('selected', index === selected);
      row.innerHTML = icon(KIND_ICONS[item.kind]);
      const title = document.createElement('span');
      title.className = 'suggest-title';
      title.textContent = item.title;
      const detail = document.createElement('span');
      detail.className = 'suggest-detail';
      detail.textContent = item.detail;
      row.append(title, detail);
      // mousedown, not click: keep focus in the input until we're done.
      row.addEventListener('mousedown', (event) => {
        event.preventDefault();
        choose(item);
      });
      return row;
    }),
  );
  suggestPanel.hidden = items.length === 0;
  position();
}

/** Covers the page with a picture of it, so the dropdown can show above. */
async function cover() {
  if (covering || input?.id !== 'address') return;
  covering = true;
  const picture = await nya.invoke<{
    image: string;
    bounds: { x: number; y: number; width: number; height: number };
  } | null>('nya:suggest-open');
  if (!covering) return;
  if (picture) {
    const area = suggestPanel.getBoundingClientRect();
    Object.assign(backdrop.style, {
      left: `${picture.bounds.x - area.left}px`,
      top: `${picture.bounds.y - area.top}px`,
      width: `${picture.bounds.width}px`,
      height: `${picture.bounds.height}px`,
    });
    backdrop.src = picture.image;
    await backdrop.decode().catch(() => {});
    backdrop.hidden = false;
  }
  await new Promise((resolve) => requestAnimationFrame(resolve));
  if (covering) nya.send('nya:suggest-cover');
}

export function closeSuggestions() {
  request++;
  items = [];
  selected = -1;
  suggestPanel.hidden = true;
  if (covering) {
    covering = false;
    backdrop.hidden = true;
    backdrop.removeAttribute('src');
    nya.send('nya:suggest-close');
  }
}

async function update(target: HTMLInputElement, deleting: boolean) {
  input = target;
  typed = target.value;
  const query = typed.trim();
  if (!query) {
    closeSuggestions();
    return;
  }
  const id = ++request;
  const result = await nya.invoke<{
    suggestions: Suggestion[];
    complete: string;
  }>('nya:suggest', query);
  if (id !== request || document.activeElement !== target) return;

  items = result.suggestions;
  selected = items.length ? 0 : -1;
  // Inline completion: "git" -> "github.com" with "hub.com" selected.
  const caretAtEnd = target.selectionStart === target.value.length;
  if (
    !deleting &&
    caretAtEnd &&
    result.complete &&
    result.complete.startsWith(typed.toLowerCase()) &&
    typed === typed.trimStart()
  ) {
    target.value = typed + result.complete.slice(typed.length);
    target.setSelectionRange(typed.length, target.value.length);
  }
  void cover();
  render();

  if (!searchSuggestions) return;
  const remote = await nya.invoke<Suggestion[]>('nya:suggest-remote', query);
  if (id !== request || !remote.length) return;
  const known = new Set(items.map((item) => item.value));
  items = [...items, ...remote.filter((item) => !known.has(item.value))].slice(
    0,
    8,
  );
  render();
}

function choose(item: Suggestion) {
  const target = input;
  closeSuggestions();
  if (item.kind === 'tab') nya.send('nya:switch-tab', Number(item.value));
  else window.browser.navigate(item.value);
  if (target) {
    target.value = '';
    target.blur();
  }
}

/** What the input shows while a suggestion is highlighted. */
function previewText(item: Suggestion | undefined) {
  if (!item || item.kind === 'tab') return typed;
  return item.kind === 'search' ? item.title : item.value;
}

function preview(item: Suggestion | undefined) {
  if (input) input.value = previewText(item);
}

/**
 * Keys for an input with suggestions. Returns true when handled, so the
 * input's own Enter / Escape handling should not run.
 */
export function suggestKeydown(event: KeyboardEvent): boolean {
  if (suggestPanel.hidden || !input) return false;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    selected =
      ((selected + step + 1 + items.length + 1) % (items.length + 1)) - 1;
    preview(items[selected]);
    render();
    return true;
  }
  if (event.key === 'Enter' && selected >= 0) {
    // The input shows the highlighted suggestion: open it. Otherwise the
    // user typed past it, and the input's own Enter goes where they typed.
    const item = items[selected];
    if (input.value === previewText(item) || input.value === item.title) {
      event.preventDefault();
      choose(item);
      return true;
    }
    return false;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    if (input.value !== typed) input.value = typed;
    closeSuggestions();
    return true;
  }
  if (
    event.key === 'Delete' &&
    event.shiftKey &&
    items[selected]?.kind === 'history'
  ) {
    event.preventDefault();
    nya.send('nya:history-forget', items[selected].value);
    items.splice(selected, 1);
    selected = Math.min(selected, items.length - 1);
    preview(items[selected]);
    render();
    return true;
  }
  return false;
}

export function attachSuggestions(target: HTMLInputElement) {
  target.addEventListener('input', (event) => {
    const type = (event as InputEvent).inputType ?? '';
    void update(target, type.startsWith('delete'));
  });
  target.addEventListener('blur', () => {
    if (input === target) closeSuggestions();
  });
}

window.addEventListener('resize', () => {
  if (!suggestPanel.hidden) position();
});

// ---------------------------------------------------------------- find

const findBar = $<HTMLDivElement>('#find-bar');
const findInput = $<HTMLInputElement>('#find-input');
const findCount = $<HTMLSpanElement>('#find-count');

function openFind() {
  closeSuggestions();
  addressBox.hidden = true;
  findBar.hidden = false;
  findInput.focus();
  findInput.select();
  if (findInput.value) nya.send('nya:find', findInput.value, true, true);
}

function closeFind() {
  if (findBar.hidden) return;
  nya.send('nya:find-stop');
  findBar.hidden = true;
  addressBox.hidden = false;
  findCount.textContent = '';
  findBar.classList.remove('no-match');
}

nya.on('nya:find-open', openFind);
nya.on('nya:find-close', closeFind);
nya.on<FindResult>('nya:find-result', ({ active, total }) => {
  const searching = findInput.value.length > 0;
  findCount.textContent = total
    ? `${active} of ${total}`
    : searching
      ? 'None'
      : '';
  findBar.classList.toggle('no-match', searching && total === 0);
});
findInput.addEventListener('input', () =>
  nya.send('nya:find', findInput.value, true, true),
);
findInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && findInput.value) {
    nya.send('nya:find', findInput.value, !event.shiftKey, false);
  } else if (event.key === 'Escape') {
    closeFind();
  }
});
$('#find-next').addEventListener('click', () =>
  nya.send('nya:find', findInput.value, true, false),
);
$('#find-prev').addEventListener('click', () =>
  nya.send('nya:find', findInput.value, false, false),
);
$('#find-close').addEventListener('click', closeFind);

// ---------------------------------------------------------------- buttons

const siteButton = $<HTMLButtonElement>('#site-button');
const bookmarkButton = $<HTMLButtonElement>('#bookmark-button');
const zoomChip = $<HTMLButtonElement>('#zoom-chip');

window.browser.onStateChanged((state: BrowserState) => {
  siteButton.dataset.security = state.security;
  siteButton.dataset.private = String(state.isPrivate);
  siteButton.title = state.isPrivate
    ? 'Private tab: nothing here is remembered'
    : state.security === 'insecure'
      ? 'Not secure: this site doesn’t use a private connection'
      : 'About this site';
  const canBookmark = state.security !== 'none';
  bookmarkButton.hidden = !canBookmark;
  bookmarkButton.classList.toggle('active', state.bookmarked);
  bookmarkButton.title = state.bookmarked
    ? 'Remove bookmark'
    : 'Bookmark this page';
  zoomChip.hidden = state.zoom === 100;
  zoomChip.textContent = `${state.zoom}%`;
});

siteButton.addEventListener('click', () => {
  const box = siteButton.getBoundingClientRect();
  nya.send('nya:site-menu', box.left, box.bottom + 4);
});
bookmarkButton.addEventListener('click', () => nya.send('nya:bookmark-toggle'));
zoomChip.addEventListener('click', () => nya.send('nya:zoom-reset'));

// ---------------------------------------------------------------- questions

const noticeBar = $<HTMLDivElement>('#notice-bar');
const noticeText = $<HTMLSpanElement>('#notice-text');
const noticeControls = $<HTMLDivElement>('#notice-controls');

nya.on<Notice | null>('nya:notice', (notice) => {
  noticeBar.hidden = !notice;
  document.body.classList.toggle('notice-open', !!notice);
  if (!notice) {
    noticeControls.replaceChildren();
    return;
  }
  noticeText.textContent = notice.text;
  noticeText.title = notice.text;

  const inputs = (notice.fields ?? []).map((field) => {
    const element = document.createElement('input');
    element.type = field.type;
    element.name = field.name;
    element.placeholder = field.label;
    element.ariaLabel = field.label;
    element.spellcheck = false;
    return element;
  });
  let choice: HTMLSelectElement | null = null;
  if (notice.choices?.length) {
    choice = document.createElement('select');
    choice.ariaLabel = 'Choose';
    for (const option of notice.choices) {
      choice.add(new Option(option.label, option.value));
    }
  }
  const answer = (action: string) => {
    const fields: Record<string, string> = {};
    for (const element of inputs) fields[element.name] = element.value;
    nya.send(
      'nya:notice-answer',
      notice.id,
      action,
      fields,
      choice?.value ?? '',
    );
  };
  const buttons = notice.actions.map((action, index) => {
    const button = document.createElement('button');
    button.className = index === 0 ? 'primary' : 'button';
    button.textContent = action.label;
    button.addEventListener('click', () => answer(action.id));
    return button;
  });
  for (const element of inputs) {
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') answer(notice.actions[0].id);
    });
  }
  noticeControls.replaceChildren(
    ...inputs,
    ...(choice ? [choice] : []),
    ...buttons,
  );
  (inputs[0] ?? null)?.focus();
});

// ---------------------------------------------------------------- dropping

/** Files or links dragged in from outside (not our own tabs). */
function isOutsideDrag(event: DragEvent) {
  const types = [...(event.dataTransfer?.types ?? [])];
  return types.includes('Files') || types.includes('text/uri-list');
}

document.addEventListener('dragover', (event) => {
  if (!isOutsideDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  document.body.classList.add('drop-target');
});
document.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget) document.body.classList.remove('drop-target');
});
document.addEventListener('drop', (event) => {
  document.body.classList.remove('drop-target');
  if (!isOutsideDrag(event) || !event.dataTransfer) return;
  event.preventDefault();
  const files = [...event.dataTransfer.files]
    .map((file) => nya.pathForFile(file))
    .filter(Boolean);
  if (files.length) {
    nya.send('nya:open-paths', files);
    return;
  }
  const links = event.dataTransfer
    .getData('text/uri-list')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'));
  if (links.length) nya.send('nya:open-links', links);
});
