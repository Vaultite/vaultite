## Web clipper (`Clippings/<Title>.md`)
A web page saved as a note: `POST /api/clip {"url", "html"?, "folder"?, "tags"?}` (or
`vau clip <url>`, or MCP's `clip` tool). Without `html` the server fetches the page (public addresses only); with it,
it clips the HTML given (a page you're logged in to), `url` saying where it's from. It answers `{path, title, words}`,
or `{path, existing: true}` for a page already clipped (a file whose `source` is that address); `"update": true` clips
it into that note again (its content as the page is now; tags and other keys the note has stay).
````
---
type: note
kind: note
source: https://example.com/posts/an-article
author: [Alice Park]
published: 2026-09-20
description: What the page says it's about
tags: [Clipping]
created: '2026-10-01 18:00:00'      # UTC, like notes
updated: '2026-10-01 18:00:00'
---

The page's main content, as Markdown.
````
- `title` and `aliases` are added only when the file name can't hold the title (a colon becomes " -").
- `"inbox": true` (or `vau clip <url> --inbox`, MCP's `clip` with `inbox`) puts it in the user's inbox to review instead
  (with the Inbox plugin on): `Inbox/<Title>.md`, `type: inbox`, `status: new`, `from` (who clipped it), the same keys
  otherwise.
