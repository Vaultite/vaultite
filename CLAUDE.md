# Vaultite

A vault for your life that AIs write in: a personal dashboard (routines, workouts, nutrition, reading, people, notes,
projects) where every piece of data is a Markdown file the user owns, every feature is a plugin, and AIs are the main
writers. Served on a private network (a tailnet), no accounts.

- **This repo is the app, not anyone's life.** Nothing personal in code, docs, examples or tests (use made-up names:
  Alice Park, Lighthouse). Who the user is lives in their vault's `ME.md`; how an install is set up (machines, deploy)
  in the untracked `CLAUDE.local.md`.
- Docs for AIs: the vault's `.vaultite/AGENTS.md` (written from `core/AGENTS.md` and each plugin's `forAgents`, capped
  by `npm run check`), `vau docs <topic>` (`core/docs/`, each plugin's `AGENTS.md`) and `skills/`. Never list a
  plugin's blocks, options or tools by hand; no prompt text hard-coded in the core. Folder `CLAUDE.md` files load when
  you work there; for a feature spanning folders, read each.

## How it's built
**All data is Markdown files in the vault. Every feature is a plugin. The core only indexes files and loads plugins.**
- **Few strong primitives, composed; never a special case**: files, blocks, dashboards, pinned files, tabs, embeds,
  the sheet, `Resizer`, menus, the palette, the drag primitive. Add a primitive only when nothing composes, make it
  general, and give it both sides (app and `/api/render`).
- **Design.md is the design system** (`core/pages/Design.md`): a new block or Markdown feature goes in it (`npm run
  check` enforces blocks).
- **The vault is the only store, no database.** Never wipe it; back it up before bulk changes. Folders are the user's:
  find files by type, plugin or id, never by a hard-coded path. Writes are small edits, never rewrites; parse
  leniently, write canonically. Details: `core/CLAUDE.md`.
- **Live**: app writes go through `tracked()`; never change the store's objects in place. Details: `web/src/core/CLAUDE.md`.
- **Tiers**: core app (`server.ts`, `core/`, `web/src/`), built-in plugins (`plugins/core/`) and vault plugins (installed,
  like Vaultite's own in Vaultite/plugins, or the user's). How a plugin is built: `plugins/CLAUDE.md`.
- **Operations are the API** (`core/ops.ts`): a new agent-facing feature is an op, never a hand-written vau command or
  MCP tool.
- **Secrets only in `data/config.json`**: never in the vault, never printed or committed. Live data never in the vault.
- **Ids** are vault paths without .md (`People/Alice Park`).
- **Settings page is the app's only**; a plugin's options are its settings sheet. Every UI preference is a file in
  the vault's `.vaultite/` (so an AI can change the app); only a few per-device values live in localStorage. Defaults
  are never written into a vault.
- **No compatibility shims**: there's one user so far, so migrate data and callers properly instead of keeping
  aliases, old-format readers or fallbacks.
- **Stack: all TypeScript.** `server.ts` (Node's http, no framework; `core/app.ts` is the API without HTTP) runs as-is
  with Node's type stripping, so backend code is erasable TS: no enums, no parameter properties, `import type`, imports
  name the `.ts` file. `web/`: Vite, React, Tailwind v4, shadcn/ui, lucide, CodeMirror 6. Files in `core/` that the
  web imports must not use Node. Few backend deps; the packaged app ships only `dependencies`, which vault plugins
  bundle against.
- `core/` is the server, `web/src/core/` the app's core; several file names exist on both sides, so say which.

## UI
Read `web/CLAUDE.md` first. UI text: sentence case, no emojis, no all caps.

## Running, tests and QA
- `npm start` serves the app and API on 127.0.0.1:8793. Restart after backend changes; frontend changes only need
  `npm run build`. Which Mac is live and how to deploy: `CLAUDE.local.md`. A change isn't done until it's live.
- Before a change is done: `npm run build`, `npm run check`, `npm test`, `npm run smoke` (CONTRIBUTING.md). Tests
  never touch the real vault.
- Throwaway server: `vau sandbox /tmp/v` (`examples/CLAUDE.md`), or a copy of a vault with
  `VAULTITE_VAULT=/tmp/v VAULTITE_LOCAL=/tmp/local PORT=<free port> npm start`. Strip the copy's terminal tabs first
  (`view:terminal/...` in `.vaultite/plugins/workspaces/*.json`): showing one starts its agent, and a `resume-` tab
  would resume the user's live session; and empty its machines (`.vaultite/plugins/machines/data.json`: `{"machines":
  []}`), or it lists and reaches the live ones. **Stop it by its port, never by a pattern**: `kill $(lsof -tiTCP:<port>
  -sTCP:LISTEN)`, then its keeper (`<run>/vaultite-ptyd1-vaultite-<port>.sock.pid`, `<run>` being `$TMPDIR` on a Mac, `$XDG_RUNTIME_DIR/vaultite` on Linux: `core/runtime.ts`) and `tmux -L vaultite-<port>
  kill-server`. Never `pkill -f`/`killall`: they match the user's apps too.
- UI QA: `node web/qa/<script>.mjs <base>`; most write, so only against a throwaway server.

## Working here
- Comments are at most 2 lines, saying why, not what. Rules the code can't show go in the nearest `CLAUDE.md`, once.
  CHANGELOG.md: one user-facing line per change (edit an Unreleased line rather than add another).
- **Always work in a git worktree**, never in the main checkout: several sessions run at once. Check `git worktree
  list` for overlapping work first. `git worktree add ../vaultite-<task> -b <task>` (symlink `node_modules`), commit
  there after each working step (a worktree has been emptied mid-task by something outside it), squash-merge it into main from the main checkout (`git merge --squash <task>`, one commit), deploy, remove the worktree. Never `git stash` (shared by every worktree).
- **Commits**: Conventional Commits, `type(scope): summary` in at most 72 chars, saying what changed for the user
  (`fix(phone): tab list zoom no longer stretches the page`); no body unless the why isn't in the diff. Scope is the
  area: `phone`, `desktop`, `ios`, `editor`, `tabs`, `files`, `blocks`, `plugins`, `obsidian`, `dispatch`, `inbox`,
  `terminal`, `cli`, `server`, `api`, `qa`. `.githooks/commit-msg` refuses others (`npm install` turns it on).
