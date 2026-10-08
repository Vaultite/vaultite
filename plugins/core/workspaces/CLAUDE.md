# Notes for `plugins/core/workspaces/`

- Five desks, each its tabs, its sidebars and pinned pages (optional: sidebars.json and pages.json are the defaults; the
  first pin copies them, `POST /api/workspaces/<n>/pins`) and `state` (useScopedState's values, merged per key). There's
  always a current one. **Unused is one definition** (`blank.ts`, both sides): never written, reads as null.
- Each slot is its own file (`<n>.json`), so devices on different workspaces never write the same file through iCloud.
  The server refuses to overwrite a slot that doesn't parse (iCloud mid-sync); the app sends writes in order and retries
  a 503 for about half a minute (`queue`). No echo: a device saves only the shared shape and ignores its own writes coming
  back; a switch is `replaceWorkspace` (nothing closed).
- The window tells the server its workspace (`active`), so `vau panels`, `vau pin` and `vau context` act on the one the
  user sees. Every workspace's tabs are the service `tabs:open` (terminal tabs saved with their machine), so Terminal never ends a shell one still shows. Moves
  between workspaces: `POST /api/workspaces/move`; closing tabs from outside: `POST /api/workspaces/close`.
- Desktop: one switcher in the sidebar's header (a drag over it springs it open); phones: the tab list's title, swiped between (`menu` and `switchTo` in its host).
