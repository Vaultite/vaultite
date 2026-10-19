## File history
Earlier versions of the vault's text files (Markdown, and code, JSON, HTML and CSV, of any size) are kept automatically
on the machine that runs the server, not in the vault: when a file changes (through the app, an AI, or on disk), its
previous content is saved, at most once per file every `interval_min` minutes, for `keep_days` days. Deleted and
renamed files keep theirs.
- Read it: `GET /api/history` (every file with versions: path, count, latest, gone),
  `GET /api/history?path=Notes/Idea.md` (its versions, newest first: `t` in ms, when that version was saved, `size`, and
  `by`: the agent that wrote it, as Activity names it), `GET /api/history/version?path=Notes/Idea.md&t=<t>` (that
  version's text). Plugins that keep versions of their own add them (`others`, like a git plugin's commits, read with
  `&source=<source>&id=<id>`), each offering the service `versions:<source>`.
- `POST /api/history/keep {"path", "text"?}` keeps a version now, whatever the interval: the file as it is, or `text`
  (the app keeps both sides of a conflict before settling it).
- To undo a bad edit, write the old text back with `PUT /api/file {"path", "text", "base"}`: that is itself kept.
- In the app: "Open version history" in a file's menu, or the command palette.
