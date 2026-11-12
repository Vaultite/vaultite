# Notes for `web/`

## How it's built
- State lives at one of three levels (`core/scope.ts`): the vault (settings files), a workspace (tabs, panels, pins)
  or the device. Would the user want it different for a different kind of work? Then it's the workspace's
  (`useScopedState(key, fallback, "workspace")`). The core reaches Workspaces only through scope.ts.
- App plugins load eagerly with the app (lazy loading doubled the phone's cold start), so a plugin's module uses no
  plugin API while it loads (`npm run check` lists what may run at top level).
- What the app starts with is a file per folder, each named by a key that lasts and mapped to its content's file by the
  page's import map (vite.config.ts `appGroups`, `stableChunks`), so a deploy re-downloads only what changed (`tools/perf/churn.ts`
  measures it; `startup.ts` counts the files): a heavy
  library only a view needs (CodeMirror, dnd-kit) comes through `import()`, never a plugin's top level.
- The app never shows a blank window: index.html shows the error.
- A new build reaches open pages within a second (`core/builds.ts`): offered with Reload; a hidden page, or one whose
  chunk vanished, reloads into it only when nothing would be lost (`core/unsaved.ts`). What a reload would cut registers there:
  `trackUnsaved` (an edit not saved), `trackUnderway` (a recording).

## UI conventions
- One sheet system: every detail view is `components/DetailSheet.tsx` via `openDetail(path)`; no other modals, sheets
  or bottom sheets (the first run's welcome card, components/Welcome.tsx, is the one card over the app). An unsaved form asks before closing (`useSheetGuard`).
- The app draws its own dialogs, tooltips and menus, never the browser's (`alert`, `confirm`, `prompt`, `title=`,
  context menu). Feedback: `notify()` / `notifyError()`, one line, one action at most, nothing on autosave.
- A tap shows its effect at once; the write catches up (`core/leaving.ts`). What it takes away folds off its list
  (`removals()`: the row's `data-leaving`), what it changes shows changed (`optimistic()` for the store, `useChosen`
  otherwise), and only what must wait says it's working (`useBusy`, `<Button busy>`). A failure puts it back and says so.
- An error never shows its exception's text (`e.message`, `String(e)`): `notifyError(e, "Couldn't …")` or
  `errorText(e, …)` say what failed and the reason a person can act on (`core/plainerror.ts`); a bug's text goes to
  Errors, behind Details or `ErrorDetails`. What can be undone acts and offers Undo; only the irreversible asks
  (`confirmDialog()`).
- Tooltips (`data-tip`) say only what can't be seen: an icon's name, a cut-off label, what a row shows as colour.
- Menus: `menuFor` / `menuBelow`. A held finger is the right-click (`watchHolds`), so a menu is always an
  `onContextMenu`. A plugin places a file menu item with its `section`, never by special-casing it. Show/hide lists are
  a `checklist()`.
- Every scroller is a stacking context (index.css, by its `overflow-*` class), or iOS draws sticky headings over its
  scroll indicator; a scroller made another way gets `isolate`. Overlays hold the page with `usePageLock`.
- On and off, named the Apple way, never "Toggle": a setting is a switch declared once (`core/switches.ts`; a plugin's:
  a boolean in its manifest's `settings`), named as Settings names it, and every surface follows it (Settings, its
  search, the palette, menus, the menu bar). What isn't a setting says what it does now (`on` + `nameWhenOn`: Show /
  Hide left sidebar). "Turn on" is only for plugins.
- A shortcut is a command (`core/commands.ts`), never a bare keydown listener; users rebind in `.vaultite/hotkeys.json`.
  Key names come from `keyHint` / `commandKeys(id)` and the platform from `isMac` (`core/platform.ts`), never typed in.
  A default key off a Mac avoids what Linux desktops take (Ctrl+Alt+arrows, Ctrl+.).
- Colours are tokens, never hex. A scheme only recolours, never moves anything; nothing is named after another app.
- Density: sizes that follow it are spacing units (`h-6.5`, `space(n)`); px for text, icons, hairlines, radii.
- Radii come in three (index.css): `rounded-card` (a pane), `rounded-control` (tabs, chips, fields), `rounded-chip`
  (set in a card's corner: concentric, the card's radius less its inset). New UI uses them, not a literal.
- Markdown is never shown raw: `snippet(md)` or `<Markdown>`.
- Chrome isn't text (index.css): only content selects (editors, fields, `<Markdown>`, `pre`/`code`); other text a person
  may copy opts in with `select-text`, a view inside content is `data-chrome`; chrome needs no `select-none`.
