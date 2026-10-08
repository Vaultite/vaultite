## Activity
What was done to the vault and the app, and by whom, kept on the machine that runs the server (not in the vault) for
`keep_days` (default 14): your edits, moves and settings in the app, files and views you opened, commands and drag and
drops; coding agents working through the API or the `vau` CLI (found from the process that called, tied to the app's
terminal they run in; Claude Code started in the app also reports each file it edits and each command it runs);
scripts; and changes on disk no request made (iCloud, another app, an editor). Plus timings: every API route's, the
server's memory and event loop, and each app window's load. Nothing to write: it records itself. Its settings are below.
- Read it: `vau activity` (`--actor agent`, `--action changes` (changes, opens, commands, settings, other),
  `--path Notes/Idea.md`), `vau perf`, or `GET /api/activity?limit=&actor=&action=&path=`,
  `GET /api/activity/summary?days=1`, `GET /api/activity/perf`.
- The `perf-server`, `perf-routes` and `perf-app` blocks are on the Activity page's Performance tab.

## Recaps (`Recaps/<YYYY-MM-DD>.md`)
What the user did each day, kept in the vault for good: `type: recap`, named by its date, the body one line per thing
done, oldest first, each line's quote (`  > `) the text it changed and its list (`  - `) the files of a session or batch:
````
---
type: recap
---

- 08:40 Completed "Call the bank" · [[Open]] → [[Closed]]
- 09:12 Captured [[Raindrop/A page|A page]] · Raindrop
  > The passage highlighted
- 11:02 Edited [[Notes/Idea|Idea]] · 2 changes
  > The line added
- 15:00 Claude Code changed 3 files · Fix the tabs
  - [[Notes/Plan|Plan]]
````
- Written by the app from this machine's Activity and File history: today's every few minutes while things change,
  yesterday's until 03:00, earlier days once (back as far as File history keeps versions). Don't write the entries;
  lines of the user's own above or below them stay. Read one with `activity.recap` (`vau recap yesterday`).
- Yours (the app, another device's edits arriving on disk) one by one; an agent's edits one line per session, except
  records of the user's life (logs, people, books...: their plugin is about life or health), which stay one by one
  with `by <agent>`. Tasks are Markdown checkboxes (`[x]` done, `[-]` cancelled, `[/]` started, the Tasks plugin's own
  statuses too); one that leaves a file for another is moved, a recurring one's next copy isn't new. A new file is a
  capture when it has a sync plugin's `<name>_id` (Raindrop's `raindrop_id`), a web address it was saved from, or is in
  a `capture_folders` folder; a note given a recording is one too.
