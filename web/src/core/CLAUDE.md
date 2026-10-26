# Notes for `web/src/core/`

## Live
The server pushes changed paths (`core/live.ts`); `web/src/core/live.ts` reloads.
- Every app write goes through `tracked()` (data.ts does it for non-GETs): a store refresh waits for the app's own writes
  and is redone if one overtook it. A write that bypasses it flickers.
- A refresh is a patch against the server's last state (`GET /api/state?since=<v>`), never against the optimistic
  store. Treat the store's objects as immutable (sort a copy): they're the base the next patch applies to.
- Editors save `PUT /api/file {path, text, base}`: merged against `base` (`core/CLAUDE.md`, Writes).
- Shared settings are per-key writes (`PATCH /api/config/<name>`, null removes), never a whole list: other devices, the
  CLI and AIs edit the same files.
