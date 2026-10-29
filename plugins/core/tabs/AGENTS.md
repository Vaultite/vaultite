## Tabs
The Tabs panel lists the open tabs pane by pane, so the tab bar can be off: vertical tabs. One switch moves the tabs
between the two (the palette's Show tabs in the sidebar / Show tabs on top, or right-click the tab bar or the panel): in
the sidebar, appearance `tabBar` is false and `tabs:tabs` is at the top of the left sidebar (sidebars.json, or the
workspace's `sidebars`); on top, `tabBar` is true and the panel is hidden. The tabs end in a New tab row: a new tab at
the end of the focused pane, in its place (double-clicking under the list too, and a tab bar's +; ⌘T opens one beside
the active tab). Under them, what the user's other devices have open (`other_devices`: those open now or used this
week), from `.vaultite/plugins/tabs/device-<id>.json`, one per app or browser (`label`: the user's name for it). A
browser driven by automation isn't a device.

**Devices** (`vau tabs devices`; the Devices view, also in Machines): each one, open now or when it was last used, with
its tabs. Which are open isn't kept in a file: each server knows its own windows, and asks the other machines for theirs.
`vau tabs device-close <device> [tabs...]` closes tabs on one that's open now (all of them without tabs).

**Archived tabs**: with `archive_after` (never, 12h, 24h, 7d, 30d), an unpinned tab off screen that long
closes into Archived tabs (`view:archived-tabs`, the quick switcher, `vau tabs archived`, ⌘⇧T as for a tab closed
then), unless closing it loses
something (a terminal, unsaved edits, a page playing sound or holding typed input not sent). The Tabs panel ends with
an Archived tabs row, how many, while there are any. Kept with the tabs (the workspace's
`state["core:archived-tabs"]`, or this device's); a tab's `seen` is when it was last on screen (ms).

**Tab groups**, as in a browser: a named, coloured run of a pane's tabs, side by side, that folds to its name. In the
tab bar a group is a solid chip of its colour before its tabs, which are underlined in it; in the panel, the same chip
on a row, its tabs set in beside a line in its colour hanging from it. A click folds it (its tabs shrink into the chip);
its … in the panel or a right-click opens its editor, as a browser's: its name and a row of colours, each change shown
at once, then New tab in group, Ungroup and Close group. A new group opens it. They're kept with the tabs (this device's, or the workspace's file with Workspaces: a pane's `sets`, each tab's
`set`):
```
{"id": "g0", "active": "t2", "sets": [{"id": "s1", "name": "Lighthouse", "color": "teal", "collapsed": false}],
 "tabs": [{"id": "t1", "to": "file:Notes/a.md", "set": "s1"}, {"id": "t2", "to": "file:Notes/b.md", "set": "s1"}, {"id": "t3", "to": "new"}]}
```
`color` is one of blue, orange, green, red, purple, pink, yellow, teal, indigo, gray (the containers' palette); an
empty `name` is allowed (the chip is just its colour). A group's tabs are always together; one with no tabs left is
gone, and the tab on screen is never in a folded group (showing one opens it).

Change them in the user's window with `vau tabs` (tabs.list: its tabs and groups), `vau tabs group <tabs...> --name
--color` (tabs.group: a new group, or `--group <id>` to add to one or rename, recolour or fold it with `--collapsed`)
and `vau tabs ungroup` (tabs.ungroup: `--group <id>`, or tabs to take out of theirs). Tabs are named by id, by what they
show, or by a file's path or name. `vau workspace tabs` lists every workspace's, groups included.
