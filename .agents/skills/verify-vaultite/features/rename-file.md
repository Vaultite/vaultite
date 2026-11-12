# Rename a file

A file renamed from the file tree's menu moves on disk, its open tab follows, and every link to it across the vault
is rewritten.

## Sub-features
- `rename-menu`: the tree's context menu, Rename, edits the name in place.
- `rename-links`: links and embeds to it name the new file.
- `rename-tab`: the tab showing it shows the new name.

## How to get to it (user POV)
- Right-click a file in the file tree, choose Rename, type, Enter.

## Driving it with vv
Preconditions:
- `vv doctor` ok; `Projects/Lighthouse.md` exists and `Notes/How this vault works.md` links to it.

- **Open it.** `vv open '#file/Projects%2FLighthouse.md'`.
- **Menu.** `vv click --sel "aside [data-tree-path='Projects/Lighthouse.md']" --right`. `vv aria --sel "[role=menu]"`
  lists `Rename`.
- **Rename.** `vv menu Rename`: a field `New name` has the keyboard with `Lighthouse`. `vv press ControlOrMeta+a`,
  `vv type Beacon`, `vv press Enter`.
- **On disk.** `vv vau files Projects`: `Projects/Beacon.md`, no `Projects/Lighthouse.md`.
- **Links.** `vv vau search Beacon`: `Notes/How this vault works.md` links `[[Beacon#Next]]`.
- **Tab.** `vv eval 'location.hash'` is `#file/Projects%2FBeacon.md`; `vv shot rename-file`.

## Gotchas
- Rename is a split row: its chevron opens a submenu; `vv menu Rename` chooses the row itself.
- The folder `Projects/Lighthouse/` keeps its name: only the note is renamed.
- Changes the sample: `vv down`, `vv up` after it.
