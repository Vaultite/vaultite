# Vaultite

A personal dashboard where every piece of data is a Markdown file the user owns, every feature is a plugin, and AIs are
the main writers. Served on a private network (a tailnet), no accounts.

- This repo is the app, not anyone's life: code, docs and tests use made-up names (Alice Park, Lighthouse). How an
  install is set up (machines, deploy) is in the untracked `CLAUDE.local.md`.
- Folder `CLAUDE.md` files load when you work there; for a feature spanning folders, read each. The code is the doc: a
  `CLAUDE.md` holds only what it can't show (rules, gotchas, the why), each once, in the nearest folder.

## How it's built
- The vault is the only store, no database. The core indexes files and loads plugins; every feature is a plugin
  (`plugins/CLAUDE.md`).
- Few strong primitives, composed (files, blocks, dashboards, tabs, the sheet, menus, the palette, drag). Add one only
  when nothing composes, make it general, and give it both sides (the app and `/api/render`).
- `core/docs/design.md` is the design system: the page primitives and Markdown. A new one goes in it; a block is
  declared in its plugin's manifest only.
- Operations are the API (`core/ops.ts`): a new agent-facing feature is an op, which gives it its vau command, MCP tool
  and docs. Docs for agents come from ops, manifests, `core/AGENTS.md`, `core/docs/` and plugins' `AGENTS.md`.
- Secrets live only in `data/config.json` on the server's machine: out of the vault, logs and commits.
- Every UI preference is a file in the vault's `.vaultite/` (so an AI can change it); only per-device values go in
  localStorage. Defaults stay in code, never written into a vault.
- No compatibility shims: migrate data and every caller, and delete the old API in the same change.
- Backend code runs with Node's type stripping, so it's erasable TS: no enums, no parameter properties, `import type`,
  imports name the `.ts` file. Files in `core/` that the web imports use no Node.
- `core/` is the server, `web/src/core/` the app's core; several file names exist on both sides, so say which.
- The packaged app ships only `dependencies`, which vault plugins bundle against: keep backend deps few.

## UI
Read `web/CLAUDE.md` first. UI text: sentence case, no emojis, no all caps.
Agents never take the user's focus: what an op opens for one (not `byUser`) goes behind their tab
(`openTab(to, { background: true })`), with a toast to show it. `vau open` is the exception: showing the user something
is its point.

## Running and verifying
- `npm start` serves on 127.0.0.1:8793, often the live server: give anything else its own port, and keep tests off the
  real vault. Restart after backend changes; frontend changes need only `npm run build`.
- Debugging: `vau errors` (the app's and the server's, with stacks), `vau activity --action failed` (calls agents and
  the CLI got wrong, and why); a server log line's `#<id>` is the request its errors name.
- Done means `npm run build`, `npm run check`, `npm test` and `npm run smoke` pass (`npm run verify` runs what a branch
  needs), and the change is live (`CLAUDE.local.md`).
- Throwaway server: `vau sandbox /tmp/v`, then `VAULTITE_VAULT=/tmp/v VAULTITE_LOCAL=/tmp/local PORT=<free> npm start`.
  On a copy of a real vault, first strip its terminal tabs (`view:terminal/...` in
  `.vaultite/plugins/workspaces/*.json`: showing one starts its agent, a `resume-` one resumes the user's live session)
  and empty its machines (`.vaultite/plugins/machines/data.json`: `{"machines": []}`).
- Many agents share one machine, often a small one: before heavy work (QA, builds, perf runs) check `uptime` and what
  else runs (`pgrep -fl "Chrome for Testing"`), close every browser and server you start, and don't raise `--jobs`.
  QA browsers queue for the machine's slots (`tools/qa_slots.ts`); a run waiting for one is normal.
- Stop a server by its port: `kill $(lsof -tiTCP:<port> -sTCP:LISTEN)`, then its terminal keeper (the pid in
  `vaultite-ptyd1-vaultite-<port>.sock.pid` under `core/runtime.ts`' dir) and `tmux -L vaultite-<port> kill-server`.
  Pattern kills (`pkill -f`, `killall`) hit the user's own apps.

## Working here
- Work in a git worktree, never the main checkout: several sessions run at once (check `git worktree list` first).
  `git worktree add ../vaultite-<task> -b <task>`, symlink `node_modules`, commit after each working step, squash-merge
  into main from the main checkout (one commit), deploy, remove the worktree. Park work in commits: `git stash` is
  shared by every worktree.
- Comments: at most 2 lines, saying why, not what.
- CHANGELOG.md: one user-facing line per change (edit an Unreleased line rather than add another).
- **Commits**: Conventional Commits, `type(scope): summary` in at most 72 chars, saying what changed for the user
  (`fix(phone): tab list zoom no longer stretches the page`); a body only when the why isn't in the diff. Scope is the
  area (`phone`, `desktop`, `editor`, `plugins`, `server`, `cli`...). `.githooks/commit-msg` checks the shape.
  `.githooks/pre-push` runs tsc and `npm run check` before a push to main: CI on main is everyone's, keep it green.
