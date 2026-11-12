# Command palette

The palette finds any command by its name and runs it; commands show their shortcuts and settings their values.

## Sub-features
- `palette-open`: `ControlOrMeta+p` opens it with its field focused.
- `palette-find`: typing narrows the list, the best match selected.
- `palette-run`: Enter runs it.

## How to get to it (user POV)
- `ControlOrMeta+p` anywhere outside a terminal.

## Driving it with vv
Preconditions:
- `vv doctor` ok; a note open (`vv open '#file/Projects%2FLighthouse.md'`).

- **Open.** `vv press ControlOrMeta+p`. A dialog `Command palette` with a combobox `Select a command…`.
- **Find.** `vv type "Open new tab"`. `vv aria --sel "[role=dialog]" --out palette`: option `Open new tab` selected.
- **Run.** `vv press Enter`. `vv vau tabs`: a new tab, shown (`*`), its pane `new`.

## Gotchas
- With a terminal focused, Ctrl+P goes to the shell off a Mac: click out of it first.
- A query left unrun comes back selected next time: type replaces it.
