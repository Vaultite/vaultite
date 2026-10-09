# Notes for `core/`

## How it's built
- **Vault** = a folder of files (`VAULTITE_VAULT`; usually `~/.vaultite/vault`). **It is the only store: there is no
  database.** The server indexes every Markdown file in memory (`core/vault.ts`), re-reads changed files at the start
  of every request (reads arriving together share one sync: `Vault.synced`; a file iCloud is slow to give is left out
  until it arrives: `readSoon`), and API writes go straight to the files. Never wipe the vault; back it up before bulk
  changes.
  - **Folders are the user's** (reorganizing must never break anything): a file's kind is its `type:` wherever it is,
    never its folder alone (`Vault.kindFor`; a daily note without one by its name in the folder set: `KindSpec.owns`; never in the templates folder: `vault.plain`). A kind's `folder` is only a
    default: new files go in the folder set for it (folders.json), else where its files are (`Vault.home`), an item keeps its folder when renamed, pages are found by
    name, type and plugin, and a path from before a folder moved outside the app is found by `Vault.relocated`. Never
    hard-code `Dashboards/...` or `People/...`: find files by type or plugin, ids, or `homeOf`.
  - The server runs in a browser too, for the web demo (`web/demo/CLAUDE.md`): a new `node:` module or native package
    needs its shim or stub there.
  - **Caching is keyed on the vault's versions**: `vault.version` (its files) and `vault.settingsVersion`
    (`.vaultite/` but caches and generated/, the .obsidian/ files it reads). The file tree, `/api/state`, the graph and database
    views are kept until what they read changes and answered frozen (`jsonOf` serializes once); per-file data hangs off
    the `Entry`. A new cache that depends on something else (the clock, live data) must key on that too.
- **Writes are small edits, never rewrites** (`core/textedit.ts`, shared with the editor): `Vault.save` renders the old
  and the new item and applies only the difference (changed frontmatter keys' own lines, the body as a 3-way merge),
  and writes nothing when nothing changed. One that can't apply as a small edit is a 409 (ConflictError), never a
  rewrite of the whole header or body; a value cleared keeps its key, empty (as Obsidian does); `type:` is written only
  in a new file; a file is renamed only when the save changed its name. Reading never writes: a kind's `fill` (ids,
  dates) runs only on the app's own writes (`Vault.fillIn`: an edit in the app, a new file). A kind's `render` must be faithful (render(parse(file)) == file): People
  keeps each timeline line's source (`_src`) and lines it can't read (`_raw`). Keys starting with `_` are private: the
  API strips them.
- **Parse leniently, write canonically.** People edit files by hand: the timeline (`core/timeline.ts`, one parser for
  server and editor) accepts any bullet, separator, case or duration. Frontmatter is read and written like PyYAML
  (YAML 1.1: `23:15` is a number, `07:15` text; `core/yaml.ts`), so files look the same whoever wrote them; a new
  `20.0` is written `20`. Property types: `core/proptypes.ts` (`.vaultite/types.json` over Obsidian's).
- **Operations are the API** (core/ops.ts, the `Op` type says each field): everything an agent, a script or a plugin
  can do is an op (the core's in core/coreops/, a plugin's `plugin.op`, a vault plugin's manifest `ops`). From the one
  catalog come `POST /api/ops/<id>`, `vau`, the MCP tools and the docs; `npm run check` validates every op. Defaults
  (ids, slugs, `source`) live in the op, never in a client. An op keeps the request it came in (`{http}`) so the
  routes it calls apply their owner checks: never call a route in-process for a caller without passing it. Writes run
  under `App.hold` (the vault lock and a sync, reentrant); reads hold nothing; never call `callOp` inside a raw
  `vault.lock`. **A new agent-facing feature is an op**, never a hand-written vau command or MCP tool.
- **Events** (core/events.ts, `vau docs events`): one stream (`file.*`, `op.done`, `inbox.event`, plugins' own), read
  through `GET /api/events/stream`, `events.wait`, `vau events` and `plugin.onEvent`; the last 500 in memory.
- **Versions** (`core/version.ts`): `APP_VERSION` is package.json's; bump `API_VERSION` only for a change that breaks
  plugins (note it in CHANGELOG.md; raise `MIN_API_VERSION` when old ones can't load).
- **Pages are files** (`core/pages.ts`): a plugin's dashboard templates (`pages/<Name>.md`; Design in `core/pages/`) are
  copied in once its plugin is on, where the other pages are, never over one that's there: a newer template is offered
  wherever it moved (`locate`; the installed copy in `.vaultite/generated/Dashboards/`); a deleted one stays deleted.
  Pinned (`plugins/core/pages/`) and Dashboards are plugins; tabs (`core/tabs.ts`) stay core: a page with views is one
  file per view.

## Features
- **Files** (`core/files.ts`): any file opens, at any size (a card only past what JavaScript can hold as one string). Binary formats a plugin draws are
  read-only, and their `text:<ext>` (given a Buffer) is what render and search read. They're untrusted: a Word document
  is drawn in a shadow root, a book's pages are cleaned of scripts and get a CSP, a deck's renderer escapes its text;
  keep it so when updating those libraries (pinned in package.json). Delete goes to `.trash` with Undo; the
  core's schedule job `core/trash` deletes what's been there 30 days (`emptyTrash`, by the time in its name). Moves through
  the API update `[[links]]` and what plugins keep (`plugin.onMove`); renames by hand don't. Hidden folders are out of
  reach unless Show hidden files is on, but `.archive/` (indexed, archived) and `.vaultite/**.json|md` by exact path;
  `.trash` and `.vaultite/generated` are read-only. **The app never writes outside `.vaultite/` on its own**: the
  vault's AGENTS.md/CLAUDE.md are the user's (Agent files adds one pointer line only with `rootFiles` on).
  `POST /api/file/open` only from this machine (loopback, no proxy headers, the app's Origin).
- **The vau CLI** (`core/cli.ts`, `bin/vau`): a thin client of the catalog (`vau <id>` or its cli name, flags and help
  from the op); `vau` alone is the prompt (core/repl.ts). `vau open`, `command`, `notify` act in the window focused last
  (`Live.drive`); `vau commands`, `vau dev` and `vau choose` wait for its answer (`Live.ask`; ui.choose holds no lock: a person
  may take minutes); `dev.*` run code there, so they're owner
  ops. What only the app's source knows (palette commands, panels, page icons) is read in core/appsource.ts, so keep it
  greppable; `npm run app:build` snapshots it into `electron/cli.json`. The server: VAULTITE_URL, else the desktop app's
  server for the vault it runs in, then 8793, then the app's other open vaults.
