# Notes for `plugins/core/workspaces/`

- Unused is one definition (`blank.ts`, both sides): never written, reads as null.
- A slot is two halves: what the user sets, its own file (`<n>.json`), and what's open (`layout`, `state`), kept
  (core/kept.ts, shared), so switching tabs writes nothing into the vault. The server refuses to overwrite a file that
  doesn't parse (iCloud mid-sync); the app retries a 503 in order.
- No echo: a device saves only the shared shape and ignores its own writes coming back.
- Every workspace's tabs are the service `tabs:open`, so Terminal never ends a shell one still shows.
