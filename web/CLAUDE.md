# Notes for `web/`

## How it's built
- **State lives at one of three levels** (`core/scope.ts`): the vault (settings files), a workspace (tabs, panels,
  pins, open folders, recent files) or the device (current workspace, sidebar widths). Would the user want it different
  for a different kind of work? Then it's the workspace's: `useScopedState(key, fallback, "workspace")`. The core never
  imports Workspaces; it asks the plugin with `workspace` in its definition through scope.ts. A new tab is blank.
- **App plugins load with the app** (eager imports): a plugin never uses the plugin API while its module loads (`npm
  run check`; only `definePlugin` and `devicePref` may run at top level). Loading each plugin on its own was tried:
  phone cold start 1.0 s -> 2.0 s, so no.

## UI conventions
- **One sheet system**: every detail view opens in `components/DetailSheet.tsx` via `openDetail(path)` (a plugin's
  `details`, headed with `SheetHead`); no other modals or sheets. On phones it fills the screen, solid `bg-card`, Done at
  the bottom right of `#sheet-bar` (a portal for the content's own buttons). An unsaved form asks before closing
  (`useSheetGuard`). No bottom sheets.
- **Never the browser's `alert`, `confirm`, `prompt`, `title=` or context menu.** Feedback: `notify()` /
  `notifyError(e, "Couldn't move")`, one line, one action at most, nothing on autosave. What can be undone acts and
  offers Undo; only the irreversible asks (`confirmDialog()`). Tooltips: `data-tip` (`data-tip-trunc`). Menus:
  `menuFor` / `menuBelow` (components/ContextMenu.tsx); a held finger is the right-click (`watchHolds`), so a menu is
  always an onContextMenu (`data-own-hold` for what holds for itself).
- **A file's menus** are groups (`grouped`, FileActions.ts): open, new, change, keep, the plugins' sections, path and
  More ▸, delete. Place a plugin's item with its `section`, never by special-casing it; most go in "more". A choice with
  a common case is a `split` row.
- What a menu shows or hides (panels, pins, a new tab's sections) is a `checklist()` (ContextMenu.tsx): rows that tick
  in place, the menu left open, the hidden ones under More ▸; never `checked` rows by hand.
- **Every scroller is a stacking context** (index.css, by its `overflow-*` class), or iOS draws sticky headings over
  its scroll indicator; a scroller made another way gets `isolate`.
- Overlays (the sheet, the confirm dialog, the palettes, menus, phone drawers) hold the page with `usePageLock`.
- **A shortcut is a command** (`core/commands.ts`: `id`, `keys`, `when`), never a bare keydown listener; users rebind
  in `.vaultite/hotkeys.json`; only keys a browser lets a page take. A widget that keeps keys calls `runShortcut(e)` in
  the capture phase; one whose plain keys are its own is `data-keeps-keys`. Sequences ("Space F F") are listed by
  KeyHints; a step without ⌘/⌃/⌥ never fires while typing. Lists take the keyboard through `core/keylist.ts`
  (`data-keylist` / `data-keyrow`).
- **Keys and labels follow the computer** (`core/platform.ts`: `isMac`, never a regex of your own): text names keys
  through `keyHint` / `commandKeys(id)` (⌘O on a Mac, Ctrl+O elsewhere, and what hotkeys.json says), never "⌘" typed
  in; Finder is `revealLabel`. A default key off a Mac avoids what Linux desktops take (Ctrl+Alt+arrows, Ctrl+.).
- **Colours are tokens**, never hex. A scheme only recolours, never moves anything (`web/qa/appearance.mjs` checks).
  A new scheme: `themes/<name>.css` (imported in index.css), `themes/schemes.ts`, `themes/LICENSES.md`. Default Gruvbox
  (`DEFAULT_SCHEME` = core/bundles.ts' LOOK_DEFAULTS = index.html's first paint). Nothing named after another app.
- **Density**: sizes that follow it are spacing units (`h-6.5`, `space(n)`); px for text, icons, hairlines, radii.
  Compact stays pixel-identical (px / 4).
- Icon colours are opaque (`.text-tertiary` for fainter). Markdown is never raw: `snippet(md)` or `<Markdown>`.
- Desktop: the window never scrolls, each pane does (`scrollPage`, not `window.scrollTo`); page grids need
  `grid-cols-1`; dashboards lay out by pane width (`@2xl:`). 13px interface, 28px rows, 40px bars.
- Phones (mostly an iPhone): 44px targets, 17px text, `maximum-scale=1` in every viewport. PhoneHeader, PhoneDrawer
  (the desktop's panels), PhoneBar, the tab grid (TabSwitcher); no splits (a pane is a tab group). Move between places
  through `core/motion.ts`, not `history.back()` or `selectTab`, or the motion is lost. What a mouse finds on hover a finger
  swipes to (`SwipeRow`): a heading's buttons behind it, a row's as `SidebarRow`'s `swipe`.
- **A page of the sidebar's lists** (a blank tab, a panel's own tab) draws them at the sidebar's sizes (`SidebarRow`,
  `SidebarHeading`) inside `data-size-up` (index.css: a size up as one) and `.size-up-bleed`; never a phone variant of
  its own, or sizes and insets drift apart.
- UI text: sentence case, no emojis.

## Features
- **Tabs and splits** (core/workspace.ts, layout.ts, splits.ts, components/Workspace.tsx): panes are drawn flat, so
  splitting never remounts others; moving a tab isn't closing it. A pane keeps its last five tabs drawn but hidden
  (`data-kept`, not `data-pane`; a `full` view only while shown): look for the scroller as `[data-pane]` /
  `#main-scroll`, and take down what a file shows outside itself when its tab hides. A file opened from a page
  remembers it (`Tab.from`): Back past its first place closes it. Back closes an open sheet first.
- **Selecting several is one primitive** (`core/select.ts`, Finder's way): a list is `data-select-list`, rows
  `data-select-key`, and it registers what a selection can do (`useSelectable`); a row's click asks `selectClick` first
  (⌘ adds, ⇧ a run), its menu is `rowMenu`, its drag `selectionFor` (`paths` / `tabs`: a target that takes one takes
  several). One selection at a time; phones get `SelectionBar`. In a selectable list a new tab is the middle-click (⌘↵).
  Several at once is one toast with one Undo (`trashMany`, `moveManyInto`, a plugin's `many`). QA: `select.mjs`.
- **Dragging is one primitive** (`core/drag.ts`, pointer events, not dnd-kit or HTML5): `startDrag` +
  `useDropTarget`/`useDropHit`, first answer wins (`weak` last). Files from the computer are HTML5 drops. A finger
  drags only with `{ touch: true }`; answer touches with `haptic()`.
- **Speed** (`web/qa/perf.mjs`): state, socket and files on screen are asked for before React's first frame; rows read
  ahead on hover (`openingSoon`). Live: nothing while hidden, the store at most once a second, as a patch (unchanged
  slices keep their objects: key memos on them). Memoized rows get stable props. Per row: `dateText`/`numberText`, never
  `toLocale*String` with options; one `Intl.Collator`; index lookups. Heavy things near the screen (`useNearScreen`);
  theme colours read once per theme. Headless Chrome paints every ~40 ms whatever the page does: measure with CDP
  `Performance.getMetrics` (TaskDuration, RecalcStyleDuration) per frame, never ms per frame.
- **Text sizes** apart from the app's ⌘+/⌘- zoom (⌘+scroll sizes what's under the pointer): a plugin declares
  `textSizes`, its view uses `useTextSize` / `useTextSizeWheel` (`core/textsize.ts`), never a setting of its own.
- **Steadiness** (`web/qa/stability.mjs`): nothing moves the user didn't move. Remembered heights (`core/heights.ts`,
  cut while something inside is `aria-busy`), self-anchoring card pages (`core/anchor.ts`), places kept by line
  (`core/viewstate.ts`, `components/filePlace.ts`, cards' `data-line`). Traces in `window.__vauTrace`.
- **The desktop app's drag strip** (top 40px, `-webkit-app-region`) swallows clicks of anything over it without
  `no-drag`: a new overlay that can reach it needs a role or class the rule covers (`web/qa/dragstrip.mjs`).

## Running, tests and QA
- The app never shows a blank window: index.html says "Vaultite couldn't start" (or "stopped") with the error. Errors
  are queued for the Errors plugin (`core/errors.ts`), the console kept for `vau dev console` (core/dev.ts, main.tsx's
  first import); a vanished chunk reloads into the new build.
- UI QA: `node web/qa/<script>.mjs <base> [<vault path>]` (or `QA_BASE`), playwright-core on Playwright's Chromium (`CHROME` from qa.mjs; never
  launch /Applications/Google Chrome: a headless one left running hides the user's Chrome); shared
  setup is `web/qa/lib/qa.mjs`. Most scripts WRITE: throwaway servers only. Always `layout.mjs` after UI changes,
  `sheets.mjs` after sheet changes, `appearance.mjs` after styling, `scrollers.mjs` after a new scroller. `subjects.mjs` picks made-up subjects. Say when a
  phone-facing change is untested on a phone: desktop WebKit has missed iPhone-only layout bugs (a `flex-1` scroller
  in an auto-height box).
- In QA, a hash set by hand is undone about 0.7 s later by the workspace's tabs: load fresh (`about:blank`, then the
  address). A live page saves its tabs about 1 s after a change.
