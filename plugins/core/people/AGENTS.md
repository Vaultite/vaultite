## People (`People/<Full name>.md`)
One file per person; the file name is the name used everywhere. `POST /api/people`, `POST /api/interactions` (a
timeline line, placed by date), or edit the file:
````
---
type: person
relation: friend            # partner | family | roommate | friend | mentor | contact (not really talked yet)
every_days: 30              # how often the user wants to be in touch; leave out if no target
context: Met at a design course at university    # how the user knows them, one line
location: Austin, TX      # a place name; the app finds its pin
tags: [University]
want_to: Catch up about the move   # optional to-do about them; remove the line when done
aliases: [Alice]              # optional other names, so [[Alice]] resolves
---

Durable facts about them, in short sentences.

## Timeline

- 2026-09-28 · call · 30 min · Talked about the new job
- 2026-09-20 · email · **Subject line** · What it was about · <https://link>
- 2026-09-18 · note · A fact the user told you about them, dated
````
- Timeline lines newest first, one each: `- YYYY-MM-DD · kind[ · N min] · text`; optional `**Subject**` after the kind
  and `<https://url>` at the end. Kinds: call, hang out, meet, study, text, message, email (being in touch) and note (a
  fact). Log notable exchanges, not every chat. Something that may change (a job move considered) is a dated note.
- Never delete a timeline or "fix" the user's own lines (the app reads hand-typed ones); add yours in this form. Don't
  rename files unless asked (add `aliases`); then `vau move`, which updates links.

More keys: `usual: call` (usual way to stay in touch), `coordinates: [30.27, -97.74]` (only when you know the exact
spot; else the map looks `location` up and keeps the pin in its cache, never in the file), `moving_to: Baltimore, MD` (an upcoming move), `contact` (an email, URL or
handle), `sort: 3` (the order people are listed in, lower first; don't renumber it, the app never writes it).
- The app also reads lines typed by hand: ` - ` or ` | ` between parts, "Call", "1h 30m", no kind (a note). A long
  entry may continue on indented lines under it. Other sections may follow the timeline (`## Gift ideas`); leave them.
- The user's own pin: `PUT /api/me {"location"}`. Check a place: `GET /api/geocode?q=`.
- The `person` block goes on top of a person's file; `people-due`, `people-wants` and `people-group` are for the People
  page.
