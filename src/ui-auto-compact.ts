// Auto-compact sidebar (Settings → Appearance): when on, the expanded
// sidebar compacts after AUTO_COMPACT_MS without being used, and resting
// the mouse on the compact sidebar for HOVER_EXPAND_MS opens it again.
//
// "Used" means the mouse is over the sidebar (or the bookmarks pop-out),
// someone is moving through it with the keyboard, or the pop-out is open.
// Main does the actual switch, with the usual slide.
import { AUTO_COMPACT_MS, HOVER_EXPAND_MS } from './shared';
import { $, terra } from './ui-common';

const sidebar = $<HTMLElement>('#sidebar');
const pop = $<HTMLElement>('#bookmarks-pop');

const state = { enabled: false, collapsed: false, settingsOpen: false };
let overSidebar = false;
let overPop = false;
/**
 * Compacted while the mouse was on it (the toggle button): don't open again
 * on hover until the mouse has left once.
 */
let waitForLeave = false;
let idleTimer = 0;
let hoverTimer = 0;

function schedule() {
  window.clearTimeout(idleTimer);
  window.clearTimeout(hoverTimer);
  // Settings covers the sidebar (and its nav follows compact mode).
  if (!state.enabled || state.settingsOpen) return;
  // Keyboard focus only: a clicked button keeps the focus afterwards, and
  // that alone mustn't keep the sidebar open forever.
  const keyboardInside = !!sidebar.querySelector(':focus-visible');
  const inUse = overSidebar || overPop || keyboardInside || !pop.hidden;
  if (!state.collapsed && !inUse) {
    idleTimer = window.setTimeout(
      () => terra.send('terra:sidebar-set', true),
      AUTO_COMPACT_MS,
    );
  } else if (state.collapsed && overSidebar && !waitForLeave) {
    hoverTimer = window.setTimeout(
      () => terra.send('terra:sidebar-set', false),
      HOVER_EXPAND_MS,
    );
  }
}

/** New settings or tabs state: start, stop or move the timers. */
export function updateAutoCompact(changes: Partial<typeof state>) {
  if (changes.collapsed === true && !state.collapsed && overSidebar) {
    waitForLeave = true;
  }
  Object.assign(state, changes);
  schedule();
}

sidebar.addEventListener('pointerenter', () => {
  overSidebar = true;
  schedule();
});
sidebar.addEventListener('pointerleave', () => {
  overSidebar = false;
  waitForLeave = false;
  schedule();
});
pop.addEventListener('pointerenter', () => {
  overPop = true;
  schedule();
});
pop.addEventListener('pointerleave', () => {
  overPop = false;
  schedule();
});
sidebar.addEventListener('focusin', schedule);
sidebar.addEventListener('focusout', () => queueMicrotask(schedule));
// The pop-out opening or closing counts too.
new MutationObserver(schedule).observe(pop, {
  attributes: true,
  attributeFilter: ['hidden'],
});
