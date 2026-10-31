## Plugin API reference
Written from the code's own doc comments (tools/plugin_api_doc.ts), so it's what this version has. How to write a plugin:
`vau docs vault-plugins`; every name each module has, with its parameters: `vau docs plugin-api-names`.

### The server: `plugin.ts`
`import { Plugin } from "@vaultite/core/plugins.ts"`, then `export const plugin = new Plugin(import.meta.url)`.

- `plugin.vault`: The vault (set by the loader).
- `plugin.blocks`: Its blocks as manifest.json declares them (core/blocks.ts): name -> description and options.
- `plugin.route(method, pattern, fn, options)`: `pattern`: a path under /api/, * one segment, a last ** the rest. `lock: false`: runs ops itself or waits on something slow (holds the vault only to write); `sync: false`: reads no vault (a hook); `stream: true`: body unread (uploads).
- `plugin.op(def)`: An operation, served as `POST /api/ops/<id>`, `vau <id>`, MCP and the docs (core/ops.ts). Its id starts with the plugin's id or a kind it owns. Only while the plugin is on.
- `plugin.serve(prefix, fn)`: GET /<prefix>/<rest> outside /api/, for what a browser loads by address (an artifact's sandboxed frame at /v/...). Only while the plugin is on; the vault isn't synced first and onRequest doesn't hear of it.
- `plugin.socket(pattern, fn, opts)`: A WebSocket at /api/<pattern>. `opts.accept` runs before the upgrade and refuses it by throwing an HTTPError. Sockets of a plugin that's off are refused.
- `plugin.block(name, fn)`: fn(ctx) -> Markdown: what ```block-<name> shows as text, for AIs (GET /api/render). Every block the app draws has one (npm run check); ctx.options has the manifest's declared defaults filled in.
- `plugin.onUnload(fn)`: fn() runs when the plugin is unloaded: a vault plugin turned off, or changed (it's loaded again). Stop timers and close what it opened here.
- `plugin.unload()`: Unload it: off the vault, and its onUnload functions run.
- `plugin.onSync(fn)`: fn(vault) runs after every sync of the vault (before each request, and when files change on disk: core/live.ts), to follow the files themselves (File history keeps their earlier versions). Keep it cheap: it runs often.
- `plugin.onMove(fn)`: fn(from, to) when the API moves, restores or trashes a file (to: null; `trashed`: where it went), so what the plugin keeps follows; even while it's off. Moves on disk (Finder, iCloud) aren't heard.
- `plugin.onCreate(fn)`: fn(path, fm, writer) before the API writes a new Markdown file: the keys it returns are added (the file's own win). `writer` is who asked (null for no request). Only while on; files written on disk aren't heard.
- `plugin.onSave(fn)`: fn(path, now, was, writer) before the API saves new text ({fm, body}) over a Markdown file's (`was`): the keys it returns are set in that text, in the same write. Only while on; files written on disk aren't heard.
- `plugin.onWrite(fn)`: fn(path, before, after, writer) after a request wrote a Markdown file outside .vaultite/ by any route or op (`before` null: new). Runs inside the write, so quick; only while on; files written on disk aren't heard.
- `plugin.onCreateFile(fn)`: fn(path, file, writer) before the API writes a new non-Markdown file: `file` (NewFile) is read-only and read only as far as asked, as an upload can be any size. Only while on; files written on disk aren't heard.
- `plugin.onArchive(fn)`: fn(path, archived) when the API archives or unarchives an item (`archived` set or changed in a write): the folder its file moves to (links follow, like a move), or null to leave it. Only while on (the Archive plugin's).
- `plugin.onRequest(fn)`: fn(start) as each API request starts; the function it returns runs when it's answered. Keep it cheap and never throw: it runs for every request.
- `plugin.onChange(fn)`: fn(paths) runs after files in the vault changed on disk and were read (the app's own writes too: they come back from the watcher like anyone's), with their vault paths, or null when the watcher couldn't say which.
- `plugin.onServerError(fn)`: fn(error) for each error the server logs, with its request. Runs synchronously and isn't heard again for its own errors: write what you keep at once, never throw.
- `plugin.onEvent(filter, fn)`: fn(event) for each event of the vault matching `filter` (core/events.ts: `types`, a type or an area, "file"; `path`, a vault path prefix), only while the plugin is on. Keep it quick: events come from every write.
- `plugin.around(ops, fn)`: fn around every op matching `ops` (an id, an area "note" or "note.*", "*"), the outermost first by plugin order: rewrite, answer or refuse what agents, the CLI and other plugins ask. The app's own edits are routes, not ops.
- `plugin.every(name, when, fn)`: fn on a server timer: `every` "15m", "2h", "1d", "1w", or `at` "07:00" (local) with whole days; `machine` a Machines id (else the first). One run at a time; a name again replaces it, `when` null removes it.
- `plugin.host`: The core's operations and events, for this plugin's vault (core/app.ts gives them).
- `plugin.runOp(name, params, who?, http?)`: Run an op of the catalog (any plugin's, by id or CLI name) as `who` (else the request's), for the request `http` (req.http: pass it, so owner checks apply): plugin.host.call.
- `plugin.emit(type, data)`: Tell the vault's events something happened: its type is `<plugin id>.<name>` ("finance.imported").
- `plugin.state(fn)`: fn() -> a record merged into /api/state. Default: each of the plugin's kinds as {collection: items}.
- `plugin.folders(fn)`: fn() -> the folders on this machine its live data is read from (absolute): a block's menu offers to open them (POST /api/file/open opens these and nothing else outside the vault).
- `plugin.liveFolders()`: Its folders that are there now.
- `plugin.settings(fallback?, file)`: Its settings (data.json); `file`: a file of its own for a part written often, so devices collide less.
- `plugin.seeded(file)`: This plugin's settings with the defaults another app's settings give them under its own (Vault.configWithDefaults): what applies; never saved back (settings() is what's written).
- `plugin.readSettings(file)`: The settings as they are on disk now, for a read-modify-write: null when there's none; throws ConfigError (from core/vault.ts) when the file is there but can't be read or doesn't parse, which settings() would take for empty.
- `plugin.saveSettings(data, file)`: Write the settings (null removes the file).
- `plugin.patchSettings(changes, { nullRemoves)`: Change some keys (null removes one unless `nullRemoves` is false); returns the settings after. A declared one's value is checked against its manifest declaration (400).
- `plugin.localKeys(file)`: The keys its manifest marks `local`, and who may reach it (ACCESS) whatever it marks: this machine's (core/trust.ts), never read from or written to the vault.
- `plugin.dayLog(kind)`: A log of JSON lines in localDir(), a file a day (<kind>-<date>.jsonl): appended at once (an error that ends the server is on disk first), read and rewritten by day, days older than `keep` pruned at most hourly.
- `plugin.desktop(name, ...args)`: Ask the desktop app's browser engine (an `agent:` call, electron/browser/agent.ts): the one attached to this server, else an always-on machine's serving this vault (`machines:desktop`); fails when there's none.
- `plugin.onDesktopEvent(fn)`: fn(name, data) hears what this server's desktop app tells it unasked (a live view's frames), till it's unloaded.
- `plugin.localDir(make)`: Its folder on this machine for this vault, <LOCAL>/<id>/<vault key>/ (disposable, never synced): made unless `make` is false, with vault.txt naming the vault.
- `plugin.cachePath()`: .vaultite/cache/<id>.json in the vault (the vault's folder when run on its own, like the GitHub refresh).
- `plugin.secrets()`: This machine's data/config.json (private URLs, keys). Never copy these into the vault.
- `plugin.saveSecrets(data)`: Sets this plugin's own key in data/config.json (`secrets()[plugin.id]`; null removes it), the rest as it is. The file is readable by this machine's user only.
- `plugin.refusal(req, what)`: Why this request may not have what only this machine's owner may (a shell, the screen), or "" (core/owner.ts). Reads the plugin's `allowUsers` and `allowRemote` from this machine only (core/trust.ts): a vault's never lets anyone in.
- `plugin.ownerOnly(req, what?)`: Throw 403 unless this request is this machine's owner's (refusal); one made in-process (no `http`) is.
- `plugin.allows(what)`: Whether this machine's owner said yes to `what` (a command a vault setting names: a synced or shared vault mustn't choose what runs here). Kept on this machine, never in the vault (core/trust.ts).
- `plugin.allow(what)`: Remember this machine's owner said yes to `what` (only after asking them: plugin.refusal).
- `plugin.memo(ttl, fn, ...args)`: fn(...args), remembered in memory for ttl seconds (live data: fetched again when it's stale). A failure isn't.
- `plugin.memoStale(ttl, fn, ...args)`: Like memo, but once stale it answers what it had while fn runs again: a slow fn (asking machines that may be offline) never holds a caller after its first answer.
- `plugin.forget()`: Forget everything memo() remembers.
- `plugin.editLine(rel, n, was, now)`: A small edit of one line of a vault file: line `n` (from 0, the whole file's, frontmatter too) from `was` to `now` (a list: several lines in its place; null: removed). 409 when that line isn't `was` any more (edited meanwhile).
- `plugin.peer(id)`: Another loaded plugin (one this plugin requires), to use what it offers: logs.exports.areaSummary(...), or its settings: plugin.peer("templates")?.settings().
- `plugin.propertyTypes()`: The vault's property types (propertyTypes, below).
- `plugin.isOff()`: Whether this plugin is off (Vault.switchedOff, what it requires too): its routes still answer, so one that mustn't checks.
- `plugin.service(name)`: The service `name` of a plugin that's on (plugin.provide), or null: what this plugin asks of others without naming them (Terminal runs a coding agent through "agent:<name>", whoever brings it).
- `plugin.allServices(name)`: Every plugin that's on's service `name`, in plugin order: what many may offer at once (MCP's cards, "mcp:apps").
- `plugin.ask(name, fallback, ...args)`: The service `name`'s answer (`args` passed), or `fallback` when no plugin that's on provides it or it fails.
- `plugin.docs()`: Its docs (core/docs.ts): its AGENTS.md, then settings, blocks and operations generated from the manifest and ops, so what AIs read is what the app checks. null when it has none.

What it gets: a route's `req`: `method`; `parts`; `query`; `body`; `wild`; `rawPath` (A served address's rest (plugin.serve), as it was sent: not decoded, with its query string ("npm/x@1/y.js?z")); `http?` (The HTTP request it came in (its headers, its socket), when it came over HTTP (server.ts); undefined when the API is called in-process (tests)); `arg` (The i-th wildcard segment of the route (already URL-decoded)). A block's `ctx` (plugin.block): `vault`; `path`; `fm`; `body`; `options`; `today`; `host?` (Drawn inside an embed (`![[Note]]`): the note embedding it, the nearest one); `source` (Name the files it shows (items, or vault paths): "Show source" on the block leads to them (core/sources.ts)).
`plugin.vault.entries` maps each Markdown file's path to its entry: `rel`; `stat`; `kind`; `fm`; `body`; `bodyLine` (The file's line (0-based) the body starts on, past the frontmatter and blank lines); `item`; `problems`; `broken`; `type` (Its type, one rule for the whole app (core/fileprops.ts): its kind's when a kind owns it, else its frontmatter's); `archived` (`archived: true` in its frontmatter, or in an archive folder (core/fileprops.ts)); `tagCache`; `tags` (Its tags: frontmatter `tags` and inline #tags in the body (core/sections.ts), worked out once per read). A kind of file,
`plugin.kind(new Kind({...}))`: `type` (the frontmatter `type:` (person, note, log...)); `collection` (its name in /api/state and the API (people, notes, logs...)); `folder?` (its usual folder ("People"; "Logs" holds subfolders when recursive is true): only where its first file goes (Vault.home)); `label?` (what settings call its files ("Daily notes"; else its collection's name)); `owns?` (files it claims without a `type` (a daily note by its name in its folder): asked at each sync, so keep it cheap); `file?` (or a single file ("ME.md", in any case; a function when a setting names it), its kind with or without a `type`; elsewhere, the one file of its type); `recursive?`; `titleKey?`; `parse` (file -> [item, problems] (the vault adds `id` and `modified`, a local stamp)); `render` (item -> [owned frontmatter, body]; keys the file has beyond `owned` are kept); `filename?` (path relative to the vault, without .md (default: <folder>/<safe name of item[titleKey]>)); `key?` (a value that identifies the item for upserts (POST with the same key updates it), or null); `prepare?` (before a write: fill timestamps, geocode..); `fill?` (after the app wrote the file for someone (an edit in the app, a new file; before = what it was): an item to write back with fields filled in (ids, dates), or null); `order?` (sort for /api/state (default: by id)); `merge?` (an update: the old item with the patch's fields on top (a kind can merge nested fields, like log data)); `blocks?` (its files' blocks (["person"]: ```block-person), or a function of its frontmatter: written on top of a new file, and by `vau type --apply` and `vau migrate`; only what a file places is drawn); `sections?` (`## ` headings its files' view draws instead of their text (["timeline"]): only in its files, never in any note); `stamps?` (frontmatter keys the app keeps as local times (stamp: "YYYY-MM-DD HH:MM:SS"): shown, not edited by hand). One frontmatter key in a file's text:
`setPropertyText` (`@vaultite/core/vault.ts`).

### What it is: `manifest.json`
The app's own manifest keys (a vault plugin's are in `vau docs vault-plugins`).

