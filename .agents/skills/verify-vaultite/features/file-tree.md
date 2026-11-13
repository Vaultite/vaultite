# File tree

The Files panel in the left sidebar lists the vault's folders and files. A folder opens and closes with a click; the
heading's buttons and a row's menu make notes and folders; a file moves by dragging it onto a folder or with Move file
to…; Delete sends it to the trash at once, with Undo on the toast.

## Sub-features
- `tree-fold`: a click or ArrowRight / ArrowLeft opens and closes a folder.
- `tree-new-folder`: New folder names a folder `New folder` in place, the name selected.
- `tree-new-note`: the heading's New note makes `Untitled.md` at the vault's top; a folder's menu, New note, in it, its
  File name field focused.
- `tree-move-drag`: a file dropped on a folder moves there; toast `Moved to <folder>` with Undo.
- `tree-move-menu`: Move file to… picks a folder by typing.
- `tree-delete`: the menu's Delete or the Delete key: toast `Moved <name> to trash` with Undo, which puts it back.

## How to get to it (user POV)
- The Files heading's buttons: New note, New folder, Change sort order, Collapse all.
- Right-click a row (or its `More for <name>`): New note, New folder, Rename, Move file to…, Delete.
- Drag a row onto a folder; with a row focused, Delete.

## Driving it with vv
Preconditions:
- `vv doctor` ok; the sample, `Notes/` open and `People/` closed.

- **Fold.** `vv open`, `vv aria --sel "aside [role=tree][aria-label=Files]" --out tree0`. `vv click --sel "aside
  [data-tree-path='People'] [role=treeitem]"`: `vv eval 'document.querySelector("aside [data-tree-path=\"People\"]
  [role=treeitem]").ariaExpanded'` is `"true"`. `vv press ArrowLeft`: `"false"`.
- **New folder.** `vv click --sel "aside button[aria-label='New folder']"`: `vv eval
  '[document.activeElement.getAttribute("aria-label"), document.activeElement.value]'` is `["New name", "New folder"]`.
  `vv type Trips`, `vv press Enter`: `vv eval 'fetch("api/files").then(r=>r.json()).then(j=>j.folders.includes("Trips"))'`
  is `true`.
- **Note in it.** `vv click --sel "aside [data-tree-path='Trips']" --right`, `vv menu "New note"`: the hash is
  `#file/Trips%2FUntitled.md`, the keyboard in `File name`. `vv press ControlOrMeta+a`, `vv type Packing list`,
  `vv press Enter`: `vv vau files Trips` lists `Trips/Packing list.md`.
- **New note at the top.** `vv click --sel "aside button[aria-label='New note']"`: the hash is `#file/Untitled.md`.
- **Drag.** `vv drag --sel "aside [data-tree-path='Notes/Lisbon trip.md']" --to-sel "aside [data-tree-path='Trips']"`:
  a toast `Moved to Trips` with `Undo` (`vv eval '[...document.querySelectorAll("[data-sonner-toast]")].map(t=>t.innerText)'`);
  `vv vau files Trips` lists `Trips/Lisbon trip.md`, `Notes` no longer.
- **Move to.** `vv click --sel "aside [data-tree-path='Trips/Lisbon trip.md']" --right`, `vv menu "Move file to…"`:
  `vv aria --sel "[role=dialog][aria-label='Move to folder']"`, `/ Vault root` first. `vv type Notes`: `Notes`
  selected, before `Notes/Books`. `vv press Enter`: `vv vau files Notes` lists it again.
- **Delete, Undo.** `vv click --sel "aside [data-tree-path='Trips/Packing list.md']" --right`, `vv menu Delete`: toast
  `Moved Packing list to trash`; the file is under `.trash/Trips/` in the vault folder. At once `vv click --sel
  "[data-sonner-toast] [data-button]"`: `vv vau files Trips` lists it again. `vv shot tree-end`.
- **Delete key.** `vv click` the row of a file already shown, `vv press Delete`: the same toast.

## Gotchas
- `vv vau files` lists neither empty folders nor `.trash`: check those in `api/files` or the vault folder `vv up` printed.
- The toasts' Undo lasts 8 s: click it as the next command, not after a shot.
- `Move file to…` ends in the one character `…`: `vv menu` needs it.
- `New note` names more than the heading's button: scope it, `aside button[aria-label='New note']`.
- A click on a file not shown opens it, and a just-made note takes the keyboard to its File name: the Delete key needs
  the row to keep it (click a shown file's row).
- Opening a file opens the folders above it: a folder checked closed can open again.
- Changes the sample: `vv down`, `vv up` after it.
