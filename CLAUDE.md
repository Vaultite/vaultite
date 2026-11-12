# Vaultite

A personal dashboard where every piece of data is a Markdown file the user owns, every feature is a plugin, and AIs are
the main writers. Served on a private network (a tailnet), no accounts.

- This repo is the app, not anyone's life: code, docs and tests use made-up names (Alice Park, Lighthouse). How an
  install is set up (machines, deploy) is in the untracked `CLAUDE.local.md`.
- Folder `CLAUDE.md` files load when you work there; for a feature spanning folders, read each. The code is the doc: a
  `CLAUDE.md` holds only what it can't show (rules, gotchas, the why), each once, in the nearest folder.

## How it's built
- The vault is the only store of the user's data, no database. The core indexes files and loads plugins; every
  feature is a plugin (`plugins/CLAUDE.md`).
- Few strong primitives, composed (files, blocks, dashboards, tabs, the sheet, menus, the palette, drag). Add one only
  when nothing composes, make it general, and give it both sides (the app and `/api/render`).
- `core/docs/design.md` is the design system: the page primitives and Markdown. A new one goes in it; a block is
  declared in its plugin's manifest only.
- Operations are the API (`core/ops.ts`): a new agent-facing feature is an op, which gives it its vau command, MCP tool
  and docs. Docs for agents come from ops, manifests, `core/AGENTS.md`, `core/docs/` and plugins' `AGENTS.md`.
- Secrets live only in `data/config.json` on the server's machine: out of the vault, logs and commits.
- Three kinds of things, three places. The user's data (notes, logs, people, tasks) is vault files. Preferences
  (appearance, keymaps, panels, plugin settings: what the user sets, rarely written) are files in `.vaultite/` (so an
  AI can change them). Runtime state (what's open: tabs, layouts, a place in a video; caches) is the server's
  (`core/kept.ts`: memory, its own disk, shared with the other machines), never the vault: each vault write is an
  iCloud upload and a watcher event on every machine. All three reach agents through ops. Only per-device values go in
  localStorage. Defaults stay in code, never written into a vault.
- No compatibility shims: migrate data and every caller, and delete the old API in the same change.
- Backend code runs with Node's type stripping, so it's erasable TS: no enums, no parameter properties, `import type`,
  imports name the `.ts` file. Files in `core/` that the web imports use no Node.
- Which process a file reaches is its imports' graph (`core/update/closure.ts`; `node tools/closure.ts <commit>` says
  why). Code loaded or a file read by a computed path (`import(x)`, a path from `import.meta` or `ROOT`, a process
  started from a file) is declared in `core/update/sites.ts`: `tools/test_closure.ts` fails on one that isn't.
- The Swift helpers (`electron/*.swift`) build with the Xcode on CI's `macos-15` runner, older than ours: no newer API,
  and a long expression typed in steps (its type checker gives up on one that ours takes).
- `core/` is the server, `web/src/core/` the app's core; several file names exist on both sides, so say which.
- The core (`core/`, `electron/`, `web/src/`) never imports a plugin, only loads them: what both use is the core's, the
  desktop app's contracts with plugins (the overlay's marks, the UI model, knocks, walks) in `core/desktop/` (`npm run check`).
- The packaged app ships only `dependencies` (vault plugins import some: `plugins/CLAUDE.md`, rule 5): keep backend deps few.
- npm runs no install scripts and takes only versions a week old (`.npmrc`): a dep that needs a script (a native build)
  gets its own step (`npm rebuild <name>`); an urgent security fix, `--min-release-age=0`. Pin new deps exactly. One
  with an install script is listed in `allowScripts` once reviewed; every package comes from the registry (`npm run check`).

## UI
Read `web/CLAUDE.md` first. UI text: sentence case, no emojis, no all caps.
A vault's icon is Vaultite's stone (the gem: kit's `Stone`, a menu's `icon("stone")`), never lucide's `Vault` (a safe),
anywhere: the user dislikes it (a check in tools/test_web.ts and tools/menu_icons.ts refuse it).
Agents never take the user's focus: what an op opens for one (not `byUser`) goes behind their tab
(`openTab(to, { background: true })`), with a toast to show it. `vau open` is the exception: showing the user something
is its point.

## Running and verifying
- `npm start` serves on 127.0.0.1:8793, often the live server: give anything else its own port, and keep tests off the
  real vault. Restart after backend changes; frontend changes need only `npm run build`.
- Debugging: `vau errors` (the app's and the server's, with stacks), `vau activity --action failed` (calls agents and
  the CLI got wrong, and why); a server log line's `#<id>` is the request its errors name.
- Done means `npm run verify` passes (build, check, and the tests and QA the branch reaches) and the change is live.
  `npm run verify -- --all` (`npm test` and smoke too) only for a change much rests on (a dependency, the build, the
  test harness): say why. CI runs the full suite on three OSes on every push.
- A red main is everyone's. "It fails the same way on main" is never a reason to land: a test red on main fails your
  change too. Fix it (its own commit, the cause found, no retry or skip without the reason in the test), or, when a
  job already fixes it (`vau companion jobs`), hand it what you found and wait for its fix before landing.
