## Plugin API reference
Written from the code's own doc comments (tools/plugin_api_doc.ts), so it's what this version has. How to write a plugin:
`vau docs vault-plugins`; every name each module has, with its parameters: `vau docs plugin-api-names`.

### The server: `plugin.ts`
`import { Plugin } from "@vaultite/core/plugins.ts"`, then `export const plugin = new Plugin(import.meta.url)`.

- `plugin.vault`: The vault (set by the loader).
- `plugin.blocks`: Its blocks as manifest.json declares them (core/blocks.ts): name -> description and options.
- `plugin.route(method, pattern, fn, options)`: `pattern`: a path under /api/, * one segment, a last ** the rest. `lock: false` for routes that run ops themselves or wait on something slow (they hold the vault only to write); `stream: true` leaves the body unread (uploads).
- `plugin.op(def)`: An operation, served as `POST /api/ops/<id>`, `vau <id>`, MCP and the docs (core/ops.ts). Its id starts with the plugin's id or a kind it owns. Only while the plugin is on.
- `plugin.serve(prefix, fn)`: GET /<prefix>/<rest> outside /api/, for what a browser loads by address (an artifact's sandboxed frame at /v/...). Only while the plugin is on; the vault isn't synced first and onRequest doesn't hear of it.
- `plugin.socket(pattern, fn, opts)`: A WebSocket at /api/<pattern>. `opts.accept` runs before the upgrade and refuses it by throwing an HTTPError. Sockets of a plugin that's off are refused.
- `plugin.block(name, fn)`: fn(ctx) -> Markdown: what ```block-<name> shows as text, for AIs (GET /api/render). Every block the app draws has one (npm run check); ctx.options has the manifest's declared defaults filled in.
- `plugin.onUnload(fn)`: fn() runs when the plugin is unloaded: a vault plugin turned off, or changed (it's loaded again). Stop timers and close what it opened here.
- `plugin.onSync(fn)`: fn(vault) runs after every sync of the vault (before each request, and when files change on disk: core/live.ts), to follow the files themselves (File history keeps their earlier versions). Keep it cheap: it runs often.
- `plugin.onMove(fn)`: fn(from, to) when the API moves, restores or trashes a file (to: null; `trashed`: where it went), so what the plugin keeps follows; even while it's off. Moves on disk (Finder, iCloud) aren't heard.
- `plugin.onCreate(fn)`: fn(path, fm, writer) before the API writes a new Markdown file: the keys it returns are added (the file's own win). `writer` is who asked (null for no request). Only while on; files written on disk aren't heard.
- `plugin.onCreateFile(fn)`: fn(path, file, writer) before the API writes a new file that isn't Markdown (an upload, an SVG): `file` (NewFile) is read-only and read only as far as asked, as an upload can be any size. Only while on; files written on disk aren't heard.
- `plugin.onArchive(fn)`: fn(path, archived) when the API archives or unarchives an item (`archived` set or changed in a write): the folder its file moves to (links follow, like a move), or null to leave it. Only while on (the Archive plugin's).
- `plugin.onRequest(fn)`: fn(start) as each API request starts; the function it returns runs when it's answered. Keep it cheap and never throw: it runs for every request.
- `plugin.onChange(fn)`: fn(paths) runs after files in the vault changed on disk and were read (the app's own writes too: they come back from the watcher like anyone's), with their vault paths, or null when the watcher couldn't say which.
- `plugin.onServerError(fn)`: fn(error) for each error the server logs, with its request. Runs synchronously and isn't heard again for its own errors: write what you keep at once, never throw.
- `plugin.onEvent(filter, fn)`: fn(event) for each event of the vault matching `filter` (core/events.ts: `types`, a type or an area, "file"; `path`, a vault path prefix), only while the plugin is on. Keep it quick: events come from every write.
- `plugin.around(ops, fn)`: fn around every op matching `ops` (an id, an area "note" or "note.*", "*"), the outermost first by plugin order: rewrite, answer or refuse what agents, the CLI and other plugins ask. The app's own edits are routes, not ops.
- `plugin.every(name, when, fn)`: fn on a timer, run by the server: `every` "15m", "2h", "1d", "1w"; `at` "07:00" (this machine's time) with whole days; `machine` a Machines id (else the first listed). Runs once at a time; `vau schedule list` shows it. Called again by name it's replaced; `when` null removes it (a schedule its settings set).
- `plugin.host`: The core's operations and events, for this plugin's vault (core/app.ts gives them).
- `plugin.runOp(name, params, who?, http?)`: Run an op of the catalog (any plugin's, by id or CLI name) as `who` (else the request's), for the request `http` (req.http: pass it, so owner checks apply): plugin.host.call.
- `plugin.emit(type, data)`: Tell the vault's events something happened: its type is `<plugin id>.<name>` ("finance.imported").
- `plugin.state(fn)`: fn() -> a record merged into /api/state. Default: each of the plugin's kinds as {collection: items}.
- `plugin.folders(fn)`: fn() -> the folders on this machine its live data is read from (absolute): a block's menu offers to open them (POST /api/file/open opens these and nothing else outside the vault).
- `plugin.liveFolders()`: Its folders that are there now.
- `plugin.settings(fallback?, file)`: This plugin's settings, .vaultite/plugins/<id>/data.json (another's: plugin.peer(id)?.settings()). `file`: another file of its own, for parts written often, so devices changing different parts never write the same file.
- `plugin.readSettings(file)`: The settings as they are on disk now, for a read-modify-write: null when there's none; throws ConfigError (from core/vault.ts) when the file is there but can't be read or doesn't parse, which settings() would take for empty.
- `plugin.saveSettings(data, file)`: Write the settings (null removes the file).
- `plugin.localDir(make)`: Its folder on this machine for this vault, <LOCAL>/<id>/<vault key>/ (disposable, never synced): made unless `make` is false, with vault.txt naming the vault.
- `plugin.cachePath()`: .vaultite/cache/<id>.json in the vault (the vault's folder when run on its own, like the GitHub refresh).
- `plugin.secrets()`: This machine's data/config.json (private URLs, keys). Never copy these into the vault.
- `plugin.saveSecrets(data)`: Sets this plugin's own key in data/config.json (`secrets()[plugin.id]`; null removes it), the rest as it is. The file is readable by this machine's user only.
- `plugin.refusal(req, what)`: Why this request may not have what only this machine's owner may (a shell, the screen), or "" (core/owner.ts). Reads the plugin's `allowUsers` and `allowRemote` settings.
- `plugin.allows(what)`: Whether this machine's owner said yes to `what` (a command a vault setting names: a synced or shared vault mustn't choose what runs here). Kept on this machine, never in the vault (core/trust.ts).
- `plugin.allow(what)`: Remember this machine's owner said yes to `what` (only after asking them: plugin.refusal).
- `plugin.memo(ttl, fn, ...args)`: fn(...args), remembered in memory for ttl seconds (live data: fetched again when it's stale). A failure isn't.
- `plugin.forget()`: Forget everything memo() remembers.
- `plugin.editLine(rel, n, was, now)`: A small edit of one line of a vault file: line `n` (from 0, the whole file's, frontmatter too) from `was` to `now` (a list: several lines in its place; null: removed). 409 when that line isn't `was` any more (edited meanwhile).
- `plugin.peer(id)`: Another loaded plugin (one this plugin requires), to use what it offers: logs.exports.areaSummary(...), or its settings: plugin.peer("templates")?.settings().
- `plugin.propertyTypes()`: The vault's property types (propertyTypes, below).
- `plugin.isOff()`: Whether this plugin is switched off in plugins.json (Vault.switchedOff: `disabled`, or `offByDefault` and not turned on): its routes still answer, so one that mustn't checks.
- `plugin.service(name)`: The service `name` of a plugin that's on (plugin.provide), or null: what this plugin asks of others without naming them (Terminal runs a coding agent through "agent:<name>", whoever brings it).
- `plugin.ask(name, fallback, ...args)`: The service `name`'s answer (`args` passed), or `fallback` when no plugin that's on provides it or it fails.
- `plugin.docs()`: Its docs (core/docs.ts): its AGENTS.md, then settings, blocks and operations generated from the manifest and ops, so what AIs read is what the app checks. null when it has none.

What it gets: a route's `req`: `method`; `parts`; `query`; `body`; `wild`; `rawPath` (A served address's rest (plugin.serve), as it was sent: not decoded, with its query string ("npm/x@1/y.js?z")); `http?` (The HTTP request it came in (its headers, its socket), when it came over HTTP (server.ts); undefined when the API is called in-process (tests)); `arg` (The i-th wildcard segment of the route (already URL-decoded)). A block's `ctx` (plugin.block): `vault`; `path`; `fm`; `body`; `options`; `today`; `host?` (Drawn inside an embed (`![[Note]]`): the note embedding it, the nearest one); `source` (Name the files it shows (items, or vault paths): "Show source" on the block leads to them (core/sources.ts)).
`plugin.vault.entries` maps each Markdown file's path to its entry: `rel`; `stat`; `kind`; `fm`; `body`; `item`; `problems`; `broken`; `type` (Its type, one rule for the whole app (core/fileprops.ts): its kind's when a kind owns it, else its frontmatter's); `archived` (`archived: true` in its frontmatter, or in an archive folder (core/fileprops.ts)); `tagCache`; `tags` (Its tags: frontmatter `tags` and inline #tags in the body (core/sections.ts), worked out once per read). A kind of file,
`plugin.kind(new Kind({...}))`: `type` (the frontmatter `type:` (person, note, log...)); `collection` (its name in /api/state and the API (people, notes, logs...)); `folder?` (its usual folder ("People"; "Logs" holds subfolders when recursive is true): only where its first file goes (Vault.home)); `file?` (or a single file ("ME.md", in any case; a function when a setting names it), its kind with or without a `type`; elsewhere, the one file of its type); `recursive?`; `titleKey?`; `parse` (file -> [item, problems] (the vault adds `id` and `modified`, UTC)); `render` (item -> [owned frontmatter, body]; keys the file has beyond `owned` are kept); `filename?` (path relative to the vault, without .md (default: <folder>/<safe name of item[titleKey]>)); `key?` (a value that identifies the item for upserts (POST with the same key updates it), or null); `prepare?` (before a write: fill timestamps, geocode..); `fill?` (after the app wrote the file for someone (an edit in the app, a new file; before = what it was): an item to write back with fields filled in (ids, dates), or null); `order?` (sort for /api/state (default: by id)); `merge?` (an update: the old item with the patch's fields on top (a kind can merge nested fields, like log data)); `blocks?` (its files' view: blocks drawn on top of each file that doesn't place them itself (["person"]: ```block-person), or a function of its frontmatter); `sections?` (`## ` headings its files' view draws instead of their text (["timeline"]): only in its files, never in any note); `stamps?` (frontmatter keys the app keeps as UTC times ("YYYY-MM-DD HH:MM:SS"): shown in local time, not edited by hand). One frontmatter key in a file's text:
`setPropertyText` (`@vaultite/core/vault.ts`).

### What it is: `manifest.json`
The app's own manifest keys (a vault plugin's are in `vau docs vault-plugins`).

