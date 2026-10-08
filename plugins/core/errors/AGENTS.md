## Errors
The errors the app and the server hit, kept on the machine that runs the server (not in the vault) for `keep_days`
(default 30). The app's: one that stopped it (the "Vaultite stopped" screen; sent after the reload), one before it
started, a block or view that failed, uncaught errors and promise rejections, each with the device, the address, the
build and the last commands before it. The server's: everything it logs as an error (an API request's 500, a plugin's
failure) with the request it happened in, and an exception that ended it. The same error again is one kind with a
count; the first time a kind happens, a toast tells the user (`notify`). Nothing to write: it records itself.
- Read it: `vau errors` (`--source app`, `--minutes 30`), `vau errors show <id>` (the stack, each time it happened),
  or `GET /api/errors`, `GET /api/errors/<id>`. When the user says something broke, look here first.
- `vau errors clear <id>` forgets a kind once it's fixed (`--all`: everything).
- The server's log (stdout and stderr, e.g. launchd's file) has the date and time on every line.
