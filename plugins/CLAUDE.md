# Notes for `plugins/`

## How it's built
- **Tiers**: built-in plugins (`plugins/core/<id>/`, ship with the app, can be turned off; the UI says Built-in so
  "core" means only the app itself: those marked `essential`; the others are Vaultite plugins, first-party extras listed
  apart and off by default, turned on by a bundle or by hand) and vault plugins (in the vault: installed or the user's own). The core is generic
  primitives; what assumes one person's life (a job, a bank's CSV, one tool) is a vault plugin, Vaultite's own in the
  private monorepo Vaultite/plugins (`../vaultite-plugins`, its `node test.ts` checks them against this checkout).
  Even search, Pinned and the file tree are plugins.
- **A plugin is one folder**, found by glob on both sides (no registration elsewhere):
  - `manifest.json`: what it is, `icon` (the one source: a Lucide name, one a plugin adds in `icons`, or an SVG file;
    `virtual:plugin-icons` in vite.config.ts imports the app's one by one), `category` (`core/categories.ts`), `requires`/`enhances`, `blocks` and `settings`
    declared (`core/blocks.ts`, validated by `npm run check`), and `forAgents`: one line every agent reads while it's
    on (`agentLines` in core/plugins.ts), only what an agent must know up front, never a format. `offByDefault`:
    off until in plugins.json `enabled` (every one not `essential`, and Vim), its backend too; a plugin's
    code asks `plugin.isOff()` or `vault.switchedOff()`, never `disabled` alone (`npm run check`).
  - `plugin.ts` (backend, Node): `new Plugin(import.meta.url)`; each method of the `Plugin` class (core/plugins.ts)
    says what it does: kinds, routes, ops, blocks as text, hooks, sockets, services (`plugin.provide` /
    `plugin.ask`: ask for a service, never for a plugin's id), memo and cache, secrets, owner checks, jobs.
  - `index.tsx` (frontend): `definePlugin({...})`, every key typed and explained in `web/src/core/define.ts`.
  - `types.ts`: its part of the store, typed for everyone with `declare module "@vaultite" { interface PluginState }`;
    a plugin that requires another imports its `types`, one that only enhances it reads `Store["logs"]`.
  - `cli.ts` (only `vau` commands that can't be ops, rare), `import.ts`, `pages/*.md` (its dashboards), `AGENTS.md`
    (its file format for AIs: `vau docs <id>`; the vault's `.vaultite/AGENTS.md` has only the rules).
- **The rules** (`core/rules.ts`, `npm run check`):
  1. A plugin's data is vault files or its settings, `.vaultite/plugins/<id>/data.json`. Only File history, Activity,
     the Inbox's events and Errors keep files on the server's machine (`plugin.localDir()`): disposable, and they'd churn
     iCloud on every request.
  2. Live data (calendar events, GitHub stats) is never written to the vault: memory (`plugin.memo`) or the cache
     (`plugin.writeCache`, `.vaultite/cache/<id>.json`). Files show it through blocks.
  3. Secrets live in `data/config.json` on the server's machine (`plugin.secrets()`), never in the vault; never print or commit them.
  4. A plugin imports only `@vaultite`, its own folder and plugins it `requires`; its backend only `core/plugins.ts`,
     `core/vault.ts`, `core/client.ts`, `core/timeline.ts` (`core/codingagents.ts` and `core/terminalids.ts`: the coding agent plugins'), Node
     and npm packages, a required plugin through `plugin.peer(id).exports`. Settings are read through the API, never
     from disk (`settingsProblems` flags direct reads).
- **A block needs both sides and a declaration** (`npm run check` fails an app plugin without them; a vault plugin
  loads with warnings): the React render in `index.tsx`, the text in `plugin.ts` (`plugin.block`, what `GET
  /api/render` shows an agent), and its manifest entry. The declaration is the contract: both sides take defaults from
  it, options are checked against it, the editor and its Options form come from it, and the docs list it (generated,
  so they can't drift). A block is a view, never data in the file: the backend never shows blocks to a kind (`prose()`)
  and API writes patch around them. A file a plugin draws reads as text through the service `text:<ext>`, gives links
  through `links:<ext>`, and a page one is listed through `looks:<ext>`. Where a block's data comes from is recorded,
  not declared (`core/sources.ts` traces the text side; `ctx.source(...)` names the rows it lists).
- **Vault plugins** (`core/vaultplugins.ts`, `web/src/core/vaultPlugins.ts`; writing one: `core/docs/vault-plugins.md`):
  same shape and rules, the backend importing the core as `@vaultite/core/plugins.ts` (a resolve hook maps it and
  refuses other imports). **Off until turned on and allowed on this machine** (core/trust.ts): plugins.json is a vault file
  (it syncs, travels with shared vaults and bundles), so what may run is this machine owner's yes to a plugin's content hash
  (`digestOf`), in `VAULTITE_LOCAL/trust/`. Turned on by the owner it's allowed; otherwise, or changed since, it waits
  (`approval`); `edits` lets later edits run. **Risk**: once allowed it's code on the server's machine; the rules are hygiene, not a
  sandbox. From elsewhere: `plugin.install` (git, at a version tag), the directory's index and blocklist
  (core/installs.ts, core/pluginindex.ts, `tools/plugin-index.ts`). A changed `plugin.ts` is imported again under a new
  `?v=<hash>`; `index.tsx` is bundled with rolldown against the app's one React and CodeMirror. Without code, herdr-style
  (core/hooks.ts): the manifest's `ops`, `events`, `startup` and `schedule` run argv commands (no shell) that call `vau`
  back. Examples: `tools/fixtures/lighthouse/`, `tools/fixtures/wordcount/`.

## Features
- **Links and graph**: `[[...]]` resolves by Obsidian's rules in `core/links.ts` (`linkIndex`, the app's too: the
  closest file of a name wins; plugins' `links` add names after files'); `POST /api/backlinks/link` rewrites only that
  stretch, 409 if the line changed.
- **Obsidian vaults open as they are** (core/docs/from-other-apps.md): `core/sections.ts`, note embeds, the `other-apps`
  plugin's conventions from `.obsidian/app.json`, Obsidian themes as colour schemes (only colours carry over).
- **Audio recorder, Slides, Export to PDF**: app-wide overlays drawn by each plugin's `background`, never a route or a
  sheet. The transcript is the server's job, written as a small edit under `vault.lock`, so it lands with the app
  closed. The transcriber is found or set in data/config.json, never the vault's settings (a vault setting must not
  choose a program to run); `model` is a name, never a path (whisper unpickles a path). QA: `web/qa/media.mjs`.
- **File history**: a whole top-level folder missing (iCloud) isn't a delete; a restore is a PUT, so it's in the
  history too.
- **Coding agents** (`claude-code`, `codex`, `opencode`, `cursor`, `openclaw`, `hermes`): each reads its tool's own
  files on the server's machine, stores nothing, and answers `GET /api/<id>?days=` with an `AgentUsage` and `GET
  /api/<id>/session/<id>` with a page of a conversation; the blocks (`<id>-limits`, `-sessions`, `-usage`, `-projects`,
  `-models`, `<id>` in a project file) are one set of components, `web/src/components/AgentUsage.tsx` and
  `AgentSession.tsx` (plugin API: `AgentLimits`... on an `AgentSource`), so a plugin's index.tsx only wires them; every
  block takes `machine:` and `account:`. Claude Code's accounts are its config folders (`~/.claude`, siblings
  `~/.claude-<name>` with sessions; settings name them, `private: true` keeps titles, folders and conversations out,
  `hidden` leaves one out); it lists the Remote Control servers running (`servers`, from `ps`). Their backends share
  `core/codingagents.ts` (`codingAgent` makes their routes and blocks; the usage tally, processes, transcripts, SQLite
  files): each plugin.ts keeps only how it reads its tool. Gotchas: Claude Code's value is at API list prices (`PRICES`: add new models there), so is Codex's
  (LiteLLM's table); Codex's tokens count only when a session's total changed, once across forked files, and it gets
  nothing on its command line (any `-c` makes it skip its shared background server; hooks given that way need trust),
  so its terminals don't pulse; OpenCode's cost is what it recorded (0 for free models) and Terminal passes it
  `OPENCODE_CONFIG_CONTENT` (instructions and a state plugin); Cursor's usage exists only on Cursor's servers (its
  dashboard API with the IDE's stored session, never logged or kept), its chats in the IDE's `state.vscdb` and
  `~/.cursor/chats` (`node:sqlite`, read only); OpenClaw's agents are its accounts, its transcript events of 1 KiB and
  more are zstd-compressed (`event_zstd`), and `openclaw.connect` saves `vau mcp` through its CLI (its JSON5 config
  isn't ours to edit). Hermes Agent's homes (`~/.hermes` and its `profiles/<name>`, the accounts) each have a
  `state.db` with usage per session and model (counted on its last-seen day; a compression's or a subagent's session
  in its top one), memory files and `cron/jobs.json`; `hermes.connect` (owner only) is its one write,
  `mcp_servers.vaultite` in config.yaml as a text edit checked by re-parsing. Tests use made-up data only:
  `tools/fixtures/<id>` with `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `OPENCODE_DATA_DIR`, `CURSOR_USER_DIR`/
  `CURSOR_CONFIG_DIR`/`CURSOR_API_URL`, `OPENCLAW_STATE_DIR`/`OPENCLAW_WORKSPACE_DIR`, `HERMES_HOME`.
