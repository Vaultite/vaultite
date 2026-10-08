## Workspaces
Up to five workspaces, numbered 1 to 5 (like a tiling window manager's), each a desk: its tabs and splits, its
sidebars' panels, its pinned pages, and what the app keeps for it (the file tree's open folders, files opened lately).
The vault (files, settings, the default panels and pinned pages) and running terminals are shared; switching never
changes them. Which one is current is each device's own (a new device is on the first in use, else 1); `vau context`
says which the user's window is on. ⌃1 to ⌃5 switch (⌥1 to ⌥5 off a Mac).

Each is its own file, `.vaultite/plugins/workspaces/<n>.json` (none: unused), so devices on different workspaces never
write the same file. `1.json`:
```
{"name": "Writing", "sidebars": {"left": ["search:search", "files:files"], "right": [], "collapsed": []},
 "layout": {"root": {"id": "g0", "tabs": [{"id": "t1", "to": "file:Notes/Idea.md"}], "active": "t1"}, "focus": "g0"},
 "pinned": ["Dashboards/Today.md", "Notes/Draft.md"], "state": {"files:open": ["Notes"]}}
```
- `name`: optional (the number's tooltip).
- `sidebars`: shaped like `.vaultite/sidebars.json`; left out, it shows that file's (also what new workspaces start
  with). `vau panels` changes the current workspace's (`--workspace <n>` another's, `--vault` sidebars.json).
- `pinned`: its pinned pages; left out, `.vaultite/pages.json`'s. The first pin or unpin in it copies that list. One
  change at a time: `POST /api/workspaces/<n>/pins {path, pinned, before}` or `vau pin` / `vau unpin` (the user's
  window's; `--workspace <n>`, `--vault`); `POST /api/workspaces/<n>/pins/default` makes its list pages.json's.
- `state`: what the app and plugins keep per workspace (`files:open`, `core:recent`), merged key by key on PUT. Leave
  it to the app.
- `layout`: `root` is a group `{id, tabs: [{id, to}], active}` or a split `{id, dir: row | col, kids, sizes}`. A tab's
  `to` is `file:<vault path>`, `view:terminal/<session id>`, a panel as a tab (`view:files`, `view:terminals`,
  `view:pages`, `view:search/<query>`, `view:links`, `view:local-graph`) or `new` (blank); left out, one blank tab.
  `active` and `focus` are only where a device starts. With the Machines plugin on, a terminal tab is saved as
  `view:terminal/<id>@<machine>` so every machine opens that shell; write a new one as `view:terminal/<id>` (this
  machine's) or with `@<machine>`.
- A slot with no `name`, `pinned` or own `sidebars` and only one blank tab is unused (`state` alone doesn't count): its
  number is faint and it's never kept. To make a workspace, write tabs, panels, pins or a name; to delete one, set its
  slot to null (`DELETE /api/workspaces/<n>`).
- Pins and tabs follow a file moved through the API. A terminal a workspace shows keeps running (a plain shell no tab
  shows ends after 12 hours at its prompt).

**Moving tabs** between workspaces: `POST /api/workspaces/move` with `{"from": 1, "to": 2, "tab": "<tab id>"}` or
`{"to": 2, "path": "Notes/Idea.md"}` (one tab), `{"from": 1, "to": 2, "group": "<group id>"}` (a whole pane), or
`{"to": 2, "open": ["Notes/Idea.md"]}` (opens files there). From a terminal: `vau workspace tabs`, `vau workspace move
<file|tab id> <n> [--from <m>] [--pane]`, `vau workspace open <file> <n>`, `vau workspace close`. What moves leaves as
closing would and lands at the end of the target's last focused pane; nothing ends, a terminal keeps its shell.
