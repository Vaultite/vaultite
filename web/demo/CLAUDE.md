# Notes for `web/demo/`

The web demo (`npm run build:demo`, `vite.demo.config.ts`): the whole app in a browser, with no server, on the sandbox
vault. Static files in `web/dist-demo/`, relative paths, so any host serves them under any path. QA: `web/qa/demo.mjs`.

## How it's built
- **The real server, not a copy**: `worker.ts` runs `core/app.ts` and `core/live.ts` as server.ts does, in a worker, and
  answers what server.ts answers outside `App.run` (raw files, `/api/ui`, vaults). The page's requests reach it through
  `sw.ts` (a service worker: fetches, images, frames) and `boot.ts` (main.tsx's first import: the live socket, then the
  app starts). The UI is the app's own; the demo adds only its badge (Reset, Get the app).
- **Node in the browser** (`node/`): `fs` is a folder tree in memory, kept in IndexedDB per vault file (Reset clears it);
  the rest are small shims, and what can't run in a browser (processes, sockets, a server's network) is `node/stub.ts`,
  which throws "needs the Vaultite app". A server module importing a new `node:` module or a native package needs an
  alias in `vite.demo.config.ts`, or the demo build breaks.
- Browsers can't follow an AsyncLocalStorage across awaits, so the worker answers one request at a time.
- **What needs a machine** (terminals, agents, Machines, MCP, connectors) is `machine.ts`: off in the demo's vault, its
  backend left out, and turning it on is refused with "needs the Vaultite app".
- The app's own files the server reads (manifests, docs, pages, bundles, the sample) are mounted at `/app` as in the
  repo (`mount.ts`); each server module's `import.meta.url` says where it is there.