- Desktop: the window never scrolls, each pane does (`scrollPage`, not `window.scrollTo`); dashboards lay out by pane
  width (`@2xl:`).
- Phones: 44px targets, 17px text (the sidebar's lists 16px in 40px rows: `data-size-up`), no splits. Move between places through `core/motion.ts`, not `history.back()`. What
  a mouse finds on hover a finger swipes to (`SwipeRow`).
- A page of the sidebar's lists draws them at the sidebar's sizes (`SidebarRow`, `SidebarHeading`, `data-size-up`), with
  no phone variant of its own.

## Primitives
- Panes are drawn flat, so splitting never remounts others. A pane keeps its last tabs drawn but hidden (`data-kept`):
  find the scroller as `[data-pane]`, and take down what a file shows outside itself when its tab hides.
- Selecting several is `core/select.ts` (Finder's way); several at once is one toast with one Undo.
- Dragging is `core/drag.ts` (pointer events, not dnd-kit or HTML5; files from the computer are HTML5 drops, which a
  note takes anywhere in its place: `core/filedrop.ts`). A finger drags only with `{ touch: true }`.
- A list reordered by dragging makes way, as browser tabs do (`core/slide.ts`: `slotAt`, `reorder`, `useSlide`), never a
  drop line. A line only where a drop isn't a place in one list: a dashboard's grid (beside or below), table columns.
- Text sizes: a plugin declares `textSizes` and uses `useTextSize` (`core/textsize.ts`), never a setting of its own.
- Long lists (thousands of rows: the file tree) draw only what's near the screen: `useVirtual` (`core/virtual.ts`),
  with the rows the keyboard needs kept drawn, and the whole order given to `core/select.ts` (`listOrders`).
- Steadiness: nothing moves that the user didn't move (`core/heights.ts`, `core/anchor.ts`, `core/viewstate.ts`).
- Speed: live updates do nothing while hidden and patch the store at most once a second, unchanged slices keeping their
  objects (key memos on them). Per row: `dateText` / `numberText`, never `toLocale*String` with options; one
  `Intl.Collator`.
- The desktop app's drag strip (top 40px, `-webkit-app-region`) swallows clicks without `no-drag`: a new overlay that
  can reach it needs a role or class the rule covers.

## QA
- `npm run qa -- <script>...`: each on a sandbox copied from a shared template, with its setup, script and slot-wait
  time; run by hand (`node web/qa/<script>.mjs <base>`) one pays for its own sandbox, and most write, so only against a
  throwaway server. verify picks a script when its comments name a changed file: a script's header names the files
  it exercises (CONTRIBUTING.md). Run `layout.mjs`
  after UI changes, `sheets.mjs` after sheet changes, `appearance.mjs` after styling, `scrollers.mjs` after a new
  scroller.
- Counts that only go down: `counts.mjs` (components React renders per keystroke and per outside change, against
  `counts.json`) and `requests.mjs` (requests per flow, `requests.json`); after a win, run it with `--ratchet` and
  commit the lowered limits. `loading.mjs` fails on any shift
  in the sidebars or the status bar, however small: one scores a few thousandths, under any CLS limit.
- Scripts ask the app, not the clock (`web/qa/lib/app.mjs`): `idle()` after an action, `sees(file, write)` after a
  write to the vault, `menu`, `pane`, `toast`.
- QA is still (Reduce motion, desktop copies too): a script about motion says `qa(url, { motion: true })`. A desktop
  copy's pointer is `globalThis.qaPointer`, never the user's.
- `visual.mjs` holds the main screens against a machine's own pictures (OS and fonts draw text differently): one with
  none draws them and skips. A change meant to look different redraws this machine's (`--update`, by hand) and deletes
  the other machines' folders, which redraw on their next run.
- QA reads Vaultite/plugins at `tools/qa_plugins.json`'s commit (`node tools/qa_plugins.ts --bump` moves it).
- QA runs on Playwright's Chromium (`CHROME` in `web/qa/lib/qa.mjs`): a headless Google Chrome left running hides the
  user's Chrome.
- On Linux, `npm run qa` runs the desktop scripts on a virtual display of their own (xvfb-run); `SHOW=1`: on yours.
- Say when a phone-facing change is untested on a phone: desktop WebKit has missed iPhone-only layout bugs.
- Measure speed with CDP `Performance.getMetrics` per frame: headless Chrome paints every ~40 ms whatever the page does.
- A hash set by hand is undone about 0.7 s later by the workspace's tabs: load fresh (`about:blank`, then the address).
