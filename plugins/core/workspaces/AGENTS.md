## Workspaces
Up to five workspaces, numbered 1 to 5 (like a tiling window manager's), each a desk: its tabs and splits, its
sidebars' panels, its pinned pages, and what the app keeps for it (the file tree's open folders, files opened lately).
The vault (files, settings, the default panels and pinned pages) and running terminals are shared; switching never
changes them. Which one is current is each device's own (a new device is on the first in use, else 1); `vau context`
says which the user's window is on. ⌃1 to ⌃5 switch (⌥1 to ⌥5 off a Mac), as does a two-finger swipe over a
sidebar.

What the user sets of each is its own file, `.vaultite/plugins/workspaces/<n>.json` (none: nothing set); what's open in
it (`layout`, `state`) is kept by the server, not in the vault (shared with the other machines, live: `vau kept
workspaces/`). `GET /api/workspaces` (and `vau workspace list --json`) has both together; `PUT /api/workspaces/<n>`
changes either. `1.json`:
```
{"name": "Writing", "sidebars": {"left": ["search:search", "files:files"], "right": [], "collapsed": []},
 "pinned": ["Dashboards/People.md", "Notes/Draft.md"]}
```
and what's kept with it, `{"layout": {"tabs": [{"id": "t1", "root": {"id": "p1", "to": "file:Notes/Idea.md"}, "focus":
"p1"}], "active": "t1"}, "state": {"files:open": ["Notes"]}}`. A `layout` or `state` written into the file (by
hand, or by an older app) is taken in and leaves the file.
- `name`: optional (the number's tooltip).
- `icon`, `tint`, `container`: optional: an icon (a Lucide name or an emoji) shown for its number, in
  its tint (blue, orange, green, red, purple, pink, yellow, teal, indigo, gray), which the sidebars take a little of;
  the Browser container (its id) its web pages open in when neither the page nor its site picks one.
- `sidebars`: shaped like `.vaultite/sidebars.json`; left out, it shows that file's (also what new workspaces start
  with). `vau panels` changes the current workspace's (`--workspace <n>` another's, `--vault` sidebars.json).
- `pinned`: its pinned pages; left out, `.vaultite/pages.json`'s. The first pin or unpin in it copies that list. One
  change at a time: `POST /api/workspaces/<n>/pins {path, pinned, before}` or `vau pin` / `vau unpin` (the user's
  window's; `--workspace <n>`, `--vault`); `POST /api/workspaces/<n>/pins/default` makes its list pages.json's.
- `state`: what the app and plugins keep per workspace (`files:open`, `core:recent`), merged key by key on PUT. Leave
  it to the app.
- `layout`: `tabs` in order, each `{id, root, focus}`: `root` is a pane `{id, to}` or a split `{id, dir: row | col, kids,
  sizes}` of panes (a split tab; a split's pane's own tabs are its `stack` and `stackAt`: `vau docs tabs`), `focus` its focused pane; tab groups are `groups` and each tab's `group`, a tab's
  `name` is the user's (`vau docs tabs`); `windows`: pop-out windows, each `{id, tabs, groups, active}`. A pane's
  `to` is `file:<vault path>`, `view:folder/<vault path>` (a folder's page), `view:terminal/<session id>`, a panel as a
  tab (`view:files`, `view:terminals`, `view:pages`, `view:search/<query>`, `view:links`, `view:local-graph`) or `new`
  (blank); left out, one blank tab.
  `active`, each tab's `focus` and `zoom` are only where a device starts. With the Machines plugin on, a terminal pane is saved as
  `view:terminal/<id>@<machine>` so every machine opens that shell; write a new one as `view:terminal/<id>` (this
  machine's) or with `@<machine>`.
- A slot with no `name`, look, `pinned` or own `sidebars` and only one blank tab is unused (`state` alone doesn't count): its
  number is faint and it's never kept. To make a workspace, write tabs, panels, pins or a name; to delete one, set its
  slot to null (`DELETE /api/workspaces/<n>`).
- Pins and tabs follow a file moved through the API. A terminal any workspace shows keeps running.
- Turned on, a device's own tabs (without Workspaces) are set aside, not changed, and come back when it's turned off;
  an unused workspace takes the tabs on screen of the window that turned it on.

**Moving tabs** between workspaces: `POST /api/workspaces/move` with `{"from": 1, "to": 2, "tab": "<tab id>"}` (a tab,
all its panes), `{"to": 2, "pane": "<pane id>"}` or `{"to": 2, "path": "Notes/Idea.md"}` (a pane, out of its split), or
`{"to": 2, "open": ["Notes/Idea.md"]}` (opens files there). From a terminal: `vau workspace tabs`, `vau workspace move
<file|tab or pane id> <n> [--from <m>] [--whole]`, `vau workspace open <file> <n>`, `vau workspace close`. What moves
leaves as closing would and lands at the end of the target's tabs; nothing ends, a terminal keeps its shell.