- `id` (required)
- `name` (required)
- `description` (required)
- `icon`: Its icon, wherever it's listed (and in the directory before it's installed): a Lucide name ("heart-pulse"), one a plugin adds ("claude": `icons`), or an SVG file in its folder ("icon.svg", a mark in one colour: drawn in the text's).
- `requires`: Can't work without these plugins: off while any of them is off. It may import the modules they export.
- `exports`: Modules plugins that require it may import, by path in its folder without extension (["types"]): theirs as `@plugins/<id>/types`, in index.tsx and plugin.ts alike, the same instance as its own.
- `enhances`: Uses these when they're on (optional).
- `runsOnServer`: Reads files or runs programs on the server's machine (an agent's, a CLI); it shows on every device through it.
- `desktopApp`: Works only in the desktop app on a Mac (other apps' windows, the Dock): elsewhere it's listed and does nothing, and the web demo keeps it off.
- `tint`: Its colour, a named one ("orange", "teal": --orange...): the app makes --<id> of it (--today), which its pages, files and cards use (`tint: today` in a dashboard) and a colour scheme may set to something else.
- `category`: Its category on Setup's Plugins tab and in Settings ("life"; "ai-apps" for an outside AI it reads, "agents" for AI tools: core/categories.ts); none or unknown: Other.
- `blocks`: Every block it draws (`blocks` in its definition), what it shows and its options (core/blocks.ts). The core checks a block's options against it (a quiet note while editing), fills in its defaults, and lists it for AIs.
- `draws`: Blocks another plugin declares that it draws too, picked by their `by` option (`block-agent-usage` with `agent: codex`): it draws each in its definition and as text, like its own.
- `settings`: Its settings (.vaultite/plugins/<id>/data.json), typed like a block's options plus a label each (core/blocks.ts SettingDecl): its settings sheet draws them as a form, and its docs list them (`vau docs <id>`).
- `offByDefault`: Off until the user turns it on (plugins.json `enabled`), for a plugin that changes how everything behaves (Vim), and every built-in that isn't `essential` or `alwaysOn` (bundles turn them on). The server keeps its backend off too (Vault.switchedOff).
- `essential`: One of the app's own (built-in only), on from the start. The other built-ins are off until turned on (`offByDefault`, or by a bundle). Either way Setup's Plugins tab lists it by its category.
- `alwaysOn`: Part of the app itself (built-in only): always on, no switch, not on Setup's Plugins tab; its settings are in Settings. Neither `essential` nor `offByDefault`.
- `group`: Listed on Setup's Plugins tab in one row with the rest of its group ("coding-agents": core/categories.ts GROUPS), which says which are on and opens a sheet of their switches; each keeps its own.
- `switchIn`: Its switch is a row in a Settings section instead of on Setup's Plugins tab ({"section": "editor", "label": "Vim keys"}: core/categories.ts SWITCH_SECTIONS), its settings a gear away (built-in only).
- `replaces`: Other apps' plugins it stands in for, by app ({"obsidian": ["dataview"]}; "*": it runs any of them). Two opt-in plugins standing in for the same one are alternatives: turning one on turns the other off.
- `marks`: Frontmatter keys that type a file without `type:` ({"kanban-plugin": "kanban"}: core/fileprops.ts setMarks).

### The app: `definePlugin({...})` in `index.tsx`
`import { definePlugin } from "@vaultite"`; every key is optional (its icon is its manifest's).

- `icons`: Icons it adds by name: a file's `icon:` can name them (a dashboard's `icon: claude`), and other plugins draw them with iconNamed("claude") (the plugin API) without importing it.
- `details`
- `search`: What the quick switcher and the search tab find by name: its things, from the store.
- `searchLive`: Things it finds that aren't in the store (running terminals): `docs` is asked whenever search looks, and `subscribe` says when they change while search is open.
- `searchQuery`: What the quick switcher finds by the query itself, too many to index (the browsing history).
- `links`
- `webLink`: Web links clicked in the app: true when it opened one itself (the Browser), false to leave it to the system browser. The first plugin that's on and takes it wins. `how`: plain, a new tab (behind, or `front`), or `out` (⌥⌘).
- `schemeLink`: Links of another app's scheme clicked in the app (`<app>://open?file=…`, `zotero://…`): true when it took one. The first plugin that's on and takes it wins; none: the link does nothing.
- `preview`: What the Plugins sheet shows, with made-up data: a render, or the id of the plugin whose dashboards (pages/*.md) to show (a plugin whose blocks are on Projects previews "projects"). Defaults to its own dashboards.
- `mock`: Made-up data for previews: its keys of the store (what its plugin.ts puts in /api/state), made from the real store where that's configuration, not personal data (the logs' areas).
- `mockLive`: Made-up answers for its live routes in previews, by path ("calendar": {events: [...]}).
- `files`: How its files look when opened (see FileView).
- `formats`: Kinds of files it draws, by extension (see FileFormat).
- `fileFormat`: A format for one Markdown file, decided by the file as it opens (a hosted plugin taking a note's leaf: Kanban's boards); null leaves it to the app. Wins over `formats`; its source view is still the file's text.
- `blocks`: What it draws where a file has a ```block-<name> fence (YAML options inside). Each is declared in its manifest and has a text side in plugin.ts, for /api/render: `npm run check` holds the app's plugins to both.
- `fences`: Code fences it draws by language (```base). Its backend reads one as text with the service `fence:<lang>`.
- `ask`: It answers a question about a file (an AI chat): a live answer's follow-up buttons ask it (`askAbout`).
- `timeline`: Kinds of timeline entries it knows ("call": a phone icon), for the `## Timeline` sections kinds draw (a person's).
- `views`: Tabs it can open that aren't files (see ViewDef), by name: `view:<name>`.
- `agents`: Coding agents it brings, by name (see AgentDef): the Terminal plugin runs them.
- `commands`: Its commands, listed in the command palette while it's on. One that switches something says what it does now (`on`, `nameWhenOn`), never "Toggle"; its manifest's boolean and enum `settings` get their commands on their own.
- `editor`: What it adds to every editor (see EditorExtension).
- `reading`: How a note's blocks draw while it's read (see ReadingBlocks).
- `slash`: Its entries in the editor's slash menu (see SlashItem). Every plugin's blocks are offered there already.
- `sidebar`: Its panels in the desktop sidebar, by name (see SidebarPanel).
- `header`: What it draws in the desktop sidebar's header, by name (see HeaderItem).
- `status`: What it draws in the status bar, by name (see StatusItem).
- `ambient`: What it draws in the status bar whatever is open, by name (see AmbientItem).
- `fileBar`: What it draws in a file's header, by name (see FileBarItem).
- `noteTop`: What it draws at the top of a note's page, by name (see NoteTopItem).
- `textSizes`: Content with a text size of its own apart from the app's zoom (core/textsize.ts), by id: it gets ⌘+scroll (`useTextSizeWheel`, while Pinch to resize text is on), commands and a Settings row; the view reads `useTextSize(id)`.
- `keyGroups`: Names for the first steps of its commands' key sequences, which the keys hint shows while one is under way (`{"Space F": "Files"}`; steps spelled as in `keys`).
- `sidebarSetup`: Keeps the sidebars' setup itself, instead of sidebars.json (see SidebarSetup).
- `conventions`: Where new files go and how links are written, as the vault says (see Conventions).
- `openElsewhere`: The places open in tabs it keeps off screen (other workspaces' tabs), so closing a tab here doesn't end what it shows (a terminal's shell) while one of those still has it.
- `workspace`: Keeps workspaces (see WorkspaceHost): one plugin at a time, the first that's on.
- `fileMenu`: Items it adds to a vault file's menu, wherever it shows (the tree, a tab, the file's view, an embed, a canvas card), for that file's path; [] for none.
- `viewMenu`: Items it adds to a view's menus (its tab's, a terminal's row), for its tab's target ("view:terminal/abc"); [] for none.
- `editorMenu`: Items it adds to a text editor's right-click menu (desktop), for that editor (`path`: its file); [] for none.
- `folderMenu`: Items it adds to a folder's menu in the file tree, for that folder's path; [] for none.
- `containers`: The containers its web pages open in (see WebContainer).
- `webPageActions`: Items it adds to a web page's bar in the Browser (see WebPageAction), for the page shown; [] for none.
- `fileMarks`: Marks on files in the file tree, by path, from the store (keep it to the few files that need one).
- `fileIcons`: Icons it gives files and folders, by path, from the store, wherever the app draws a file's icon (the tree, tabs, lists); a file's own `icon:` wins. The first plugin's wins.
- `fileRows`: Rows of the file tree it draws into itself, by path (see FileRow); call `fileRowsChanged()` when they change. Keep a row's object the same while it says the same: only rows whose object changed are drawn again.
- `home`: Where a device's first tab goes and where a phone with nowhere to be goes: a tab target, or null. The first plugin that's on and answers wins; with none, a new tab.
- `newTab`: Sections it adds to a blank tab's page, by name ("<plugin id>:<name>", arranged in newtab.json).
- `settingsPages`: Its pages in Settings' list, by name, beside the app's own (Connections' AI apps): for setting the app up, not a plugin's options (those are its settings).
- `settingsPanel`: Its settings, for what a form from its manifest's `settings` can't say: `SettingRow`s in `Group`s, no `Panel`s. Drawn after its declared settings (a short option above a list that grows), unless `settingsPanelFirst`.
- `settingsPanelFirst`: Its settingsPanel above its declared settings: when the panel is what the sheet is for (Import, Connect).
- `settingsSearch`: What its settingsPanel has, for the Settings page's search (its manifest's `settings` are found by themselves).
- `newFiles`: Kinds of files it makes, in the New submenu after New note in the file tree's menus (see NewFile).
- `player`: Plays audio and video wherever the app shows them (a file's tab, an embed), instead of the browser's bare player: the first plugin that's on wins.
- `onMove`: A file or folder was renamed or moved (to `to`) or trashed (null), here or elsewhere (another device, an AI): what it keeps by path in the app follows. Its server side has plugin.onMove. It may hear one move twice.
- `answers`: What its ops ask the user's window (`ctx.ui({action: "<plugin id>:<name>"})`), by name: the result goes back as the op's, a thrown error's message as its error. `ended` aborts when the op stops waiting.
- `background`: Runs while it's on, drawn nowhere, in every open window and device: listen and draw there (Workspaces keeps tabs in step), never write on a timer. What must happen once is the server's: plugin.every. Return null.

### Services the app's plugins offer
`plugin.ask("<name>", ...args)` (`plugin.provide` to offer one): by name, never by plugin.

- `activity:typing` (activity): An agent types into `path` in the app for `ms` from now (0: it's done): the app's saves of it meanwhile are its.
- `activity:report` (activity): The command for a coding agent's hook to report what it did (Terminal passes it to the agent it starts: AgentStart `report`): it sends the hook's JSON (on stdin) here, with the agent's name and its terminal. Never fails the hook.
- `activity:report-url` (activity): The same as a URL its hook POSTs the JSON to, for an agent whose hooks can (Claude Code's http hooks on Windows).
- `activity:changes` (activity)
- `agent:claude` (claude-code)
- `agent:codex` (codex): `codex`, or `codex resume <id>` in its folder, with the model given. No context or hooks: any `-c` makes it run without its shared background server (it reads AGENTS.md itself), which only an effort (no flag) or commands allowed cost.
- `agent-asking:claude` (claude-code): What a session waits on ("agent-asking:claude", the Inbox shows it whole): its AskUserQuestion or plan, else a dialog its terminal shows, as a question (not a permission: Approve and Deny answer it). Never a private account's.
- `agent-asks:claude` (claude-code)
- `agent-asks:codex` (codex): Its dialogs, seen on its screen, by their last lines: Approve and Deny press these keys, and before 0.163 (no OSC 7501, no hooks) they're its only blocked state. Folder trust, its default Trust; a command or edits, Yes, Esc No.
- `agent-meters:claude` (claude-code)
- `agent-meters:codex` (codex): Its sessions in the app's terminals, by terminal (the service "agent-meters:codex"): the Terminals list's session ids. No meters: its rollouts don't say when a prompt cache expires.
- `agent-mode:claude` (claude-code): The permission mode a session runs in now (the service "agent-mode:claude": what a subagent it delegates to may have at most): the chat's, else its transcript's last. The session in `terminal` when `session` isn't given; null: unknown.
- `agent-mode:codex` (codex): The mode a session runs in now, from its last turn's sandbox and approvals (the service "agent-mode:codex"): what a subagent it delegates to may have at most. The session in `terminal` when `session` isn't given; null: unknown.
- `agent-model:claude-code` (claude-code)
- `agent-models:claude` (claude-code)
- `agent-models:codex` (codex): The models its picker lists (its cache of them, $CODEX_HOME/models_cache.json), and the efforts all of them take.
- `agent-pick:claude` (claude-code): The keys answering its questions with `choices` ("agent-pick:claude"): a digit picks (in a multi-select toggles, Tab goes on), the one after the options types an answer; 1 submits the review several questions or a multi-select end in.
- `agent-session:claude` (claude-code): A session's last response and how long its prompt cache lasts (the service "agent-session:claude": the Inbox resumes it while cached). The TTL is an hour when its last responses wrote 1 h cache, else five minutes.
- `agent-turn:claude` (claude-code): A session's latest turn: the user's last message and Claude's last answer (the service "agent-turn:claude": the Inbox reads it as a turn ends). The session running in `terminal` when `session` isn't given; never a private account's.
- `agent-turn:codex` (codex): A session's latest turn: the user's last message and Codex's last answer, and the session's title (the service "agent-turn:codex": the Inbox reads it as a turn ends). The session running in `terminal` when `session` isn't given.
- `companion:who` (companion): The agent whose session runs in app terminal `terminal`, as Provenance names who wrote a line: its name, colour, and the model and effort it was started with; null when it's no companion's.
- `companion:guest` (companion): A guest's app's socket (the share's gateway checked who and what): their threads, and what they say in them.
- `context` (pages, workspaces): What `vau context` says of it: the pinned pages the user's window shows.
- `delegate:lineage` (delegate)
- `fence:<…>` (genui, chart, base): genui; query
- `file-props` (provenance): Other files' `origin` for database views over every file (a .base): the list's, else what the bytes say.
- `geocode` (people): A place's pin, [lat, lon] or null: looked up once (Nominatim), then cached. Me uses it for ME.md's place.
- `geocode:known` (people): A place's cached pin without looking it up: [lat, lon], null (not found) or undefined (not looked up yet).
- `history:versions` (history)
- `history:text` (history)
- `history:keep` (history): Keep a file's text as it is now as a version, whatever the interval: what an agent is about to change (Provenance's review compares with it). Sync, so it runs before the write.
- `history:changed` (history): The files followed whose text was last written at or after `since` (ms).
- `html:guest` (html): A page as a shared folder's guest gets it (plugins/core/share), at their path for it, nothing of the user's (name, Claude, what it kept), and the wrapper framing it: the guest's gateway serves both, with its own policies.
- `inbox:folder` (inbox): Where results go (where the Inbox's files are, else Inbox/): the clipper asks (its `inbox` option), only while this plugin is on.
- `inbox:needs` (inbox): Whether an agent's session (by its terminal, or its own session id) has a thread that needs the user, unread: Terminal's list says so (its tab's dot, Terminals' first rows).
- `inbox:state` (inbox): Terminal's stream of its terminals' states.
- `inbox:session` (inbox): Tell the inbox a session's state (SessionState): the thread it's in, once worked out (a turn's end is judged first).
- `inbox:handed` (inbox): Dispatch marks the terminals it starts.
- `inbox:event` (inbox): Add an event from another plugin's backend or the core (what it would POST); returns it.
- `inbox:drop` (inbox): Take away the event of this source and key (what it said isn't so anymore).
- `inbox:done` (inbox): Mark the event of this source and key done (the core's notice of a paused plugin, once it's allowed again).
- `inbox:ask` (inbox): Ask the user's permission for something the server would do: a waiting event with Approve and Deny (phone and watch too), answered by the owner only. Returns its id; "inbox:answer" waits for the answer.
- `inbox:answer` (inbox): A gate's answer (approve, deny), or "waiting" once `ms` passed without one; "gone" when the event isn't kept.
- `links:canvas` (canvas)
- `log-areas` (logs)
- `logs:areas` (logs): The areas as the app has them (Today's routines take their icon and weekly goal).
- `looks:csv` (tables)
- `machines` (machines)
- `machines:machine` (machines)
- `machines:self` (machines)
- `machines:vault` (machines)
- `machines:ids` (machines)
- `machines:desktop` (machines): What plugin.desktop does on a server with no desktop app attached.
- `machines:browser` (machines): The machine whose browser this server's agents use (its tabs' numbers are that browser's): this one, or null.
- `machines:fs` (machines)
- `mcp:<…>` (tool, app-host, upload-link, apps): mcp; mcp-apps
- `me:file` (me)
- `note-dates:stamps` (note-dates): The dates it keeps in a file (path, fm): any edit moves them, so they're no one's change (Review leaves them out).
- `obsidian:stand-ins` (other-apps)
- `pages:installed` (pages)
- `pins:installed` (workspaces): Pages just pinned in the vault's list because their plugin wrote them, turned on (Pinned): a workspace with a list of its own gets them too, at its end, so a plugin turned on shows its pages wherever you are.
- `pins:of` (workspaces): Workspace n's pinned pages, for Pinned's ops (`vau pin`): its own list (null: pages.json's, until its first change) and one change to it.
- `property-types` (other-apps)
- `provenance:user` (provenance): What the user said or wrote, made by another plugin's backend (Inbox's voice notes): the label to give it.
- `provenance:agent` (provenance): And what an agent's are labelled (an AI app's note for the inbox).
- `provenance:wrote` (provenance): What an agent wrote that the app saves for it (the companion's edits, typed in the window): the request's agent.
- `provenance:by-guest` (provenance): Whether a shared folder's guest wrote line `line` (1-based, frontmatter counted) of a note as it is now.
- `provenance:authored` (provenance): Lines agents wrote in a note between two times that are still there, by who: the day's recap says them.
- `sample` (claude-code)
- `setting-defaults` (other-apps)
- `share:public` (share)
- `share:upgrade` (share)
- `share:gateway` (share)
- `share:folders` (share): The folders shared now (not expired): the vault's other machines type in their notes here, with the guests.
- `sidebars:of` (workspaces): Workspace n's sidebars, for the core's panel ops (`vau panels`): its own setup (null: sidebars.json's) and how to save one.
- `tabs:open` (workspaces): Every place open in any workspace's tabs, as this machine has them, for "tabs:open": a terminal shown in a workspace nobody's looking at isn't idle.
- `templates:folder` (templates): Its folder's notes are patterns: the vault never reads them as items (a `type: person` template isn't a person).
- `terminal:<…>` (meters, access, waits, state, agent-waits, screen, locate, runs, agent-env, of, of-pids, info): agent-meters; terminal
- `text:<…>` (canvas, docx, epub, fb2, pptx, base, csv): canvas; documents; ebooks; presentations; query; tables
- `widgets:refresh` (inbox): Another plugin's data the widgets show changed (a routine ticked).
