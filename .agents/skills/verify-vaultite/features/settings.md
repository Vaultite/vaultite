# Settings

Settings is a page in a tab: a menu of sections, a search over every setting, and each switch kept in a file of
`.vaultite/`. Every switch is also a palette command, and Plugins is a section where each plugin has its switch.
Appearance's theme has its own file (`theme.md`).

## Sub-features
- `settings-open`: the sidebar's Settings, `Control+Comma`, the palette's Open Settings, `#settings`.
- `settings-menu`: Appearance, Editor, Files, Hotkeys, Terminal, About, AI, Share & sync, Plugins (`N on`), Get plugins.
- `settings-search`: Search settings finds a setting; picking it goes to its row, which flashes.
- `settings-switch`: an Editor switch is written to `.vaultite/editor.json`, only once changed; Reset removes it.
- `palette-switch`: the palette runs a switch by its name (a toast with Undo); `ControlOrMeta+Enter` opens its row.
- `plugin-switch`: a plugin's switch in Plugins turns it off; the palette's `Turn on <name>` back on.

## How to get to it (user POV)
- The gear (link `Settings`) at the bottom of the left sidebar, `Control+Comma`, or the palette's Open Settings.
- The palette: a setting's own name (`Spellcheck`), `Turn on <plugin>` / `Turn off <plugin>`.

## Driving it with vv
Preconditions:
- `vv doctor` ok; the sample has no `.vaultite/editor.json` and Random note on.
- `R='[data-settings-row=spellcheck] [role=switch]'`.

- **Open.** `vv open '#file/Start%20here.md'`, `vv click --role link --name Settings`: the hash is `#settings`.
  `vv aria --sel "[data-settings-list]"`: navigation `Settings`, its links from `Appearance` to `Get plugins`.
- **Key.** `vv open '#file/Projects%2FLighthouse.md'`, `vv click --sel "[data-tab-bar] [role=tab][aria-selected=true]"`,
  `vv press Control+Comma`: `#settings`.
- **Search.** `vv vau settings editor` is `{}`. `vv click --role searchbox --name "Search settings"`, `vv type spell`.
  `vv aria --sel "[data-settings-results]"`: listbox `Settings found`, option `Spellcheck` (`Editor`) with its switch.
  `vv click --sel '[data-settings-result="spellcheck"]'`: `vv eval 'document.querySelector("[data-settings-row=spellcheck]").classList.contains("reveal-flash")'`
  is `true`.
- **Switch.** `vv click --sel "$R"`: `vv eval "document.querySelector('$R').getAttribute('aria-checked')"` is `"false"`;
  `vv vau read .vaultite/editor.json` is `{"spellcheck": false}`. `vv shot settings-editor`.
- **In a note.** `vv open '#file/Projects%2FLighthouse.md'`: `vv eval 'document.querySelector("[data-pane-frame][data-focused]
  .cm-content").getAttribute("spellcheck")'` is `"false"`.
- **Palette.** `vv press ControlOrMeta+p`, `vv type Spellcheck`: option `Spellcheck Editor Off`. `vv press Enter`: a
  toast `Spellcheck: on` with `Undo`; editor.json `{"spellcheck": true}`.
- **Its row.** Palette, `vv type "Readable line length"`, `vv press ControlOrMeta+Enter`: `#settings`, its row
  `.reveal-flash`; editor.json unchanged.
- **Reset.** `vv click --role button --name "Reset spellcheck"`: `vv vau settings editor` is `{}`.
- **Plugin off.** `vv click --sel '[data-settings-nav="plugins"]'`, `vv click --role switch --name "Random note plugin"`:
  `vv vau plugins | grep random-note` starts `off`. `vv shot plugins-off`.
- **Plugin on.** Palette, `vv type "turn on random"`: option `Turn on Random note` under `Plugins that are off`.
  `vv press Enter`: toast `Random note is on`; `vv vau plugins | grep random-note` starts `on`.

## Gotchas
- While a search is typed the result has its own switch named as the row's: use `$R`, never `--role switch --name
  Spellcheck`. The search's results take the menu's place till the field is cleared.
- Rows with a preview (Readable line length, Line numbers) draw a card over the next row on hover: Spellcheck has none.
- Turning a plugin back on puts it at the end of `.vaultite/plugins.json`'s `enabled`: the file differs from the sample.
- Desktop-only rows (Permissions, Updates, Open at login, Interface size) aren't in the browser.
