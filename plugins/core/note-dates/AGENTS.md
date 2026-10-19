## Note dates (`created`, `updated`)
A plain note (no `type`, or `type: note`) the app makes, through the API, vau or MCP as much as in the app, gets two
properties in local time: `created: '2026-09-28 18:00:00'` when it's made, and `updated`, the same then, moved to the
time of each save that changes its text (properties alone don't count). Don't write or bump them yourself: write the
note, and the app keeps them. A date a note is given when it's made, or that a save sets itself, stays as given.

Notes that have no `updated` don't get one when edited: the app adds the dates only to the notes it makes. Not dated:
files of other kinds (people, logs: their own dates), hidden folders, the templates folder, and other plugins' formats
(a `kanban-plugin:` board). The property names are the plugin's settings (`created`, `updated`; empty turns one off),
in `.vaultite/plugins/note-dates/data.json`.
