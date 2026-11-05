## Tabs
A window has one list of tabs; a tab holds one pane or several side by side (a split tab: a free tree of splits, plus
floating panes), each pane one view with its own history. Clicking another tab switches the whole split away; opening
a file or link goes to the focused pane. ⌥-click a tab, or drop it on a pane's middle: it takes that pane's place, and
what was there becomes a tab of its own; drop it on a pane's edge: a split. ⌘W (Close current tab) in a split closes the
focused pane, the tab with its last; Close split (⌥⇧⌘W, or the tab's menu) closes every pane. A pane dragged onto the list (or a half
dragged out of a split's row) is a tab of its own; held a second over a row, that tab opens to drop into. Ids are
stable: a tab's (`t…`) and a pane's (`p…`, or a `t…` one from before tabs held panes).

The Tabs panel lists the open tabs (a split tab one row, its panes drawn in the shape of its split), so the tab bar can be off: vertical tabs. One switch moves the tabs
between the two (the palette's Show tabs in the sidebar / Show tabs on top, or right-click the tab bar or the panel): in
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
