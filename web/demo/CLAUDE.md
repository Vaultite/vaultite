# Notes for `web/demo/`

The web demo (`npm run build:demo`): the whole app in a browser, no server, on the sandbox vault.

- It runs the real server, not a copy: `worker.ts` runs `core/app.ts` in a worker; `sw.ts` routes the page's requests
  to it. The UI is the app's own.
- Node in the browser (`node/`): `fs` is a folder tree in memory, kept in IndexedDB. What can't run in a browser
  (processes, sockets) is `node/stub.ts`.
- The demo bundles every import the core reaches, lazy ones too. A server-only heavy module (the module graph's parser)
  comes from `server.ts` through a hook (`core/update/graph.ts`), never imported by the core; `npm run check` fails when
  the demo's reach (`node tools/closure.ts --entry demo`) has `core/update/closure.ts`.
- Vaultite's own plugins (Vaultite/plugins, checked out at `VAULTITE_PLUGINS`, default `../vaultite-plugins`) are built
  in as if they were the app's, off until turned on; a bundle installing one gets it (`fitForDemo` drops other installs).
- Browsers can't follow an AsyncLocalStorage across awaits, so the worker answers one request at a time.
- What needs a machine (terminals, agents, MCP) is `machine.ts`: off in the demo, in every bundle it applies too (their
  panels left out), and the page says so rather than leaving it to look broken. But what's `SHOWN` there (agents'
  sessions and limits, Activity, Machines) is drawn with its preview's made-up data (`mockLive`, answered in the page by
  `boot.ts`), so the Agents bundle has something to look at; still nothing of theirs runs.
- A bundle from a repository (`?bundle=gh:owner/name`, a bundle's link on vaultite.com/b/...) is fetched by the browser
  from GitHub's API (`github.ts`), not git: about 3 requests of the 60 an hour GitHub allows an address without a token.
  The app's own (`gh:Vaultite/vaultite/bundles/<id>`) are the demo's built-in copies instead: no GitHub, and the same
  as the home page's picker (the Browser's live sites).
- Each bundle's page (`?bundle=gh:...`) is a space of its own (`space.ts`): its vault in IndexedDB, the app's
  localStorage and sessionStorage keys, its drafts. So no page shows what another bundle left (Glass is a look no layout
  undoes), and Reset starts that bundle again. vaultite.com's home page and `/demo` share the main one.
- Research is a space of its own too, on a researcher's made-up vault (`research.ts`, `researchfiles.ts`: the files in
  `research/`, real works cited) instead of the sample, its paper open first; picking it, or another layout from it,
  reloads the page into the other space. Its bundle brings no example files: in a real vault, or the sample, it adds only
  its guide.
- The Browser bundle's tabs show a few sites live (`sites.ts`: framed by web-viewer's FramedPage.tsx), pinned and opened
  as it's turned on, each with a note about it. A site added must allow framing, run no trackers and load nothing from
  elsewhere: visitors' browsers reach it, and vaultite.com/privacy says who sees them.
