# Terra

Terra is a desktop web browser built with Electron + TypeScript + Vite (Electron Forge).

- `src/main.ts`: main process (tabs, windows, settings, shortcuts, security)
- `src/preload.ts`: the only bridge between the UI and the main process
- `src/renderer.ts` + `index.html` + `src/index.css`: the browser UI
- `src/shared.ts`: types and constants used by all three
- `src/ui-*.ts`: UI modules (toolbar: suggestions, find, questions bar;
  sidebar: bookmarks above the tabs; bookmarks pop-out with folders;
  pages: privacy, bookmarks, passwords)
- `src/tab-preload.ts`: runs in every website (dark mode forcer, password
  helper), in an isolated world
- Data modules: `library.ts` (history, downloads), `bookmarks.ts`,
  `passwords.ts`, `site-settings.ts`, `session-store.ts`, plus `importer.ts`,
  `adblock.ts`, `updater.ts`, `suggest.ts`, `context-menu.ts`
- `src/from-nya.ts`: Terra used to be called Nya; on the first start it
  copies Nya's data over and removes the old Nya app

Everything the user saves (history, bookmarks, passwords, settings, open
tabs) stays on their computer in the user data folder; never send it
anywhere. Passwords are encrypted with `safeStorage`. Only GitHub (updates),
the ad block list, and opt-in search suggestions use the network.

Terra must never need administrator rights: the app and installer run as
`asInvoker` and Squirrel installs per user into `%LocalAppData%`. Don't add
anything that requires elevation (machine-wide installs, writing to Program
Files or HKLM, services, drivers).

Run `npm start`. Before finishing, run `npm run typecheck` and `npm run lint`.

## Design rules

The owner cares a lot about symmetry and cleanliness. Every UI change must
follow these rules. All values live as tokens at the top of `src/index.css`;
use the tokens and never hard-code a size, radius, color or duration.

### 1. Everything sits on a 4px grid

- Spacing (padding, margin, gap) uses only: 4, 8, 12, 16, 24, 32, 48.
- Every size (width, height, icon) is a multiple of 4.
- No odd pixels (3px, 6px, 10px, 14px, 12.5px...). The only exception is 1px
  borders and 2px focus/selection rings.

### 2. Three control heights

| Token          | Size | Used for                                           |
| -------------- | ---- | -------------------------------------------------- |
| `--control-sm` | 24   | small inline buttons (tab close), swatches         |
| `--control`    | 32   | buttons, inputs, selects, tabs, list rows          |
| `--control-lg` | 48   | bars (toolbar, sidebar header/footer), hero search |

A bar is always `--control-lg` tall and holds `--control` items, giving
exactly 8px above and below them.

### 3. Four radii, nested correctly

- `--radius-sm` 4: tiny things inside controls (letter badges, close button)
- `--radius` 8: every control
- `--radius-lg` 12: cards
- `--radius-full`: only for things that are round by nature (switches,
  color swatches, the new-tab search pill)
- A shape inside another uses `outer radius - padding` so curves stay parallel.

### 4. Shared axes and lines

- Sidebar, settings nav and any future side panel are `--sidebar-full` (240)
  wide; collapsed sidebar is 48.
- Every icon in the sidebar is centered on the same vertical axis, 24px from
  the left edge. This axis is identical when collapsed, so icons never jump.
- In a row with an icon on the left and a button on the right (a tab), both
  are centered the same distance (16px) from their edge: mirrored.
- Horizontal lines line up across columns: the sidebar header's bottom border
  continues the toolbar's bottom border; settings uses the same 48px top bar.
- Content columns (settings panels, new-tab search) are max 640 wide and
  centered.

### 5. One icon style

- Icons are inline SVG, 24x24 viewBox, `stroke: currentColor`, stroke-width
  2, round caps and joins, no fill. Drawn at `--icon` (16px).
- Never use text characters as icons (no ←, →, ⟳, ×, +).

### 6. Type scale

- Only these sizes: 10 (letter badges only), 12 (secondary text, labels),
  13 (all normal UI text), 16 (new-tab search), 24 (page titles), 40 (new-tab headline only,
  in Redaction 50).
- Only two weights: 400 and 600.

### 7. Color and motion

- Colors only from theme tokens (`--bg`, `--panel`, `--text`, `--accent`...),
  so all three color modes (dark, light, OLED) and the accent color work.
- The selected state is the same everywhere: `--accent-soft` background and
  `--text-strong` text (active tab, active settings category).
- Hover is the same everywhere: `--hover` background.
- Lines between sections (bars, sidebar edge, rows) use `--divider`, never
  `--border`, so the "Section dividers" setting can hide them. Hidden lines
  stay 1px wide and transparent so nothing shifts. New dividers must also
  get a rule in the "smooth dividers" section of `index.css`.
- One transition duration, `--duration` (150ms), on color/background/border/
  transform only. The window opening/closing animation is
  not CSS UI motion: it lives in `src/window-animation.ts`.
- The one size animation is the sidebar sliding between compact and normal
  (`--sidebar-open` in `index.css`, `toggleSidebar` in `main.ts`). It also
  uses `--duration`; the web page is swapped for a picture while it slides.

### 8. Sync with main.ts

`TOOLBAR_HEIGHT`, `SIDEBAR_WIDTH` and `SIDEBAR_COLLAPSED_WIDTH` in
`src/main.ts` position the web page and must equal `--control-lg`,
`--sidebar-width` and `--sidebar-collapsed` in `src/index.css`.
