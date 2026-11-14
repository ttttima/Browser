// Spaces: sets of tabs of their own (main.ts keeps them). The row at the top
// of the sidebar shows the open space; clicking it opens a pop-out with all
// of them, like the bookmarks one: open one, make a new one, rename it
// (pencil or F2), or right-click for its color and to delete it. In the
// compact sidebar there's no room for the pop-out (the web page is drawn
// above our UI), so the dot switches to the next space instead.
import type { SpaceInfo, TabsState } from './shared';
import { $, actionButton, terra } from './ui-common';

const button = $<HTMLButtonElement>('#space-button');
const nameLabel = $<HTMLElement>('#space-name');
const pop = $<HTMLDivElement>('#spaces-pop');

let spaces: SpaceInfo[] = [];
let activeId = '';
/** Set while a name is typed: id of the space, or null for a new one. */
let editing: { spaceId: string | null; value: string } | null = null;
let replacing = false;
let menuOpenedAt = 0;

function dot(color: string) {
  const box = document.createElement('span');
  box.className = 'space-icon';
  const inner = document.createElement('span');
  inner.className = 'space-dot';
  inner.style.background = color;
  box.append(inner);
  return box;
}

function closePop() {
  if (pop.hidden) return;
  pop.hidden = true;
  editing = null;
  button.ariaExpanded = 'false';
  button.classList.remove('open');
}

function openPop() {
  pop.hidden = false;
  button.ariaExpanded = 'true';
  button.classList.add('open');
  render();
}

button.addEventListener('click', () => {
  if (document.body.classList.contains('sidebar-collapsed')) {
    const index = spaces.findIndex((s) => s.id === activeId);
    const next = spaces[(index + 1) % spaces.length];
    if (next && next.id !== activeId) terra.send('terra:space-switch', next.id);
    return;
  }
  if (pop.hidden) openPop();
  else closePop();
});
button.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  menuOpenedAt = Date.now();
  terra.send('terra:space-menu', activeId);
});

document.addEventListener(
  'pointerdown',
  (event) => {
    const target = event.target as Node;
    if (!pop.contains(target) && !button.contains(target)) closePop();
  },
  true,
);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !pop.hidden && !editing) {
    closePop();
    button.focus();
  }
});
window.addEventListener('blur', () => {
  if (Date.now() - menuOpenedAt > 1000) closePop();
});

function nameField(spaceId: string | null, initial: string) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'pop-name';
  input.placeholder = 'Space name';
  input.maxLength = 64;
  input.value = editing?.value ?? initial;
  input.ariaLabel = spaceId ? 'Space name' : 'New space name';
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    editing = null;
    if (save && spaceId === null) {
      void terra.invoke('terra:space-create', name).then(() => closePop());
    } else if (save && spaceId && name && name !== initial) {
      terra.send('terra:space-update', spaceId, { name });
    } else {
      render();
    }
  };
  input.addEventListener('input', () => {
    if (editing) editing.value = input.value;
  });
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => {
    if (!replacing) finish(true);
  });
  input.addEventListener('click', (event) => event.stopPropagation());
  return input;
}

function spaceRow(space: SpaceInfo) {
  const row = document.createElement('div');
  row.className = 'tab pop-row pop-space';
  row.tabIndex = 0;
  row.dataset.id = space.id;
  row.classList.toggle('active', space.id === activeId);
  row.title = `${space.name} (${space.tabCount} ${space.tabCount === 1 ? 'tab' : 'tabs'})`;
  row.append(dot(space.color));
  if (editing?.spaceId === space.id) {
    row.append(nameField(space.id, space.name));
  } else {
    const label = document.createElement('span');
    label.className = 'tab-title';
    label.textContent = space.name;
    const count = document.createElement('span');
    count.className = 'pop-count';
    count.textContent = String(space.tabCount);
    row.append(
      label,
      count,
      actionButton('pencil', 'Rename space', () => {
        editing = { spaceId: space.id, value: space.name };
        render();
      }),
    );
  }
  const open = () => {
    terra.send('terra:space-switch', space.id);
    closePop();
  };
  row.addEventListener('click', open);
  row.addEventListener('keydown', (event) => {
    if (event.target !== row) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
    if (event.key === 'F2') {
      editing = { spaceId: space.id, value: space.name };
      render();
    }
  });
  row.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    menuOpenedAt = Date.now();
    terra.send('terra:space-menu', space.id);
  });
  return row;
}

function header() {
  const bar = document.createElement('div');
  bar.className = 'pop-header';
  const title = document.createElement('span');
  title.className = 'pop-title';
  title.textContent = 'Spaces';
  bar.append(
    title,
    actionButton('plus', 'New space', () => {
      editing = { spaceId: null, value: '' };
      render();
    }),
  );
  return bar;
}

function render() {
  if (pop.hidden) return;
  const list = document.createElement('div');
  list.className = 'pop-list';
  for (const space of spaces) list.append(spaceRow(space));
  if (editing?.spaceId === null) {
    const row = document.createElement('div');
    row.className = 'tab pop-row pop-space editing';
    row.append(dot('var(--muted)'), nameField(null, ''));
    list.append(row);
  }
  replacing = true;
  pop.replaceChildren(header(), list);
  replacing = false;
  pop.querySelector<HTMLInputElement>('.pop-name')?.focus();
}

export function renderSpaces(state: TabsState) {
  spaces = state.spaces;
  activeId = state.activeSpaceId;
  const active = spaces.find((s) => s.id === activeId);
  nameLabel.textContent = active?.name ?? '';
  button.querySelector<HTMLElement>('.space-dot')!.style.background =
    active?.color ?? '';
  button.title =
    spaces.length > 1
      ? `Space: ${active?.name ?? ''} (click to switch)`
      : 'Spaces: keep sets of tabs apart';
  if (!editing) render();
}

// Main asks to rename (right-click menu → Rename).
terra.on<string>('terra:space-rename', (id) => {
  const space = spaces.find((s) => s.id === id);
  if (!space || document.body.classList.contains('sidebar-collapsed')) return;
  editing = { spaceId: id, value: space.name };
  if (pop.hidden) openPop();
  else render();
});
