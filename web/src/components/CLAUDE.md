# Notes for `web/src/components/`

## How it's built
- **Settings are the app's; a plugin's options are its settings sheet.** The Settings page holds only the app's own
  (Setup, Appearance, Hotkeys, the vault); its search also finds every plugin's settings, opening its sheet there. A
  plugin's sheet (`PluginSettings.tsx`, `openPluginSettings`): its `settingsPanel`, then a form of its manifest's
  `settings` (`PATCH /api/config/plugin/<id>`, one key), else its data.json as JSON. No menus inside a sheet: choices
  unfold in place. QA: `web/qa/pluginsettings.mjs`.

## Features
- **A part that fails, fails alone** (`Guard.tsx`): every tab, panel, header item and sheet draws in a `Guard`, its
  plugin's `render` inside it (`Drawn`); smaller parts use `Catch`. A chunk that didn't load is errors.ts'
  `recoverFromStaleBuild`. QA: `web/qa/crashguard.mjs`.
- **Files a plugin draws** (`formats`, `FormatView.tsx`): the text is the only state, `onChange(text)` goes through
  autosave. A double extension beats `md`. `layout: "pane"` (a canvas, a drawing) fills the pane edge to edge
  (FileView's `PaneFile`). Canvas (`plugins/core/canvas/`): `Board.tsx` never draws React for a pan or zoom (the view
  lives in a ref; `--k` and the zoom label change only with the zoom). Neither Canvas nor Excalidraw writes on pan or
  zoom; Excalidraw's fonts come through its route, never esm.sh.
- **Sidebar** (`Sidebar.tsx`): only plugins' panels, in two sidebars, one model (`core/sidebars.ts`, shared with the
  CLI and Workspaces) saved whole in `.vaultite/sidebars.json` (default while unset). Where the setup comes from is
  `sidebars()` / `setSidebars()` (web/src/core/plugins.ts: Workspaces may answer). No tabs inside a sidebar: a panel that
  wants room opens as a view. A drop only reorders (`placePanel`).
  - Scrolling (`sidebarScroll`): `panels` (default) gives each panel its own box laid out by `usePanelLayout` /
    `fitPanels` (never taller than what it draws, a `tall` one keeps half), with dividers between (`dragPanels`);
    `sidebar` makes the whole sidebar one scroller. Heights go straight onto the boxes, no React render.
  - **Only a bounded box scrolls**: `overflow-y-auto overscroll-contain` on a box nothing bounds swallows the wheel.
    A component that may be either takes a prop (FileTree's `scroll`, a panel's `bounded`). QA: `paneltabs.mjs`,
    `sidebarstack.mjs`.
  - Folding is `PanelFold` (`[data-collapsed]`); right-click is `panelMenu(key, side)` (a `checklist`).
