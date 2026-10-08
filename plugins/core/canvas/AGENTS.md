## Canvases (`*.canvas`, JSON Canvas)
A board of cards joined by arrows, in the open JSON Canvas format (jsoncanvas.org, spec 1.0), so other apps open the
same files. New ones go next to the note being written, else `Canvases/` ("New canvas" in the palette, `/canvas` in a
note), or in the folder right-clicked in the file tree (its New canvas). The app draws it as an infinite canvas; `![[Canvases/Plan.canvas]]` on a line of its own in a note or a
dashboard shows a picture of it (`|400`: its height). `GET /api/render?path=Canvases/Plan.canvas` reads it as text:
its cards (by group), notes as [[links]], and its connections. The graph view draws a line from a canvas to every note
it shows.

The shape (other apps write it indented with tabs; keep keys you don't know):

    {"nodes": [
       {"id": "g1", "type": "group", "label": "Launch", "x": -40, "y": -80, "width": 700, "height": 320, "color": "4"},
       {"id": "t1", "type": "text", "text": "## Plan\nShip the beta to [[Alice Park]].", "x": 0, "y": 0, "width": 260, "height": 120},
       {"id": "f1", "type": "file", "file": "Projects/Lighthouse.md", "x": 340, "y": -20, "width": 280, "height": 220},
       {"id": "l1", "type": "link", "url": "https://example.com", "x": 0, "y": 320, "width": 260, "height": 100}
     ],
     "edges": [
       {"id": "e1", "fromNode": "t1", "fromSide": "right", "toNode": "f1", "toSide": "left", "label": "then"}
     ]}

- Nodes: `text` (Markdown), `file` (a vault path; `subpath: "#Heading"` for part of a note; images show as pictures),
  `link` (a web address; the app shows its page's preview, like a link unfurl: title, site, description, icon and,
  on a tall card, its image; `GET /api/canvas/link?url=<address>` gives it as `{url, title, site, description, image,
  icon}`, nothing kept in the vault), `group` (`label`; the cards inside its box belong to it). Every node has a unique `id` and
  `x`, `y`, `width`, `height` in pixels (y grows downwards); groups come first in the list (they're drawn behind).
- Edges: `fromNode` / `toNode` (node ids), optional `fromSide` / `toSide` (top, right, bottom, left), `fromEnd` /
  `toEnd` (`none` or `arrow`; default: an arrow where it ends only) and `label`.
- `color` on a node or an edge: `"1"` red, `"2"` orange, `"3"` yellow, `"4"` green, `"5"` cyan, `"6"` purple, or a hex
  colour like `"#4a90d9"`. Leave it out for none.
- Keep the JSON valid: the app saves only while it parses. Sentence case on cards, no emojis.
- The board's settings (below) are also `GET`/`PUT /api/canvas/settings`.
