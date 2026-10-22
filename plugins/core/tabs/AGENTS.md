## Tabs
The Tabs panel lists the open tabs pane by pane, so the tab bar can be off: vertical tabs. One switch moves the tabs
between the two (the palette's Show tabs in the sidebar / Show tabs on top, or right-click the tab bar or the panel):
in the sidebar, appearance `tabBar` is false and `tabs:tabs` is at the top of the left sidebar (sidebars.json, or the
workspace's `sidebars`); on top, `tabBar` is true and the panel is hidden. Under the tabs, what the user's other devices
have open (`other_devices`), from `.vaultite/plugins/tabs/device-<id>.json`, one per browser.

**Tab groups**, as in a browser: a named, coloured run of a pane's tabs, side by side, that folds to its name. In the
tab bar a group is a chip before its tabs, which are underlined in its colour; in the panel, the same pill, a line in
its colour hanging from it down its tabs. They're kept with the tabs (this device's, or the workspace's file with Workspaces: a pane's `sets`, each tab's
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
