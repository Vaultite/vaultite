## Tabs
A window has one list of tabs; a tab holds one pane or several side by side (a split tab: a free tree of splits, plus
floating panes), each pane one view with its own history. Clicking another tab switches the whole split away; opening
a file or link goes to the focused pane. ⌥-click a tab, or drop it on a pane's middle: it takes that pane's place, and
what was there becomes a tab of its own; drop it on a pane's edge: a split. The tab on screen dropped on its own pane's
edge splits off there, the tab shown before it on the other side (out of the list; with none, a blank pane), the split
keeping the dragged tab's id, group, pin and name. ⌘W (Close current tab) in a split closes the
focused pane, the tab with its last; Close split (⌥⇧⌘W, or the tab's menu) closes every pane. A pane dragged onto the list (or a half
dragged out of a split's row) is a tab of its own; held a second over a row, that tab opens to drop into. Ids are
stable: a tab's (`t…`) and a pane's (`p…`, or a `t…` one from before tabs held panes).

**A split's panes have tabs of their own**, as a browser window's: in a split, what opens as a new tab (⌘T, a link
⌘-clicked, a page's new window, a tab ⌥-clicked or dropped on a pane's middle, a file dropped there) opens among the
focused (or that) pane's own tabs, shown, what it showed staying open behind it; a pane that keeps its view (a
terminal) opens its new tabs in the list, as the list's New tab row and a tab bar's + always do, and agents' tabs go
there too. ⌘W closes the place a pane shows, its next showing (the pane goes with its last); Close pane (the palette, a
pane's menu) closes it with all of them. ⌃Tab and ⇧⌘] go through the focused pane's tabs, then on to the next tab. While
the split is on screen and a pane has more than one, the Tabs panel lists each pane's under its row, headed by where it
sits: a click shows one, its X closes it, a drag moves it along its pane's list, into another's, onto a pane (an edge
splits it off, its own pane's too while that has others) or out to the list as a tab of its own, and a list's tab
dropped on a pane's list joins it; another tab on screen, the row is its map again, each cell saying how many more its
pane has (+2). With Pane tab bars (appearance `paneTabBars`, on by default; the tab bar on or off), every pane of a
split has a strip of its tabs on top, one too, its + opening one among them (a terminal's too: asked for there; none for
a pinned tab's pane, whose new tabs go to the list); a tab dropped on a strip joins it. Off, a pane starts with what it
shows (a note's bar its title row, with the pane's X and menu), and a tab dragged over a pane brings its strip back over
it to drop into; in the tab bar, a split's cell says how many more tabs its pane has (+2: a click lists them, each shown
by a click, its menu beside it; shown while no strip shows them), and right-clicking a cell is its pane's menu, the
tab's under Tab, as the panel's map. A split closed down to one pane has its tabs as tabs of the list. Kept as each pane's `stack` (its
other places, each a pane of its own, in order) and `stackAt` (where the one it shows sits among them):
```
{"id": "t2", "focus": "p3", "root": {"id": "s1", "dir": "row", "sizes": [0.5, 0.5], "kids": [{"id": "p2", "to": "file:Notes/b.md"},
  {"id": "p3", "to": "view:web/https://example.com/", "stack": [{"id": "p4", "to": "file:Notes/c.md"}], "stackAt": 1}]}}
```
`vau tabs` lists them after their pane (`behind` it); focus, move (`--into <pane> --side center` joins its tabs, `--at`
takes one out to the list) and closing on a device act on them by id.

The Tabs panel lists the open tabs (a split tab one row, its panes drawn in the shape of its split), so the tab bar can
be off: vertical tabs. In a split's row every cell is a pane (lit under the pointer: a press drags that pane, its X
closes it, a right-click is its menu, the tab's under Tab); the whole tab is the … at the row's end, past the map, where
a tab's row has its … (its slot kept, so the map never moves): a click opens the tab's menu, a press drags the tab. One
switch moves the tabs between the two (the palette's Show tabs in the sidebar / Show tabs on top, or right-click the tab bar or the panel): in
the sidebar, appearance `tabBar` is false and `tabs:tabs` is at the top of the left sidebar (sidebars.json, or the
workspace's `sidebars`); on top, `tabBar` is true and the panel is hidden. The tabs end in a New tab row: a new tab at
the end of the list, in its place (double-clicking under the list too, and a tab bar's +; ⌘T opens one beside
the active tab). Under them, what the user's other devices have open (`other_devices`: those open now or used this
week), one per app or browser (`label`: the user's name for it), kept by the server, not in the vault (`vau kept
tabs/`): every machine serving the vault has every device's, live. A browser driven by automation isn't a device.

**Search tabs** (⌘⇧A, the command `tab:search`, or the panel's menu): the window's tabs in the palette, the one focused
last first, found by name, address or tab group; then the tabs closed lately and the archived ones, to reopen. ⌘⌫ closes
the selected tab.

**Reopen closed tab** (⌘⇧T, `tab:reopen`; on a phone, the tab list's menu, Recently closed) brings back what closed last
in this workspace, as it was: what closed together comes back together (Close others, a tab group, a pop-out window),
each tab in its place with its group; a split's pane goes back where it sat, at its size. Tabs a layout or another
device takes away that are open nowhere else are remembered the same way. Kept on this device (its windows share it).

**Devices** (`vau tabs devices`; the Devices view, also in Machines): each one, open now or when it was last used, with
its tabs. Which are open isn't kept in a file: each server knows its own windows, and asks the other machines for theirs.
`vau tabs device-close <device> [tabs...]` closes tabs on one that's open now (all of them without tabs).

**Archived tabs**: with `archive_after` (never, 12h, 24h, 7d, 30d), an unpinned tab off screen that long
closes into Archived tabs (`view:archived-tabs`, the quick switcher, `vau tabs archived`, ⌘⇧T as for a tab closed
then), unless closing it loses
something (a terminal, unsaved edits, a page playing sound or holding typed input not sent). The Tabs panel ends with
an Archived tabs row, how many, while there are any. Kept with the tabs (the workspace's
`state["core:archived-tabs"]`, or this device's); a tab's `seen` is when it was last on screen (ms).

**Tab groups**, as in a browser: a named, coloured run of tabs, side by side, that folds to its name. In the
tab bar a group is a solid chip of its colour before its tabs, which are underlined in it; in the panel, the same chip
on a row, its tabs set in beside a line in its colour hanging from it. A click folds it (its tabs shrink into the chip);
its … in the panel or a right-click opens its editor, as a browser's: its name and a row of colours, each change shown
at once, then New tab in group, Ungroup and Close group. A new group opens it. They're kept with the tabs (this device's, or the workspace's with Workspaces: the list's `groups`, each tab's
`group`):
```
{"active": "t2", "groups": [{"id": "g1", "name": "Lighthouse", "color": "teal", "collapsed": false}],
 "tabs": [{"id": "t1", "group": "g1", "root": {"id": "p1", "to": "file:Notes/a.md"}, "focus": "p1"},
  {"id": "t2", "group": "g1", "focus": "p3", "root": {"id": "s1", "dir": "row", "sizes": [0.5, 0.5],
   "kids": [{"id": "p2", "to": "file:Notes/b.md"}, {"id": "p3", "to": "view:terminal/k3j2h1g0"}]}}]}
```
`color` is one of blue, orange, green, red, purple, pink, yellow, teal, indigo, gray (the containers' palette); an
empty `name` is allowed (the chip is just its colour). A group's tabs are always together; one with no tabs left is
gone, and the tab on screen is never in a folded group (showing one opens it).

**Names**: Rename tab… (the palette, or a tab's right-click) names what the tab shows: a file is renamed (links follow),
a terminal's session is named (terminal.rename), and anything else (a web page, a view) keeps the name on the tab, its
`name` (`{"id": "t4", "to": "view:web/…", "name": "Docs"}`), shown in place of its title wherever it's drawn. An empty name
gives back the automatic one. Rename tab group… and Add current tab to group… (a group there is, or a new one named as
typed) do the same for groups.

Change them in the user's window with `vau tabs` (tabs.list: its tabs, their panes, groups and pop-outs), `vau tabs
split <pane> [--side] [--to]`, `vau tabs move <tab|pane> --into <pane> [--side left|right|top|bottom|center]` or `--at
<n>`, `vau tabs swap <pane> <pane>`, `vau tabs focus <tab|pane>`, `vau tabs group <tabs...> --name --color` (or
`--group <id>` to add to one or rename, recolour or fold it with `--collapsed`) and `vau tabs ungroup`. Tabs and panes
are named by id, by what a pane shows, or by a file's path or name. `vau workspace tabs` lists every workspace's.
A plugin follows changes with `onTabsEvent` (tab and pane focused, opened, closed, moved; a pane showing another place).
