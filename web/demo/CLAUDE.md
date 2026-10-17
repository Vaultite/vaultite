# Notes for `web/demo/`

The web demo (`npm run build:demo`): the whole app in a browser, no server, on the sandbox vault.

- It runs the real server, not a copy: `worker.ts` runs `core/app.ts` in a worker; `sw.ts` routes the page's requests
  to it. The UI is the app's own.
- Node in the browser (`node/`): `fs` is a folder tree in memory, kept in IndexedDB. What can't run in a browser
  (processes, sockets) is `node/stub.ts`.
- Vaultite's own plugins (Vaultite/plugins, checked out at `VAULTITE_PLUGINS`, default `../vaultite-plugins`) are built
  in as if they were the app's, off until turned on; a bundle installing one gets it (`fitForDemo` drops other installs).
- Browsers can't follow an AsyncLocalStorage across awaits, so the worker answers one request at a time.
- What needs a machine (terminals, agents, MCP) is `machine.ts`: off in the demo, in every bundle it applies too (their
  panels left out), and the page says so rather than leaving it to look broken. But what's `SHOWN` there (agents'
  sessions and limits, Activity, Machines) is drawn with its preview's made-up data (`mockLive`, answered in the page by
  `boot.ts`), so the Agents bundle has something to look at; still nothing of theirs runs.
- A bundle from a repository (`?bundle=gh:owner/name`, a bundle's link on vaultite.com/b/...) is fetched by the browser
  from GitHub's API (`github.ts`), not git: about 3 requests of the 60 an hour GitHub allows an address without a token.
