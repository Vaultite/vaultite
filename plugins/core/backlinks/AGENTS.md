## Links
The links of the file you're on, in the desktop sidebar's Links panel (or a tab: "Open links in a tab"): linked mentions
(files with a [[link]] to it), unlinked mentions (its name or an alias written as plain text elsewhere; "Link" makes
that one a [[link]]) and outgoing links (grey: no file has that name yet). Nothing is stored. As JSON:
`GET /api/backlinks/unlinked?path=Notes/Idea.md` (the unlinked mentions: `{total, files, mentions}`, a page of 100 at a
time with `offset` and `limit`); `POST /api/backlinks/link {path, target, line, nth, col, len, text}` with one of them
links it.
On a web page (a Browser tab) it lists the notes about it (a `source:` of that address, as clippings and page notes
have), the notes linking it and links elsewhere on its site: `GET /api/backlinks/web?url=<address>` (`{site, about,
linked, elsewhere, total}`). "Note on this page" opens the note whose `source` it is, or makes one named after the page.
