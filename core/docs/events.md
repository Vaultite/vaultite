## Events
What happens in the vault and the app, as one stream you can wait on or follow: files changed on disk (whoever changed
them: the app, an agent, iCloud), files moved or deleted through the API, operations that wrote something. Use it to
react to a change instead of polling, or to wait until the user (or another agent) has done something.

Every event is one JSON object: `{"type", "seq", "t" (ms since 1970), "cursor", ...its data}`. Types:
- `file.changed` `{paths}`: files changed on disk (vault paths; `paths` null: anything may have).
- `file.moved` `{from, to}`: a file or folder moved or renamed through the API, or restored from `.trash`.
- `file.trashed` `{path}`: a file deleted through the API (it's in `.trash`).
- `op.done` `{id, plugin, kind, who, params, ok, error, ms}`: a write operation ran (or failed): who asked
  (`{client, agent, label}`), a short summary of its parameters.
- `inbox.event` `{id, kind, source, title, terminal?, session?, link?}`: something reached the user's inbox: an agent
  finished (`done`) or is waiting for an answer (`waiting`), or a message (`info`, `error`: `vau notify`). How to
  wait for another agent: `vau events.wait --types inbox.event --timeout 600`, then check its `terminal`.
- `<plugin>.<name>`: a plugin's own (`plugin.emit`), named after the plugin.

Filters, the same everywhere: `types`, a list of types or areas (`file` is every file event, `file.*` too); `path`, a
vault path prefix (an event matches when one of its paths starts with it; `file.changed` keeps only those paths).

The server keeps the last 500 in memory (a restart forgets them). Each answer has a `cursor`: pass it as `after` next
time and nothing in between is missed.

Ways in:
- Wait for the next ones: `vau events.wait --types file.changed --path Notes/ --timeout 60` (MCP's `events_wait`, `POST
  /api/ops/events.wait {types, path, after, timeout}`): the events after `after`, or, when there are none yet, the
  next one, at most `timeout` seconds (then none). `events.list` answers the recent ones.
- Follow them: `vau events [--type file,op.done] [--path Notes/] [--once] [--timeout s] [--after cursor]` prints one
  JSON object per line as they come (`--json`: one list when it ends).
- Over HTTP: `GET /api/events/stream?types=file.changed&path=Notes/` is Server-Sent Events (`curl -N`, or an
  `EventSource`): `id: <cursor>`, `event: <type>`, `data: <event>`; `after=<cursor>` (or the `Last-Event-ID` an
  `EventSource` sends again) first sends what came since.
- In a vault plugin: `plugin.onEvent({ types, path }, (ev) => ...)` in its plugin.ts, or, with no code, a command per
  event in its manifest's `events` (`vau docs vault-plugins`).

The app's own windows follow changes over `/api/events` (a WebSocket of their own); that one isn't for scripts.
