## Routines (`Routines/<Name>.md`)
A routine is something to do every day or on some: `type: routine`, optional `area` (a log area), `days: [mon, wed,
fri]` (left out: every day), `auto: log` (ticks itself when a log in its area comes in that day; `auto: bed before
22:00` when that night's sleep starts before 22:00), `sort` (its place on Today), `icon` (a Lucide name or an emoji; left
out: its area's). `archived: true` hides a routine.

The routines ticked by hand on a day are that day's daily note's `done: [Stretch, Journal]`, by name (`vau docs
daily-notes`: where daily notes are). Tick one: `vau routine check Stretch [--date]`. The `routines` block is on the
Today page.