- `id` (required)
- `name` (required)
- `description` (required)
- `icon`: Its icon, wherever it's listed (and in the directory before it's installed): a Lucide name ("heart-pulse"), one a plugin adds ("claude": `icons`), or an SVG file in its folder ("icon.svg", a mark in one colour: drawn in the text's).
- `requires`: Can't work without these plugins: off while any of them is off.
- `enhances`: Uses these when they're on (optional).
- `runsOnServer`: Reads files or runs programs on the server's machine (an agent's, a CLI); it shows on every device through it.
- `tint`: Its colour, a named one ("orange", "teal": --orange...): the app makes --<id> of it (--today), which its pages, files and cards use (`tint: today` in a dashboard) and a colour scheme may set to something else.
- `category`: Its section on the Plugins page and in Settings ("life", "agents": core/categories.ts); none or unknown: Other.
- `blocks`: Every block it draws (`blocks` in its definition), what it shows and its options (core/blocks.ts). The core checks a block's options against it (a quiet note while editing), fills in its defaults, and lists it for AIs.
- `settings`: Its settings (.vaultite/plugins/<id>/data.json), typed like a block's options plus a label each (core/blocks.ts SettingDecl): its settings sheet draws them as a form, and its docs list them (`vau docs <id>`).
- `offByDefault`: Off until the user turns it on (plugins.json `enabled`), for a plugin that changes how everything behaves (Vim), and every built-in that isn't `essential` (bundles turn them on). The server keeps its backend off too (Vault.switchedOff).
- `essential`: One of the app's own (built-in only): the Plugins page lists it under Built-in. The other built-ins are Vaultite plugins, first-party extras listed apart and off until turned on (`offByDefault`, or by a bundle).
- `replaces`: Other apps' plugins it stands in for, by app ({"obsidian": ["dataview"]}; "*": it runs any of them). Two opt-in plugins standing in for the same one are alternatives: turning one on turns the other off.

