## Links
The links of the file you're on, in the desktop sidebar's Links panel (or a tab: "Open links in a tab"): linked mentions
(files with a [[link]] or a Markdown link to it), unlinked mentions (its name or an alias written as plain text
elsewhere; "Link" makes that one a link, written as the vault writes links) and outgoing links (grey: no file has that name yet). Nothing is stored. As
JSON:
`GET /api/backlinks/unlinked?path=Notes/Idea.md` (the unlinked mentions: `{total, files, mentions}`, a page of 100 at a
time with `offset` and `limit`); `POST /api/backlinks/link {path, target, line, nth, col, len, text}` with one of them
links it.
With its setting `inDocument` (Backlinks in document, off by default) a note's linked and unlinked mentions also
show under its text.
On a web page (a Browser tab) it lists the notes about it (a `source:` of that address, as clippings and page notes
have), the notes linking it and links elsewhere on its site: `GET /api/backlinks/web?url=<address>` (`{site, about,
linked, elsewhere, total}`). "Note on this page" opens the note whose `source` it is, or makes one named after the page.
