## Pinned
The sidebar's pages are the files pinned there: `pinned` in `.vaultite/pages.json`, vault paths in order. Any file can
be pinned (a dashboard, a note, an artifact, a table), and so can a heading in a note (`Notes/Idea.md#Plan`, a block
`Notes/Idea.md#^id`) and a search (`search:tag:#book`), like bookmarks; the pages plugins bring are pinned when they're first installed,
and only then (an unpinned one stays unpinned; never with `"pinNew": false` in pages.json). A pinned file whose `plugin:` is off, or that's archived, stays in
`pinned` but doesn't show, and comes back where it was. A page's other tabs (`tabs:`) aren't pinned: the head's strip
leads to them. Pins follow their files when they're moved or deleted through the app or the API.
- With Workspaces on, each workspace has its own list (`pinned` in its entry, see Workspaces): pages.json's is then
  the default, what a workspace without a list of its own shows (and new workspaces start with); the first pin or
  unpin in a workspace copies it and changes the copy. The pages a plugin brings, pinned when it's turned on, go into
  pages.json and into every workspace's own list.
- Change a list one entry at a time (never write the whole list from an old copy: another device may have changed
  it): `POST /api/pins {"path": "Dashboards/Finance.md", "pinned": true, "before": "Dashboards/People.md"}` (`before`
  optional: at the end; given for a pinned one, it moves there), `{"path", "pinned": false}` unpins: pages.json's;
  `POST /api/workspaces/<n>/pins` with the same body: workspace n's. Or `vau pin <file> [--before <file>]`, `vau unpin
  <file>`, `vau pages` (the list): the list the user sees (the current workspace's), `--workspace <n>` another's,
  `--vault` pages.json's.
- The phone has the same list in its drawer, and a new tab shows the pinned pages as tiles.