### The app: `definePlugin({...})` in `index.tsx`
`import { definePlugin } from "@vaultite"`; every key is optional (its icon is its manifest's).

- `icons`: Icons it adds by name: a file's `icon:` can name them (a dashboard's `icon: claude`), and other plugins draw them with iconNamed("claude") (the plugin API) without importing it.
- `details`
- `search`: What the quick switcher and the search tab find by name: its things, from the store.
- `searchLive`: Things it finds that aren't in the store (running terminals): `docs` is asked whenever search looks, and `subscribe` says when they change while search is open.
- `links`
- `webLink`: Web links clicked in the app: true when it opened one itself (the Web viewer), false to leave it to the browser. The first plugin that's on and takes it wins.
- `schemeLink`: Links of another app's scheme clicked in the app (`<app>://open?file=…`, `zotero://…`): true when it took one. The first plugin that's on and takes it wins; none: the link does nothing.
- `preview`: What the Plugins sheet shows, with made-up data: a render, or the id of the plugin whose dashboards (pages/*.md) to show (a plugin whose blocks are on Projects previews "projects"). Defaults to its own dashboards.
- `mock`: Made-up data for previews: its keys of the store (what its plugin.ts puts in /api/state), made from the real store where that's configuration, not personal data (the logs' areas).
- `mockLive`: Made-up answers for its live routes in previews, by path ("calendar": {events: [...]}).
- `files`: How its files look when opened (see FileView).
- `formats`: Kinds of files it draws, by extension (see FileFormat).
- `fileFormat`: A format for one Markdown file, decided by the file as it opens (a hosted plugin taking a note's leaf: Kanban's boards); null leaves it to the app. Wins over `formats`; its source view is still the file's text.
- `blocks`: What it draws where a file has a ```block-<name> fence (YAML options inside). Each is declared in its manifest and has a text side in plugin.ts, for /api/render: `npm run check` holds the app's plugins to both.
- `fences`: Code fences it draws by language (```base). Its backend reads one as text with the service `fence:<lang>`.
- `timeline`: Kinds of timeline entries it knows ("call": a phone icon), for the `## Timeline` sections kinds draw (a person's).
- `views`: Tabs it can open that aren't files (see ViewDef), by name: `view:<name>`.
- `agents`: Coding agents it brings, by name (see AgentDef): the Terminal plugin runs them.
- `commands`: Its commands, listed in the command palette while it's on.
- `editor`: What it adds to every editor (see EditorExtension).
- `slash`: Its entries in the editor's slash menu (see SlashItem). Every plugin's blocks are offered there already.
- `sidebar`: Its panels in the desktop sidebar, by name (see SidebarPanel).
- `header`: What it draws in the desktop sidebar's header, by name (see HeaderItem).
- `status`: What it draws in the status bar, by name (see StatusItem).
- `ambient`: What it draws in the status bar whatever is open, by name (see AmbientItem).
- `fileBar`: What it draws in a file's header, by name (see FileBarItem).
- `noteTop`: What it draws at the top of a note's page, by name (see NoteTopItem).
- `textSizes`: Content with a text size of its own apart from the app's zoom (core/textsize.ts), by id: it gets ⌘+scroll (`useTextSizeWheel`), commands and a Settings row; the view reads `useTextSize(id)`.
- `keyGroups`: Names for the first steps of its commands' key sequences, which the keys hint shows while one is under way (`{"Space F": "Files"}`; steps spelled as in `keys`).
- `sidebarSetup`: Keeps the sidebars' setup itself, instead of sidebars.json (see SidebarSetup).
- `conventions`: Where new files go and how links are written, as the vault says (see Conventions).
- `openElsewhere`: The places open in tabs it keeps off screen (other workspaces' tabs), so closing a tab here doesn't end what it shows (a terminal's shell) while one of those still has it.
- `workspace`: Keeps workspaces (see WorkspaceHost): one plugin at a time, the first that's on.
- `fileMenu`: Items it adds to a vault file's menu (the tree, the tab, the phone's …), for that file's path; [] for none.
- `editorMenu`: Items it adds to a text editor's right-click menu (desktop), for that editor (`path`: its file); [] for none.
- `folderMenu`: Items it adds to a folder's menu in the file tree, for that folder's path; [] for none.
- `webPageActions`: Buttons it adds to a web page's bar in the Web viewer (see WebPageAction), for the page shown; [] for none.
- `fileMarks`: Marks on files in the file tree, by path, from the store (keep it to the few files that need one).
- `fileIcons`: Icons it gives files and folders, by path, from the store, wherever the app draws a file's icon (the tree, tabs, lists); a file's own `icon:` wins. The first plugin's wins.
- `fileRows`: Rows of the file tree it draws into itself, by path (see FileRow); call `fileRowsChanged()` when they change. Keep a row's object the same while it says the same: only rows whose object changed are drawn again.
- `home`: Where a device's first tab goes and where a phone with nowhere to be goes: a tab target, or null. The first plugin that's on and answers wins; with none, a new tab.
- `newTab`: Sections it adds to a blank tab's page, by name ("<plugin id>:<name>", arranged in newtab.json).
- `settingsPanel`: Its settings sheet, for what a form from its manifest's `settings` can't say: `SettingRow`s in `Group`s, no `Panel`s. Plugins never add to the Settings page: it's the app's own.
- `settingsSearch`: What its settingsPanel has, for the Settings page's search (its manifest's `settings` are found by themselves).
- `newFiles`: Kinds of files it makes, in the New submenu after New note in the file tree's menus (see NewFile).
- `background`: Runs while it's on, drawn nowhere, in every open window and device: listen and draw there (Workspaces keeps tabs in step), never write on a timer. What must happen once is the server's: plugin.every. Return null.

### Services the app's plugins offer
`plugin.ask("<name>", ...args)` (`plugin.provide` to offer one): by name, never by plugin.

- `activity:report` (activity): The command for a coding agent's hook to report what it did (Terminal passes it to the agent it starts: AgentStart `report`): it sends the hook's JSON (on stdin) here, with the agent's name and its terminal. Never fails the hook.
- `agent:<…>` (claude, codex, cursor, hermes, openclaw, opencode): claude-code; codex; cursor; hermes; openclaw; opencode
- `agent-meters:claude` (claude-code)
- `agent-session:claude` (claude-code): A session's last response and how long its prompt cache lasts (the service "agent-session:claude": the Inbox resumes it while cached). The TTL is an hour when its last responses wrote 1 h cache, else five minutes.
- `attachments:folder` (other-apps): Where a file attached to `from` goes, as the app's attachmentFolder convention says (index.tsx); undefined: unset.
- `context` (pages, workspaces): What `vau context` says of it: the pinned pages the user's window shows.
- `fence:base` (query)
- `file-props` (provenance): Other files' `origin` for database views over every file (a .base): the list's, else what the bytes say.
- `geocode` (people): A place's pin, [lat, lon] or null: looked up once (Nominatim), then cached. Me uses it for ME.md's place.
- `geocode:known` (people): A place's cached pin without looking it up: [lat, lon], null (not found) or undefined (not looked up yet).
- `history:<…>` (versions, text, changed): history
- `inbox:<…>` (folder, hook, handed, event, drop, ask, answer): inbox
- `link-names` (people)
- `links:canvas` (canvas)
- `log-areas` (health, learning, logs)
- `logs:areas` (logs): The areas as the app has them (Today's routines take their icon and weekly goal).
- `looks:csv` (tables)
- `machines` (machines)
- `machines:machine` (machines)
- `machines:self` (machines)
- `machines:vault` (machines)
- `machines:ids` (machines)
- `mcp:tool` (mcp): A tool by name for another plugin's route (one that doesn't hold the vault), as `client`, for request `req`: its Markdown answer, or an OpError/ToolError saying why not.
- `mcp:upload-link` (mcp): A one-time link an internet app's sandbox PUTs a file's bytes to (file.upload without the file), or null when the vault isn't on the internet.
- `me:file` (me)
- `obsidian:stand-ins` (other-apps)
- `page-head` (dashboards): A dashboard's subtitle under its title ("{date}" is today's date), for /api/render.
- `pages:installed` (pages)
- `pins:installed` (workspaces): Pages just pinned in the vault's list because their plugin brought them (Pinned, when they're installed): a workspace with a list of its own gets them too, at its end, so a plugin turned on shows its pages wherever you are.
- `pins:of` (workspaces): Workspace n's pinned pages, for Pinned's ops (`vau pin`): its own list (null: pages.json's, until its first change) and one change to it.
- `property-types` (other-apps)
- `provenance:user` (provenance): What the user said or wrote, made by another plugin's backend (Inbox's voice notes): the label to give it.
- `provenance:agent` (provenance): And what an agent's are labelled (an AI app's note for the inbox).
- `sidebars:of` (workspaces): Workspace n's sidebars, for the core's panel ops (`vau panels`): its own setup (null: sidebars.json's) and how to save one.
- `tabs:open` (workspaces): Every place open in any workspace's tabs, as this machine has them, for "tabs:open": a terminal shown in a workspace nobody's looking at isn't idle.
- `templates:folder` (templates): Its folder's notes are patterns: the vault never reads them as items (a `type: person` template isn't a person).
- `terminal:<…>` (meters, locate, runs, of, of-pids, info): agent-meters; terminal
- `text:<…>` (canvas, docx, epub, fb2, pptx, base, csv): canvas; documents; ebooks; presentations; query; tables
- `widgets:refresh` (inbox): Another plugin's data the widgets show changed (a routine ticked).
