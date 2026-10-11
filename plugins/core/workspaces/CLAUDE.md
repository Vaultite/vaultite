# Notes for `plugins/core/workspaces/`

- Unused is one definition (`blank.ts`, both sides): never written, reads as null.
- Each slot is its own file (`<n>.json`), so devices on different workspaces never write the same file through iCloud.
  The server refuses to overwrite a slot that doesn't parse (iCloud mid-sync); the app retries a 503 in order.
- No echo: a device saves only the shared shape and ignores its own writes coming back.
- Every workspace's tabs are the service `tabs:open`, so Terminal never ends a shell one still shows.
