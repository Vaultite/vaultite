# Notes for `core/`

## The vault
- The only store. The server indexes every Markdown file in memory (`vault.ts`), re-reads changed files at the start of
  every request, and API writes go straight to the files. Back it up before bulk changes.
- Folders are the user's: reorganizing must break nothing. A file's kind is its `type:` wherever it is
  (`Vault.kindFor`); a kind's `folder` is only where new files go by default. Find files by type, plugin, id or
  `homeOf`, never by a hard-coded path like `People/...`.
- Caches key on `vault.version` (files) and `vault.settingsVersion` (`.vaultite/`). A cache that depends on anything else
  (the clock, live data) keys on that too.
- The server runs in a browser too (`web/demo/CLAUDE.md`): a new `node:` module or native package needs an alias in
  `vite.demo.config.ts`, or the demo build breaks.

## Writes
- Small edits, never rewrites (`textedit.ts`, shared with the editor): `Vault.save` applies only the difference
  (changed frontmatter lines, the body as a 3-way merge) and writes nothing when nothing changed. What can't apply as a
  small edit is a 409 (`ConflictError`). A cleared value keeps its key, empty, as Obsidian does.
- Reading never writes: a kind's `fill` (ids, dates) runs only on the app's own writes (`Vault.fillIn`), so two servers
  on one iCloud vault can't loop.
- A kind's `render` is faithful: render(parse(file)) == file (People keeps each timeline line's source, `_src`, and lines
  it can't read, `_raw`). Keys starting with `_` are private: the API strips them.
- Parse leniently, write canonically: people edit by hand. Frontmatter is read and written like PyYAML (YAML 1.1:
  `23:15` is a number, `07:15` text; `yaml.ts`), so files look the same whoever wrote them.
- The app writes nothing outside `.vaultite/` on its own (`writegate.ts`). A request (the app, the CLI, an agent) is
  the user's. A plugin acting on its own (jobs, hooks, timers, a vault plugin's hook commands) writes outside only where
  its manifest's `writes` declares and the user allowed (`grants.ts`). A new background writer declares `writes`, and
  goes through the gate, never around it with `byUser`.

## Operations
- Everything an agent, a script or a plugin can do is an op (`ops.ts`, the `Op` type; the core's in `coreops/`). From
  the one catalog come `POST /api/ops/<id>`, `vau`, the MCP tools and the docs. Defaults (ids, slugs, `source`) live in
  the op, never in a client.
- An op keeps its request (`{http}`) so the routes it calls apply their owner checks: pass it whenever calling a route
  in-process. Every API call (HTTP, ops' `ctx.api`, `plugin.host.api`, bundles) goes through one path (`App.respond`), and
  writes run under `App.hold` (reentrant): call `run`, `callOp` and the API outside any raw `vault.lock`, or they wait
  on themselves.
- What only the app's source knows (palette commands, panels, page icons) is read in `appsource.ts`: keep it greppable.
- `API_VERSION` (`version.ts`) changes only for a change that breaks plugins (note it in CHANGELOG.md; raise
  `MIN_API_VERSION` when old ones can't load).

## Files
- Binary formats a plugin draws are untrusted: a Word document draws in a shadow root, a book's pages are cleaned of
  scripts and get a CSP, a deck's renderer escapes its text. Keep it so when updating those libraries.
- Moves through the API update `[[links]]` and what plugins keep (`plugin.onMove`); renames by hand don't.
- The vault's own AGENTS.md and CLAUDE.md are the user's: Agent files adds one pointer line, only when allowed.
- `POST /api/file/open` answers only this machine (loopback, no proxy headers, the app's Origin).
