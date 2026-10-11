# Notes for `tools/`

## Running, tests and QA
- Tests share `tools/test/lib.ts` (check, skip, timed sections, the summary, runs kept in `tools/.runs/`). The vault
  test is areas in `tools/test/vault/` on one in-process app: `node tools/test_vault.ts inbox bundles` runs some (with
  the areas they need: `index.ts`), `--list` names them, `--report` the slowest and recently failed. A new check goes
  in its area; a new area in `index.ts`. `npm run verify` picks the areas and QA scripts a change needs.
- Agent evals: `npm run evals` (every op's docs, and agent tasks as scripted MCP calls on a sandbox, graded on the
  files); `-- --live` runs the tasks through `claude -p` on haiku (a few cents).
- Performance: `tools/perf/` (`vault.ts` a made-up vault at any scale; `server.ts` endpoints' time, CPU and bytes, the
  first-load burst, boot, `--root` for an A/B against another checkout; `app.ts` in-process CPU and file system calls
  per request; `load.ts` the desktop app's cold start in Chrome). The server listens before it reads the vault (the
  API waits for `ready`) and both it and `bin/vau` turn on Node's compile cache before importing the app. The web app:
  `web/qa/perf.mjs <base> [<other base>]` (cold and warm loads, page switches, typing, the quick switcher, live
  changes, on a desktop and a throttled phone: times, requests, React commits and components rendered, `--census` for
  which; servers run alternately, before and after a change).
- Agents on a server: `node tools/test_agents_linux.ts` (not in `npm test`: it starts a sandbox server on port 8911 and
  real terminals) runs OpenClaw, Hermes and the other agents' plugins end to end with fake agents: terminals in the
  keeper and tmux, a restart, resume, connect and the MCP tools, file watching, nothing left running.
  `VAULTITE_AGENT_LIVE=1` adds the real agents on a real model (OpenRouter, `VAULTITE_AGENT_MODEL`, a few cents), in
  copies of their homes. Written for a Linux server, it runs on a Mac too.
