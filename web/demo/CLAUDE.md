# Notes for `web/demo/`

The web demo (`npm run build:demo`): the whole app in a browser, no server, on the sandbox vault.

- It runs the real server, not a copy: `worker.ts` runs `core/app.ts` in a worker; `sw.ts` routes the page's requests
  to it. The UI is the app's own.
- Node in the browser (`node/`): `fs` is a folder tree in memory, kept in IndexedDB. What can't run in a browser
  (processes, sockets) is `node/stub.ts`. A server module importing a new `node:` module or native package needs an
  alias in `vite.demo.config.ts`, or the demo build breaks.
- Browsers can't follow an AsyncLocalStorage across awaits, so the worker answers one request at a time.
- What needs a machine (terminals, agents, MCP) is `machine.ts`: off in the demo, in every bundle it applies too (their
  panels left out), and the page says so rather than leaving it to look broken.
- A bundle from a repository (`?bundle=gh:owner/name`, a bundle's link on vaultite.com/b/...) is fetched by the browser
  from GitHub's API (`github.ts`), not git: about 3 requests of the 60 an hour GitHub allows an address without a token.
