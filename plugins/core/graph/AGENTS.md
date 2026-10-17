## Graph view
The vault as a graph: every Markdown file is a dot, and a [[link]] (or ![[embed]]) between two files is a line; other
files (images, drawings, canvases) are dots when something links to them or, for a `.canvas`, when its cards name
files. Nothing is stored: it's read from the files. "Open graph view" (palette) shows the whole vault in a tab (filter,
find, colour by folder or type; click a dot to open it), "Open local graph" one file's neighbours, and the sidebar's
Local graph panel (hidden until shown from the sidebar's right-click menu, or `vau panels show "local graph"`) follows
the file you're on; as a tab (drag its heading onto a pane, or its button) it's `view:local-graph`, following too.
The view's settings (below) are the Filter button's panel. A link in a property has the key as its type
(`project: [[Lighthouse]]`, quoted or not); links in the text are `body`.
- As JSON: `GET /api/graph` (`nodes: [{path, title, type, folder, tags, degree}]`, `edges: [{from, to, both?, types?}]`:
  `both` when linked both ways, `types` the property keys it's under), `GET /api/graph/match?q=["type:person"]` (the
  files each query matches),
  `GET /api/graph?path=Notes/Idea.md&depth=2` (that file's local graph, each node with `dist`: how many links away);
  `&archived=true` adds archived files.
- The `graph` block draws the local graph of the file it's in (`file: <name>` draws another file's), with the settings
  above but `search` and `hidden`. As text it lists the neighbours as [[links]].
