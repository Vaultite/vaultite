# Notes for `web/`

## How it's built
- State lives at one of three levels (`core/scope.ts`): the vault (settings files), a workspace (tabs, panels, pins)
  or the device. Would the user want it different for a different kind of work? Then it's the workspace's
  (`useScopedState(key, fallback, "workspace")`). The core reaches Workspaces only through scope.ts.
- App plugins load eagerly with the app (lazy loading doubled the phone's cold start), so a plugin's module uses no
  plugin API while it loads (`npm run check` lists what may run at top level).
- The app never shows a blank window: index.html shows the error. A vanished chunk reloads into the new build only when
  nothing would be lost (`core/unsaved.ts`).

## UI conventions
- One sheet system: every detail view is `components/DetailSheet.tsx` via `openDetail(path)`; no other modals, sheets
  or bottom sheets. An unsaved form asks before closing (`useSheetGuard`).
- The app draws its own dialogs, tooltips and menus, never the browser's (`alert`, `confirm`, `prompt`, `title=`,
  context menu). Feedback: `notify()` / `notifyError()`, one line, one action at most, nothing on autosave. What can be
  undone acts and offers Undo; only the irreversible asks (`confirmDialog()`).
- Tooltips (`data-tip`) say only what can't be seen: an icon's name, a cut-off label, what a row shows as colour.
- Menus: `menuFor` / `menuBelow`. A held finger is the right-click (`watchHolds`), so a menu is always an
  `onContextMenu`. A plugin places a file menu item with its `section`, never by special-casing it. Show/hide lists are
  a `checklist()`.
- Every scroller is a stacking context (index.css, by its `overflow-*` class), or iOS draws sticky headings over its
  scroll indicator; a scroller made another way gets `isolate`. Overlays hold the page with `usePageLock`.
- A shortcut is a command (`core/commands.ts`), never a bare keydown listener; users rebind in `.vaultite/hotkeys.json`.
  Key names come from `keyHint` / `commandKeys(id)` and the platform from `isMac` (`core/platform.ts`), never typed in.
  A default key off a Mac avoids what Linux desktops take (Ctrl+Alt+arrows, Ctrl+.).
- Colours are tokens, never hex. A scheme only recolours, never moves anything; nothing is named after another app.
- Density: sizes that follow it are spacing units (`h-6.5`, `space(n)`); px for text, icons, hairlines, radii.
- Markdown is never shown raw: `snippet(md)` or `<Markdown>`.
- Desktop: the window never scrolls, each pane does (`scrollPage`, not `window.scrollTo`); dashboards lay out by pane
  width (`@2xl:`).
- Phones: 44px targets, 17px text, no splits. Move between places through `core/motion.ts`, not `history.back()`. What
  a mouse finds on hover a finger swipes to (`SwipeRow`).
- A page of the sidebar's lists draws them at the sidebar's sizes (`SidebarRow`, `SidebarHeading`, `data-size-up`), with
  no phone variant of its own.

## Primitives
- Panes are drawn flat, so splitting never remounts others. A pane keeps its last tabs drawn but hidden (`data-kept`):
  find the scroller as `[data-pane]`, and take down what a file shows outside itself when its tab hides.
- Selecting several is `core/select.ts` (Finder's way); several at once is one toast with one Undo.
- Dragging is `core/drag.ts` (pointer events, not dnd-kit or HTML5; files from the computer are HTML5 drops). A finger
  drags only with `{ touch: true }`.
- Text sizes: a plugin declares `textSizes` and uses `useTextSize` (`core/textsize.ts`), never a setting of its own.
- Steadiness: nothing moves that the user didn't move (`core/heights.ts`, `core/anchor.ts`, `core/viewstate.ts`).
- Speed: live updates do nothing while hidden and patch the store at most once a second, unchanged slices keeping their
  objects (key memos on them). Per row: `dateText` / `numberText`, never `toLocale*String` with options; one
  `Intl.Collator`.
- The desktop app's drag strip (top 40px, `-webkit-app-region`) swallows clicks without `no-drag`: a new overlay that
  can reach it needs a role or class the rule covers.

## QA
- `node web/qa/<script>.mjs <base>`: most write, so only against a throwaway server (each header says). Run `layout.mjs`
  after UI changes, `sheets.mjs` after sheet changes, `appearance.mjs` after styling, `scrollers.mjs` after a new
  scroller.
- Counts that only go down: `counts.mjs` (components React renders per keystroke and per outside change, against
  `counts.json`); after a win, run it with `--ratchet` and commit the lowered limits. `loading.mjs` fails on any shift
  in the sidebars or the status bar, however small: one scores a few thousandths, under any CLS limit.
- QA runs on Playwright's Chromium (`CHROME` in qa.mjs): a headless Google Chrome left running hides the user's Chrome.
- Say when a phone-facing change is untested on a phone: desktop WebKit has missed iPhone-only layout bugs.
- Measure speed with CDP `Performance.getMetrics` per frame: headless Chrome paints every ~40 ms whatever the page does.
- A hash set by hand is undone about 0.7 s later by the workspace's tabs: load fresh (`about:blank`, then the address).
