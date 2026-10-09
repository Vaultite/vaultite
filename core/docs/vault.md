## The vault in full (files, links, blocks, page tabs, archiving)
Every file is the only copy of what it holds. The app reads them live (a saved file shows on the next load) and edits
them in place: only the frontmatter keys whose values changed (other keys, comments and order stay) and single lines
of the body, and only when someone asks it to (reading never writes). What it fills in (a note's id and dates) goes in
only when the app makes the file or it's edited in the app. Files it can't read are listed at
`GET /api/vault` and shown on the file in the app. Deleting a file deletes that thing; the app's deletes go to
`.trash/` (restored from there, or gone for good after 30 days).

**Layout.** A file's kind is its `type:` frontmatter wherever it lives, and only that: a file without one is a plain
note, even in `People/` (`vau type` lists such files and gives them one). A kind kept in one file (the user's `ME.md`,
`Work.md`) is also that file without a `type:`. Folders are the user's: moving or renaming one never changes what its
files are. Each kind has a usual folder (`People/`, `Notes/`, `Logs/<Area>/`, `Routines/`, `Daily/`, `Books/`,
`Projects/`; dashboards in `Dashboards/`), but new files go where that kind's files already are (a
new person where most people are, a log where its area's logs are), and only into the usual folder when there are
none. Notes in the templates folder (`Templates/`) are never items, whatever their type. Any other Markdown file or
folder is fine (a plain note, found by its name; its links count). Database views, the graph and the app all go by the
type. `.vaultite/` is the app's settings (`vau docs app`); `.vaultite/cache/` is live
data plugins fetched and `.vaultite/generated/` the app's own copies, and `.vaultite/AGENTS.md` its rules for AIs: don't edit them.

**Links.** `[[Alice Park]]`, `[[Note title]]`, `[[Bob Lee|Bobby]]` (other text). A first name works when only one
person has it. `[[Note#Heading]]` goes to a heading, `[[Note#^id]]` to a paragraph or list item ending in ` ^id`,
`[[#Heading]]` to one in the same file. `![[Note]]` on a line of its own shows that note's text there
(`![[Note#Heading]]` its section, `![[Note#^id]]` that block); `/api/render` inlines it as a quote. A Markdown link to
`vaultite://command/<id>` runs that app command when clicked (`[Open Claude Code](vaultite://command/terminal:claude-split)`).

**Blocks.** A fence like ```` ```block-person ```` (closed by ```` ``` ````, options inside as YAML, like `issues: 3`)
is where the app draws something: a profile, a project's GitHub numbers, today's routines. What it shows comes from the
file's fields or live data, so never write your text or numbers in one. A kind's own blocks (a person's profile, a
log's fields) are drawn on top of each of its files without a fence: never add one for them. A fence of one moves it
(the app writes it when the user changes its options or source); leave fences where they are (the user arranges the
page with them). API writes never touch them. Every block also
takes `wide` and `stack` (a dashboard's grid) and `file: <name>` (drawn for another file: a name or path like a
`[[link]]`, or a folder ending in `/` for its newest file, `file: Logs/Gym/`). An option a block doesn't take, or of
the wrong type, is still drawn with a note (under it while editing; in `/api/render` an italic line after its text,
_(github block: unknown option `isues` (did you mean `issues`?))_): fix those when you see them. `vau blocks` and
`GET /api/blocks` list every block and its options; `Dashboards/Design.md` shows every block and piece of Markdown the
app draws: read it before building a page.

**Reading.** `GET /api/render?path=Dashboards/Today.md` (`vau render Today`) answers any file as Markdown with its
blocks filled in, and saves nothing. A path to a file that moved still reads it (the one file of that name, or the one
dashboard). Word, Excel, PowerPoint and EPUB files read the same way, as their text (`vau render Lease.docx`), and
search finds what's in them; they're the user's documents: read them, never write or convert them in place.

**Pages.** Pages are files: the pages plugins bring are dashboards, put in `Dashboards/` (or where the other pages
are) and found by name wherever the user moves them (`vau docs dashboards`), and the
sidebar lists the files pinned there (`vau docs pages`). To change a page, edit its file; to make one, write a
dashboard and pin it. A page with views (People: List and Map) is one file per view, never layout inside one file: the
first file lists the others, `tabs: [People map]` (file names, like a `[[link]]`), each says its label, `tab: Map`;
the app draws a switch under every file's title in the group, and only the first is pinned.

**Timelines.** A `## Timeline` section in a file whose kind draws one (a person's) is drawn as a timeline (in other
files it's Markdown as written): lines like `- 2026-09-28 · kind · text`
(`vau docs people`). Its Add button (and `POST /api/timeline {path, date, kind, duration_min, notes}`) writes one line,
placed by date (the section is made at the file's end when there's none).

**Archiving.** `vau archive <file>` (or `PUT /api/<collection>/<id> {"archived": true}`, or Archive in its menu)
moves a file into `.archive/` in its own folder and sets `archived: true`; `vau unarchive` moves it back and removes the
key. Links follow both ways. A file with the key, or in an `.archive/` folder, is archived: it still opens and its
links resolve, but it's left out of plugins' lists and blocks, `/api/notes` and `/api/logs` (unless `archived=true`), the
graph, database views (unless `archived: true` or `only`), the sidebar and first-name or alias links another file also
answers to; search lists it last. Writing the key by hand doesn't move the file: `vau archive tidy` does.

**The CLI.** `vau --help`: `vau context` first, then `vau render`, `vau open <file>` (in the user's window), `vau
panels`, `vau workspace`, `vau terminal`, `vau appearance`, `vau pin`, `vau log`, `vau docs`...
