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
- The desktop main process's launch budget (`tools/perf/startup.ts --main`, from the sources) runs in pre-push: over
  it, import the new code lazily, or raise its limit in `startup.json` in the same commit.
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
