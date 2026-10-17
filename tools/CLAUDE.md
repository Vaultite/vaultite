# Notes for `tools/`

- The vault test is areas in `tools/test/vault/` on one in-process app: `node tools/test_vault.ts <area>...` runs some,
  `--list` names them. A new check goes in its area; a new area in `index.ts`.
- Tests use made-up data only: agents' homes are `tools/fixtures/<id>`, never this machine's.
- `tools/test_agents_linux.ts` (not in `npm test`: it starts real terminals on a sandbox server) runs the app's agents
  end to end on `tools/test/agentkit.ts`, which Vaultite/plugins' agent tests use too: keep its names stable.
- Performance: `tools/perf/` and `web/qa/perf.mjs`; compare before and after on servers run alternately.
