## Logs (`Logs/<Area>/<YYYY-MM-DD> <Title>.md`)
One file per thing the user did: a workout, a night's sleep, a meal, a study session, a work conversation. Easiest:
`POST /api/logs [{"area", "date", "title", "source": "claude", "ext_id", "duration_min", "data": {...}}]` (upserts on
source + ext_id, so post again to correct), or `vau log`, or write the file:
````
---
type: log
area: workouts              # an area slug (.vaultite/plugins/logs/data.json); don't invent one
date: 2026-09-27
duration_min: 120           # optional
title: Bouldering
source: claude              # who wrote it
ext_id: climb-2026-09-27    # optional stable id
kind: Climbing
top_grade: V3               # every other key is the log's data: the area's fields
---

Notes about it.
````

- Areas: each area's name, icon, `tint`, parent, fields, `weekly_goal`, `blocks` (drawn under its fields in its
  files) and `link: {label, url}` (on its card) are `areas` in `.vaultite/plugins/logs/data.json`; a log for an area
  that isn't there yet adds it (use an existing one when it's the same thing). Without `areas` there, the areas are those of the plugins that are on (a vault
  plugin brings its own with `plugin.provide("log-areas", () => [{slug, name, icon, tint, parent, fields}])`); an area
  there without an icon or tint takes its plugin's.
- `source` is who wrote it (claude, hevy, apple-health...); with `ext_id` it identifies the log for re-imports.
- Put the file in the area's folder (`Logs/Workouts/`, or wherever that area's logs are), named by date and title. Correct
  a log by editing its file.
- The `log` block goes on top of a log file; `week-goals` and `area` are for pages.
