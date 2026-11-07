# Notes for `tools/`

- The vault test is areas in `tools/test/vault/` on one in-process app: `node tools/test_vault.ts <area>...` runs some,
  `--list` names them. A new check goes in its area; a new area in `index.ts`. Many areas run in parallel shards, each
  with its deps (`--jobs 1`: in one process): an area leaves the vault as it found it, and waits on events, not the clock.
- A test or QA entry point imports `tools/test/isolate.ts` first (`test/lib.ts` and `web/qa/lib/qa.mjs` do): the run
  gets its own TMPDIR, removed at its end, and fails if anything in it reached the user's own vaults (`core/testrun.ts`:
  a test's server or app refuses one, the user's server refuses its `vau`, claude.ai connectors are off). Make temp
  folders with `os.tmpdir()`, never a fixed `/tmp` path; what must outlast a run (built helpers) goes in `sharedTmp()`.
- Tests use made-up data only: agents' homes are `tools/fixtures/<id>` (Vaultite/plugins': `<id>/.test/fixtures`),
  pointed at by env vars (`tools/test/vault/harness.ts`), never this machine's.
- `tools/test_agents_linux.ts` (not in `npm test`: it starts real terminals on a sandbox server) runs the app's agents
  end to end on `tools/test/agentkit.ts`, which Vaultite/plugins' agent tests use too: keep its names stable.
- Performance: `tools/perf/` (moving around the app, step by step: `motion.mjs`) and `web/qa/perf.mjs`; compare before
  and after on servers run alternately. A real vault (one brought from Obsidian): `node tools/perf/bigvault.ts --vault
  <dir> --root <before checkout>`, on a copy; never commit one.