- Iterate on the failing stage's own command (verify prints it, and its whole output's file), then verify once at the
  end: it skips what passed on the same files, so a rerun after a commit or to add `--try` costs nothing.
- A change likely to behave differently on Windows or Linux (processes, paths, file times, the CLI's shims, CI: verify
  says so) is tried there before it lands: commit, then `npm run verify -- --try` (it starts HEAD's try on the three
  OSes, each on an idle machine of the Machines with it, else GitHub's runners: about 6 min, 11 with Windows' vau and
  installer checks, always GitHub's; it waits within 8.5 min in all). Exit 3 is "still
  running": `node tools/try.ts --wait` again until it says PASSED or FAILED. pre-push refuses one untried;
  `VAULTITE_TRY=skip` only while GitHub's runners are down.
- A command that fits in the shell tool's 10-minute limit runs in the foreground with its timeout set (`npm run verify`
  does: a few minutes). One that can't is started detached, then waited on with the bounded wait its tool offers, run
  again while it says it's still running (`node tools/try.ts`, then `node tools/try.ts --wait`). Never a `sleep` or `until` loop of your own; and a sub-agent never ends its
  turn to wait for a background command's notice: none wakes it.
- Live (a session run by hand; a companion job's task says how it lands): after the push, from the worktree,
  `bin/vau --url <server> version HEAD --wait --timeout 540` on the server following main (`CLAUDE.local.md` names it; the worktree's vau, as an older one may not resolve `HEAD` or exit 1),
  in the foreground and unpiped (no `| tail`: its exit code is the answer). It ends when the commit is live, or exits 1
  saying why not: still waiting (run it again), CI red on it (fix forward), its checkout blocked (say so). That one
  command is the check: don't watch CI, as a queued run is dropped when newer pushes arrive and may never finish.
  `vau update` there looks now instead of at its next 3-minute look.
- A cloud session (Claude Code on the web, a cloud job) sets itself up at its start: `tools/cloud-setup.sh`
  (`.claude/settings.json`'s hook) installs CI's Node and rsync, runs `npm ci` and points QA at the VM's Chrome.
- Try a branch in the desktop app: `npm run app:dev` in its worktree (Vaultite Dev beside Main, its windows behind until
  you switch to it; it follows the worktree's changes). An agent: `npm run app:dev -- --headless` (quiet, its pid,
  debug port and server printed), then `npm run app:dev -- --stop`.
- Throwaway server: `vau sandbox /tmp/v`, then `VAULTITE_VAULT=/tmp/v VAULTITE_LOCAL=/tmp/local PORT=<free> npm start`.
  On a copy of a real vault, first empty its machines (`.vaultite/plugins/machines/data.json`: `{"machines": []}`): with
  them it shares the real machines' tabs and state, and showing a terminal tab starts its agent (a `resume-` one resumes
  the user's live session).
- Many agents share one machine, often a small one: before heavy work (QA, builds, perf runs) check `uptime` and what
  else runs (`pgrep -fl "Chrome for Testing"`), close every browser and server you start, and don't raise `--jobs`.
  QA browsers queue for the machine's slots (`tools/qa_slots.ts`); a run waiting for one is normal.
- Stop a server by its port: `kill $(lsof -tiTCP:<port> -sTCP:LISTEN)`, then its terminal server (the pid in
  `vaultite-termd<PROTOCOL>-vaultite-<port>.sock.pid` (termd/protocol.ts) under `core/runtime.ts`' dir).
  Pattern kills (`pkill -f`, `killall`) hit the user's own apps.

## Working here
- Work in a git worktree, never the main checkout: several sessions run at once (check `git worktree list` first).
  `git worktree add ../vaultite-<task> -b <task>`, symlink `node_modules` (a real `npm install` in the worktree once you
  add a package, never into the checkout's), commit after each working step. Land from the worktree, never by merging
  in a checkout: rebase onto `origin/main`, squash to one commit, `git push origin HEAD:main`; then `git pull --ff-only`
  a checkout that isn't a live server's, check it's live, remove the worktree and its branch. Park work in commits:
  `git stash` is shared by every worktree.
- A live server's checkout is its updater's alone, even on that machine: never edit, commit, pull or cherry-pick
  there. A file left uncommitted or a commit not on main blocks its updates, and ships what CI never passed.
- Comments: at most 2 lines, saying why, not what.
- CHANGELOG.md: one user-facing line per change (edit an Unreleased line rather than add another).
- **Commits**: Conventional Commits, `type(scope): summary` in at most 72 chars, saying what changed for the user
  (`fix(phone): tab list zoom no longer stretches the page`); a body only when the why isn't in the diff. Scope is the
  area (`phone`, `desktop`, `editor`, `plugins`, `server`, `cli`...). `.githooks/commit-msg` checks the shape.
  `.githooks/pre-push` runs tsc, `npm run check` and the desktop main process's launch budget
  (`node tools/perf/startup.ts --main`) before a push to main, and says when main's CI is red (the job, the test, since
  which commit, never blocking). Over a launch budget (`tools/perf/startup.json`), load the new code lazily; a limit
  is never raised inside a feature's commit, only by a commit of its own saying what the growth buys.
