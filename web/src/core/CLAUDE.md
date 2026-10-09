# Notes for `web/src/core/`

## How it's built
- **Live** (`core/live.ts` on the server pushes changed paths over `/api/events`; `web/src/core/live.ts` reloads):
  - Every app write goes through `tracked()` (data.ts does it for non-GETs): a store refresh waits for the app's own
    writes and is redone if one overtook it. A write path that bypasses it flickers.
  - A store refresh is a patch against the server's last state (`GET /api/state?since=<v>`, `core/statepatch.ts`),
    never against the optimistic store: never change the store's objects in place (sort a copy), they're the base the
    next patch applies to.
  - Editors save `PUT /api/file {path, text, base}` (core/autosave.ts): a change on disk meanwhile is 3-way merged
    (`merge.ts`), 409 when the same lines changed. A change from disk enters an editor as per-run changes, so the cursor
    stays.
  - A move through the API is `moved` over the socket: tabs follow, unsaved typing goes to the new path (`whereNow`).
  - Shared settings are per-key writes (`PATCH /api/config/<name>`, null removes; pins one `POST /api/pins` per change),
    never a whole list: other devices, the CLI and AIs edit the same files.
  - Two servers on one iCloud vault mustn't loop: the watcher only re-reads, and a read never writes (a kind's `fill`
    runs on the app's own writes: `Vault.fillIn`).
