# Notes for `tools/`

- The vault test is areas in `tools/test/vault/` on one in-process app: `node tools/test_vault.ts <area>...` runs some,
  `--list` names them. A new check goes in its area; a new area in `index.ts`. Many areas run in parallel shards, each
  with its deps (`--jobs 1`: in one process): an area leaves the vault as it found it, and waits on events, not the clock.
- A test or QA entry point imports `tools/test/isolate.ts` first (`test/lib.ts` and `web/qa/lib/qa.mjs` do): the run
  gets its own TMPDIR, removed at its end, and fails if anything in it reached the user's own vaults (`core/testrun.ts`:
  a test's server or app refuses one, the user's server refuses its `vau`, claude.ai connectors are off). Make temp
  folders with `os.tmpdir()`, never a fixed `/tmp` path; what must outlast a run (built helpers) goes in `sharedTmp()`.
- Every test runs on Linux, macOS and Windows in CI, and Windows breaks most often: paths (`\`, a drive, 8.3 short
  names like `RUNNER~1` against the long ones), no Unix tools (CI runs in Git Bash, so a `cp` or `rm` it puts on PATH
  passes there and fails on a user's Windows: use `fs`), file clocks coarser than `Date.now()`. A Windows failure
  reproduces on any Windows machine: clone, `npm ci`, `npm run build`, `node tools/test_vault.ts <area>`.
- What's likely to break on another OS (`tools/osrisk.ts`: the lines and files a change touches) is tried before it
  lands: `node tools/try.ts` pushes HEAD to a `try/` branch, where ci.yml runs only the tests (and windows.yml's
  surfaces, for a change to what it exercises: `-surfaces`), and returns; `--wait` (any number of times, from any
  process) follows it, runs a failure again once, and deletes the branch at its end. Its bounds are in its head. A
  one-OS breakage the rule missed is a pattern to add there, measured against main's past runs.
- An OS an idle machine of the Machines has runs there instead (`try_machines.ts`: `-skip-<os>` on the branch): CI's
  test job in a fresh worktree (`~/.vaultite-try`), its runner apart, one at a time, only with 5 GB free (the user's app
  runs there too: `VAULTITE_TRY_FREE_GB`), else on GitHub's runners. Not what a machine can't run as CI does: surfaces
  (a clean image), Swift on macOS (CI's older Xcode), a change to CI. Off: `VAULTITE_TRY_MACHINES=off`.
- The desktop main process's launch budget (`tools/perf/startup.ts --main`, from the sources) runs in pre-push: over
  it, import the new code lazily; raise its limit in `startup.json` (in the same commit) only for growth you meant.
- A QA script's sandbox is a copy of a template (`tools/qa_template.ts`: the sample, Vaultite's own plugins installed
  and allowed, the made-up repositories), made once in `sharedTmp()` under a hash of what makes it (the app's code, the
  sample, the bundles, Vaultite/plugins, the day): a change makes another. Never put one script's state in it.
- Tests use made-up data only: agents' homes are `tools/fixtures/<id>` (Vaultite/plugins': `<id>/.test/fixtures`),
  pointed at by env vars (`tools/test/vault/harness.ts`), never this machine's.
- `tools/test_agents_linux.ts` (not in `npm test`: it starts real terminals on a sandbox server) runs the app's agents
  end to end on `tools/test/agentkit.ts`, which Vaultite/plugins' agent tests use too: keep its names stable.
- Performance: `tools/perf/` (moving around the app, step by step: `motion.mjs`) and `web/qa/perf.mjs`; compare before
  and after on servers run alternately. A real vault (one brought from Obsidian): `node tools/perf/bigvault.ts --vault
  <dir> --root <before checkout>`, on a copy; never commit one.
- Transfer (bytes, requests and round trips over an emulated phone network): `tools/perf/transfer.ts`, through
  `netem.ts` (a TLS, HTTP/2 proxy as Tailscale Serve is, behind a link with its round trip and bandwidth); CI's transfer
  job runs it on each push and pull request against the base and fails over `transfer.json`'s ceilings (lower them
  after a win: `transfer_report.ts <result> --ratchet`, commit it). What a deploy costs a phone's cache over main's last
  commits, and another way of splitting the app tried on them: `churn.ts`.
- `build_helpers.ts --cache <dir>` (the root store's) reuses a native helper by its name, its sources' hash: anything
  a helper is built from goes into that hash (a `salt`), or a root gets a stale one from the cache.
