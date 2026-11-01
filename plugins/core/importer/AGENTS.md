## Importer (`Notion/`, `Evernote/<notebook>/`, `Keep/`)
Notion's, Evernote's and Google Keep's exports, imported: the op `importer.run <path>` (an export in the vault), `POST /api/importer`
with the file as the body (`?folder=&name=`), or "Import notes from another app…" in the app. It answers a job
(`GET /api/importer/jobs/<id>`, `vau importer.job --wait`: `state`, `notes`, `created`, `unchanged`, `files`).
- Notion (Markdown & CSV export, a zip or a zip of parts): a page is `Notion/<path>/<Title>.md` (Notion's ids off the
  names), its subpages and attachments in the folder of its name; links between pages are wikilinks; a database is
  its CSV (every property) beside a folder with a note per row, the row's properties as frontmatter (dates as
  YYYY-MM-DD, Yes/No as booleans, relations as links).
- Evernote (.enex, one per notebook, or a zip of them): a note is `Evernote/<notebook>/<Title>.md` with `tags`,
  `source`, `author`, `created`, `updated`; to-dos become tasks, attachments go in `Attachments/`, embedded where they were.
- Google Keep (Google Takeout's zip): a note is `Keep/<Title>.md` with `tags` (its labels), `created`, `updated` and
  `archived` for an archived one; its checklist becomes tasks, its attachments go in `Keep/Attachments/`. Trashed notes
  are left out.
- Bear (its backup, a .bear2bk): a note is `Bear/<Title>.md` with `created`, `updated`, `archived`; `::highlights::`
  become `==highlights==`, `#tags with spaces#` `#tags-with-spaces`, its pictures go in `Bear/Attachments/`.
- HTML pages (one, or a zip of them: any app's export, Notion's HTML one too): `<export's name>/<path>/<page>.md`, links
  between pages as wikilinks, images and other files beside them.
- Each note has `ext_id` (`notion-<id>`, `evernote-<hash>`, `keep-<hash>`, `bear-<hash>`, `html-<hash>`): importing again adds only notes not imported before and
  leaves the others as they are. They're the user's notes from then on: edit them like any.
