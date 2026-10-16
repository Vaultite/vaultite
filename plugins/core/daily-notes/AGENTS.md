## Daily notes (`Daily/<YYYY-MM-DD>.md`, or as the settings name them)
A daily note is that day's page: `type: day`, the body free; other plugins may keep keys of their own in it.
They're named by their date in the `format` setting (YYYY-MM-DD; `YYYY/MM/YYYY-MM-DD` makes folders) in their folder
(`.vaultite/folders.json`'s `days`; unset, Obsidian's daily-notes.json, else where most are). With a folder set, a note
named that way there is one without `type: day`. `vau daily [--date]` gives a day's note, made from the `template`
setting (a note's path without .md) when there's none; "Open today's daily note" too.
