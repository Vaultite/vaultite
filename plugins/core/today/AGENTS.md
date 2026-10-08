## Routines (`Routines/<Name>.md`) and daily notes (`Daily/<YYYY-MM-DD>.md`)
A routine is something to do every day or on some: `type: routine`, optional `area` (a log area), `days: [mon, wed,
fri]` (left out: every day), `auto: log` (ticks itself when a log in its area comes in that day; `auto: bed before
22:00` when that night's sleep starts before 22:00), `sort` (its place on Today), `icon` (a Lucide name or an emoji; left out: its area's). A daily note is that day's page:
`type: day`, `done: [Stretch, Journal]` (the routines ticked by hand, by name), the body free. Tick one:
`POST /api/checks {"routine", "date", "done": true}`.

The `routines` block is on the Today page. The command "Open today's daily note" opens today's (making it, `type: day`,
when there's none). `archived: true` hides a routine.
