# Find notes

The quick switcher opens a file by its name or the words in it; search in a tab lists every matching line in the vault
and opens the file at the line.

## Sub-features
- `switcher-name`: typing a name selects it; Enter opens it.
- `switcher-in-files`: a word only in a file's text lists the file under In files, the word marked.
- `switcher-empty`: no match says `Nothing matches "<q>"` (Enter would make a note by that name).
- `search-tab`: the switcher's last row, or `ControlOrMeta+Shift+f`, opens search in a tab: In files, a button per line.
- `search-open-line`: a line's button opens the file with the caret on that line.
- `search-syntax`: an empty search tab lists the operators (`path:`, `file:`...).
- `search-match-case`: Match case is kept in the search plugin's settings.
- `sidebar-field`: the sidebar's Search field opens the switcher.

## How to get to it (user POV)
- `ControlOrMeta+o` anywhere outside a terminal, or the palette's Open quick switcher.
- `ControlOrMeta+Shift+f`, the palette's Open search in a tab, or the switcher's `Search for "<q>" in every file`.
- The sidebar's Search field (hidden in the sample: right-click a sidebar, More, Search field).

## Driving it with vv
Preconditions:
- `vv doctor` ok; the sample (`ME.md` has `Prefers concise answers.`, no note's name has `concise`).
- `S='[data-pane-frame][data-focused] [data-search-view]'`: the search tab on screen.

- **By name.** `vv press ControlOrMeta+o`. `vv aria --sel '[role=dialog][aria-label=Search]'`: combobox
  `Find or create a note…`, listbox `Recent files and pages`. `vv type Garden planner`; `vv eval 'document.querySelector("[role=dialog]
  [role=option][aria-selected=true]")?.textContent'` starts `Garden planner`. `vv press Enter`: the hash is
  `#file/Projects%2FGarden%20planner.md`.
- **By text.** `vv press ControlOrMeta+o`, `vv type concise`. `vv eval '[...document.querySelectorAll("[role=dialog]
  [role=group]")].map(g=>g.textContent.slice(0,60))'`: `In filesMEPrefers concise answers.`;
  `vv eval 'document.querySelector("[id=\"palette-text-ME.md\"] mark")?.textContent'` is `concise`. `vv shot switcher-in-files`.
- **Into a tab.** `vv click --sel '[id="palette-search-tab"]'`. `vv aria --sel "$S" --out search-tab`: textbox
  `Search the vault` holding `concise`, region `In files`, a button `Prefers concise answers.`.
- **Open the line.** `vv click --sel "$S [data-search-file='ME.md'] li button"`: the hash is `#file/ME.md`;
  `vv eval 'getSelection().anchorNode?.textContent'` is ` Prefers concise answers.`
- **Empty and nothing.** `vv press ControlOrMeta+Shift+f`, `vv click --sel "$S button[aria-label=Clear]"`:
  `$S section[aria-label="Search syntax"]` is there. `vv type zzqxv`: `$S`'s text has `Nothing matches "zzqxv".`
  `vv press ControlOrMeta+o`, `vv type zzqxv`: `vv eval 'document.querySelector("[data-no-matches]")?.textContent'`
  starts `Nothing matches`. `vv press Escape`.
- **Kept option.** `vv click --sel "$S button[aria-label='Match case']"`: `vv vau settings plugin/search` has
  `"matchCase": true`. Click it again: `{}`.
- **Sidebar field.** Setup: `vv vau panels show search`. `vv click --sel '[data-sidebar-search]'`: the `Search` dialog.
  `vv press Escape`, `vv vau panels hide search`.

## Gotchas
- Enter (or Shift+Enter) with no match makes a note by that name: leave with Escape.
- The switcher keeps its last query, selected as it opens: `vv type` replaces it.
- A search tab hidden behind another stays in the page (`[data-kept]`): `[data-search-view]` alone may be that one. Scope
  to the focused pane, as `$S` does.
- `ControlOrMeta+Shift+f` goes to an open search tab only if its query is empty: with a query it opens another tab.
- Notes in `Notes/` match their text as name rows, not under In files: hence `ME.md` and `concise`.
- One letter never lists In files. The text matches come about 150ms after the last key; `vv idle` covers it.
- The line opened is the caret's: the editor marks no active line, read `getSelection()`.
