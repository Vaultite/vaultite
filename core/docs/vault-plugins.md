## Vault plugins (your own features)
When the user wants something the app doesn't do (a Finance page, a tracker of their own), a Markdown page, a CSV or an
HTML page is often enough. When it needs its own kind of file, blocks, an API route or live data, write a vault plugin
(every method, key and name the API has, from the code: `vau docs plugin-api`):
a folder `.vaultite/plugins/<id>/`, the same shape as the app's plugins. `vau plugin new <id>` makes a working one.

**`manifest.json`**: `{"id" (= the folder's name, not one the app has), "name", "description", "icon", "version": "1.0.0",
"author", "repo": "owner/name", "fundingUrl", "disclosures", "requires": [plugin ids it can't work without],
"enhances", "runsOnServer", "tint": "green", "category": "life", "apiVersion": 3, "minAppVersion": "0.1.0", "forAgents",
"blocks", "settings", "replaces", "userFiles", "marks", "writes"}`. A folder with only `data.json` is settings, not a plugin.
- `version` (semver), `author`, `repo` (its GitHub repository) and `fundingUrl` (https): shown in its sheet; one to
  install from GitHub needs `version` and `repo`.
- `disclosures`: what it does beyond the vault, shown before anyone allows it: `{"network": ["api.example.com"],
  "shell": true, "outsideVault": true, "clipboard": true}` (hosts it talks to, `"*"` for any its settings name, like a
  sync's server; runs programs; reads or writes files outside the vault; reads the clipboard). Say all of it: `{}` is a
  promise of none.
- `marks`: frontmatter keys that give a file without `type:` a type (`{"kanban-plugin": "kanban"}`: boards another app
  made, drawn by this plugin's `files: { types: ["kanban"] }`).
- `userFiles`: files in its folder it writes as the user's own (`["init.vim"]`): editing them isn't a new version to
  allow, and updates keep them. Data, never code.
- `replaces`: other apps' plugins it stands in for, by app (`{"obsidian": ["dataview"]}`: the app whose
  `.obsidian/` folder a vault has): someone coming from that app is offered it for theirs (`vau other-apps plugins`).
- `runsOnServer`: it reads files or runs programs on the server's machine (its Plugins sheet says so); plugin.ts alone
  doesn't make it so.
- `icon`: how it looks wherever it's listed, and in the directory before anyone installs it: a Lucide name
  (`"heart-pulse"`, lucide.dev/icons) or one the app adds (`"claude"`, `"github"`), or a brand's mark as an SVG file in
  its folder (`"icon.svg"`, at most 16 kB): one colour, drawn in the text's colour. None: a puzzle piece.
- `tint`: a named colour (`red`, `orange`, `yellow`, `green`, `teal`, `blue`, `indigo`, `purple`, `pink`, `gray`); the app makes
  `--<id>` of it, so its dashboards can say `tint: <id>`. Those names are the app's colours: `text-[var(--green)]`.
- `category`: its Plugins page section: `navigation`, `writing`, `life`, `health`, `agents`, `developer`, `formats`,
  `system` (else Other).
- `apiVersion` / `minAppVersion`: the plugin API and oldest app it needs (`app.api` and `app.version` in
  `GET /api/state`); one asking for more isn't loaded, and its `problems` say so.
- `forAgents`: one line every agent reads while it's on (in `.vaultite/AGENTS.md`, MCP's instructions and a terminal
  agent's context), at most 240 characters: only what an agent must know up front ("A purchase the user mentions:
  `finance.add`."; an op's id is said as its MCP tool's name there). `{key}` is that setting's value. Formats go in its
  `AGENTS.md`.
- `blocks`: every block its `index.tsx` draws: `{"finance": {"description": "this month's spending by category",
  "options": {"months": {"type": "number", "default": 1, "description": "how many months back"}}}}`. `type` is
  `string`, `number`, `boolean`, `list`, `map` or `enum` (with `values`), or a list of them; optional `default`, `min`,
  `max`, `required`; descriptions are one lowercase line. The app checks blocks' options against it and suggests them.
- `settings`: its `data.json`'s keys, in the same words plus a `label` (sentence case), for an enum `labels`, and for a
  vault folder (a string, or a list of them) `"folder": true`, which the form picks from the vault's:
  `{"months": {"type": "number", "default": 3, "min": 1, "label": "Months shown", "description": "how many months the
  summary covers"}}`. Its settings sheet draws them as a form; `default` is what it does when the key is left out.

**`plugin.ts`** (optional; the server, Node, TypeScript as-is: no enums, `import type` for types, imports name the
`.ts` file): `import { Plugin } from "@vaultite/core/plugins.ts"`, `export const plugin = new Plugin(import.meta.url)`,
then `plugin.kind(new Kind({...}))` (a kind of file; `Kind` from `@vaultite/core/vault.ts`), `plugin.route("GET",
"finance/summary", (req) => ({...}))` (at `/api/finance/summary`), `plugin.serve("<prefix>", fn)` (addresses outside
`/api/` with their own headers), `plugin.block("<name>", (ctx) => "Markdown")` (the block as text, for `/api/render`),
`plugin.settings()` (its `data.json`; `plugin.settings({}, "<name>")` another file of its own, `<name>.json`, for
what's written often in parts; another's: `plugin.peer("<id>")?.settings()`; plugins.json:
`plugin.vault.config("plugins")`; never read them from disk), `plugin.provide("<name>", fn)` (a service others ask for
by name), `plugin.memo(ttl, fn)` / `plugin.writeCache()` for live data, `plugin.onUnload(fn)` to stop timers. It may
import only `@vaultite/core/plugins.ts`, `vault.ts`, `client.ts`, `timeline.ts`, its own folder, Node's modules and
npm packages the app has (so may its other modules, the ones `index.tsx` doesn't import); a required plugin through `plugin.peer("<id>").exports`. The vault's files: `plugin.vault.entries`
(each Markdown file's path, `fm`, `tags`...), and any file's text by `fs` at `plugin.vault.abs(path)` (write only through ops
or the API).

**Operations** (what agents and scripts can do with it, `vau docs api`): `plugin.op({ id: "finance.import", summary,
help, kind: "read" | "write" | "destructive", params: { file: { type: "string", required: true, description } } (`format`: "date", "path", or "json" for any value), args:
["file"], cli: "finance import", mcp: true, run: async (params, ctx) => result, text: (result) => "Markdown" })` is
one operation, served at once as `POST /api/ops/finance.import`, `vau finance import <file>` (`vau finance.import`),
an MCP tool (`finance_import`) and in its docs; only while it's on. Its id starts with the plugin's id (or that without
a last s, or a kind it owns); parameters are checked and converted before `run` (`ctx.vault`, `ctx.who`, `ctx.op(id,
params)`, `ctx.api(method, route, body)`); throw `OpError("what to do instead")`. A read never holds the vault; a write
does while it runs (`lock: false` for one that waits on the network and writes through the API). `action: { on:
["book"], param: "book", from: "name", label: "Lend it" }` makes it one of that kind of file's actions. Also:
`plugin.runOp(id, params, who)` runs any op of the catalog, `plugin.onEvent({ types: ["file.changed"], path: "Notes/"
}, (ev) => ...)` hears the vault's events and `plugin.emit("finance.imported", {...})` tells its own (`vau docs
events`). `plugin.every("refresh", { every: "30m" }, fn)` runs fn on a timer (like `schedule` below).
`plugin.around("note.create", async ({ params, who }, next) => next({ ...params }))` is middleware over ops (an id, an
area, or "*"): change the params (checked again) or the answer (in the op's shape), or throw `OpError` to refuse. Ops
only: the app's own edits aren't ops.

**No code: commands in its manifest** (any language, like herdr's plugins; a folder with only a `manifest.json` and
its scripts is a plugin). Each `command` is an argv array run in the plugin's folder with no shell (`["node",
"sync.mjs"]`, `["./sync.sh", "--quiet"]`; a path in it stays in the folder):
- `"ops": [{"id": "finance.sync", "summary": "...", "kind": "write", "params": {...}, "args": [...], "cli": "...",
  "mcp": true, "command": [...], "timeout": 60}]`: operations like `plugin.op`'s. The command gets the checked
  parameters as JSON on stdin; what it prints is the answer (JSON when it parses, else text); a non-zero exit is the
  op's error, with stderr's last lines. It never holds the vault: write through `"$VAULTITE_BIN" note ...` or the API.
  `"owner": "the backup"` keeps one to this machine's owner (anyone else on the tailnet is refused).
  `"action"` makes it one of a kind of file's actions, as `plugin.op`'s.
- `"events": [{"on": "file.changed", "path": "Finance/", "command": [...]}]`: a command per matching event (`on` a type
  or an area), the event as JSON on stdin; in the background, one at a time per hook, at most 30 a minute (don't
  write what you listen to).
- `"startup": [{"command": [...]}]`: run once when the server has opened the vault with the plugin on.
- `"schedule": [{"every": "1h", "command": [...]}, {"every": "1d", "at": "07:00", "op": "dispatch.run", "params":
  {"path": "Notes/Morning brief.md"}}]`: a command or any op on a timer (`every` 15m, 2h, 1d, 1w; `at` this machine's time,
  with whole days; `name` to tell them apart). One machine runs it: Machines' first, or the one its `machine` names. A
  run missed while the server was down runs once when it's back. `vau schedule list`, `vau schedule run <id>`.
Their environment: `VAULTITE_URL` (this server), `VAULTITE_VAULT`, `VAULTITE_BIN` (the `vau` CLI, its folder first on
`PATH`), `VAULTITE_ACTOR` (a hook's: `vau` says it acts on its own), `VAULTITE_PLUGIN_ID`, `VAULTITE_PLUGIN_DIR`, `VAULTITE_PLUGIN_STATE` (a folder of its own on this machine, for
what isn't the user's files or settings), and `VAULTITE_OP` + `VAULTITE_PARAMS_JSON` (an op) or `VAULTITE_PLUGIN_EVENT`
(the type, `startup` or `schedule` with `VAULTITE_SCHEDULE` its name) + `VAULTITE_EVENT_JSON` (an event). `timeout` is seconds (ops 60, hooks 120, at most 600).
What they did: `vau vault-plugin.log <id>` (each run's command, exit, time and stderr).
- `"writes": [{"folder": "Recaps", "why": "a recap of each day"}]` (or `"file": "AGENTS.md"`): where it writes outside
  `.vaultite/` on its own (its `schedule`, `events` and `startup` commands, `plugin.every`, `plugin.onEvent`, the timers
  it starts). The user is asked once ("Lighthouse wants to write a recap of each day into Recaps/"); until they allow it,
  such a write is refused (`WriteRefused`, a 403 for `vau`) and logged. What a user or their agent asks for (its ops,
  routes) is never gated. Data it wants anyway goes in `.vaultite/` (its `data.json`, `plugin.writeCache`).

**`index.tsx`** (optional; the app): `export default definePlugin({ blocks: { "<name>": (ctx) => <Panel
title="...">...</Panel> }, files, details, search, links, commands, sidebar, header, settingsPanel, editor })` from
`"@vaultite"` (`Panel`, `Row`, `useLive("finance/summary")` for its routes (`useLive(route, undefined, true)`: again
whenever notes change, for a route that reads them), `openFile`, `Markdown`, `Loading`,
`notify`, `SidebarRow`, `SidebarHeading`, `SettingRow`, `SettingField`, `usePluginSettings(id)` for its data.json, live
and written...), plus `react`, `lucide-react`, npm packages the app has (CodeMirror's are the editor's own; a package's
stylesheet too: `import "pkg/index.css"`), its own folder and modules of app plugins it `requires`
(`@plugins/core/logs/types` has `Log`, `logsOf`). `import()` a big package where it's used: it loads then, not at every start.
Drag with `startDrag` and take drops with `useDropTarget`; in a tab, an element marked `data-drops` takes files dropped
on it before the pane does (else they open there). Style with Tailwind and the app's colours (`text-muted-foreground`, `bg-card`, `text-[var(--green)]`), never hex; no
emojis, sentence case. Tell the user things with `notify("Imported 12 rows", { action: { label: "Undo", run } })`; a form
in a sheet guards what isn't saved with `useSheetGuard(() => lines)`.
- `fences: { "<lang>": (ctx) => ... }` draws ```` ```<lang> ```` code fences (a ```` ```base ````), `ctx.text` their
  lines; its backend's service `fence:<lang>`, `({path, text, host}) => Markdown`, is their text for agents. Inline code it
  draws (Dataview's `` `= this.file.name` ``) is an `editor` extension, and the service `inline-code`, `({path, code, host})
  => Markdown`, or null to leave it as it is, its text.
- `files: { types, page }` draws a type of file as a page. `settingsPanel: ({ store }) => ...` draws what a form can't,
  above its declared settings. `editor: (ctx) => extensions` adds CodeMirror extensions to every editor (may return a
  promise; `ctx.kind` "markdown" for notes): `@codemirror/state`, `view`, `language`, `commands`, `autocomplete`,
  `search` and `@lezer/highlight` are the app's own copy, loaded with the plugin.
- `sidebar: { "<name>": { title, sort: 40, render: ({ store, open, file, tab }) => ... } }` adds a sidebar panel
  (Search 0, Pages 10, Terminals 30, Files 35, Links 40; `open` false in the icon rail; `flyout: { icon }` one icon
  there; `view` shows it in a tab; `hidden: true` keeps it out of a new vault's sidebar; `heading` names it or `false`
  draws its own; `actions: (ctx) => ...` puts hover buttons on the heading the sidebar draws). `header: { "<name>": { sort, render } }` draws something small in the sidebar's header.
- `newTab: { "<name>": { title, sort, hidden, only, heading, render: ({ store, phone }) => ... } }` adds a section to a
  blank tab's page (Buttons 10, Recently opened here 20, Recently changed 30; `only: "phone"` or `"desktop"`), which the
  user arranges (newtab.json, `vau docs app`). A command's `icon` (a component or a Lucide name, `"mic"`; its plugin's when
  left out) and `label` (after its `run`) are how it looks as one of the page's buttons; the icon shows in the palette too.

**A block needs both sides and a declaration**: the React render in `index.tsx` (what the user sees), `plugin.block` in
`plugin.ts` (the same as Markdown, what an AI reads) and its entry in the manifest's `blocks`. The core draws the rest
(plugin off, a render that throws, option notes). Right-click on a block shows where its data comes from, recorded as
its text side runs: name the files it shows with `ctx.source(items or paths)`, and declare `"live": "<where from>"`
(and `"reads": [paths]` for a block with no text side) in its manifest entry; `plugin.folders(() => [abs paths])`
names the folders on this machine that live data is read from, which the menu opens in Finder.

**Also**: `pages/<Name>.md` (its dashboards, `type: dashboard`, `plugin: <id>`: copied where the other pages are, `Dashboards/`, and
pinned when it's turned on, unless the vault's pages.json says `"pinNew": false`) and `AGENTS.md` (its file formats, read with `vau docs <id>`: agents look a kind's format up
before writing one; `vau docs` lists the topics).

**It's off until the user turns it on** (Plugins page, Vault plugins, or `vau plugin on <id>`; it runs code on their
machine, its manifest's commands too): tell them to. Turning it on from their machine allows it there at its current files
(a hash kept on that machine, never in the vault); one turned on elsewhere (another machine, a shared vault, a bundle) or
whose files changed since waits for them to allow it (Plugins page's Review, `vau plugin allow <id>`). One made with
`vau plugin new` on their machine is allowed with its edits, so editing it reloads it; another's edits wait, unless they
let them run while it's written (`vau plugin allow <id> --edits`). Check it: `GET /api/plugins`
lists every vault plugin with `problems` (why it didn't load or build: its manifest's commands and ops too) and
`warnings` (fix them: a block without its declaration or text side); then call its routes and ops (`vau ops <id>`) and
`vau render Dashboards/<Name>.md`.

**From GitHub**: `vau plugin install owner/name` (`@v1.2.0`, a git URL or a folder too; `owner/name/folder` for one
of several plugins in a repository, tagged `<folder>/v1.2.0`) fetches it at its newest version tag, checks it, copies it to `.vaultite/plugins/<id>/` and records where from in `.vaultite/plugins-lock.json`;
it's off until turned on. A zip at an https address works too, pinned by its hash (`vau plugin install
"https://example.com/x-1.2.0.zip#sha256=<hex>"`: the plugin at the zip's top or in its one folder; no updates). `vau plugin update` says what a newer tag changes (files, disclosures) and `--apply` installs
it (to be allowed again); `vau plugin uninstall <id>`. Installed plugins update on their own: every hour one machine
(Machines' first) runs `vau plugin update --auto` for those plugins.json's `updates` covers (`vaultite`, the default:
Vaultite's own; `all`; `off`; a plugin's own choice in `updatesOn` / `updatesOff`), and every machine that allowed one
before allows the new version once its files match its source at that tag (the lock alone isn't trusted). Not one edited
here, nor one that says it does more beyond the vault than it did. Each update is kept in its lock entry's `history`
with what's new (its commits' subjects since, upkeep left out): `vau plugin history`; `vau plugin rollback <id>` goes
back to the version before and skips the newer one from then on. Writing one in its own folder: `vau plugin install <folder>`, turn
it on, then after each edit `vau plugin update <id> --apply` (it keeps running); a `.vaultiteignore` (like .gitignore)
leaves its tests and QA out of installs. The Plugins page's Browse (`vau plugin search`) lists the plugin
directory: every GitHub repository with the topic `vaultite-plugin` and a version tag, read daily into one index
(plugins.json's `index`: an https address, or `owner/name/path.json` in a GitHub repository, read with git so a private
one works), which can also block a version with a known problem (it then doesn't load). To publish one:
its repository is the plugin folder (manifest.json at the top), tagged `v<version>`, with the topic; its CI runs
`uses: Vaultite/vaultite/tools/plugin-action@main` (or `node tools/check_plugins.ts --plugin <folder> --tag <tag>`).
