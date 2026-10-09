## Routines (`Routines/<Name>.md`) and daily notes (`Daily/<YYYY-MM-DD>.md`, or as the settings name them)
A routine is something to do every day or on some: `type: routine`, optional `area` (a log area), `days: [mon, wed,
fri]` (left out: every day), `auto: log` (ticks itself when a log in its area comes in that day; `auto: bed before
22:00` when that night's sleep starts before 22:00), `sort` (its place on Today), `icon` (a Lucide name or an emoji; left out: its area's). A daily note is that day's page:
`type: day`, `done: [Stretch, Journal]` (the routines ticked by hand, by name), the body free. Tick one:
`POST /api/checks {"routine", "date", "done": true}`.

Daily notes are named by their date in Today's `format` setting (YYYY-MM-DD; `YYYY/MM/YYYY-MM-DD` makes folders) in
their folder (Today's settings: `.vaultite/folders.json`'s `days`; unset, Obsidian's daily-notes.json, else where most
are). With a folder set, a note named that way there is one without `type: day`. `vau daily [--date]` gives a day's
note, made from the `template` setting (a note's path without .md) when there's none; "Open today's daily note" too.
The `routines` block is on the Today page. `archived: true` hides a routine.
