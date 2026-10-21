---
type: note
kind: note
---

Life OS turns this vault into a record of your days. You do the living; your AI agent writes it down: tell it what you did (a workout, a meal, a night's sleep, a book, a call) and it files it where these pages read it. Your notes stay plain Markdown, in folders you can open yourself.

## The pages
- [[Today]]: where a day starts. Your routines to tick, today's calendar, sleep, meals and this week's goals.
- [[Home]]: everything at a glance. Projects and ideas as boards, what you edited lately, what you're reading, and a calendar of the month.
- [[People]]: who to reach out to, and when you last did. Each person's note opens as their profile, with a timeline.
- [[Health]]: workouts, sleep, activity and meals, from your logs.
- [[Learning]]: what you study and read, with your books.
- [[Projects]]: each project, its status and links.

## Where things go
- `Logs/<Area>/`: one note per thing you did (workouts, sleep, meals, study). Your agent writes these; the pages above read them.
- `Routines/`: what you mean to do each day or on some days. Tick them on Today; one tied to a log area ticks itself when that log comes in.
- `People/`: one note per person, named as you call them.
- `Projects/`, `Books/`, `Notes/`: a note each. A note with `kind: idea` lands on Home's Ideas board.

## Getting started
1. Ask your agent to log something you did today, and watch Today and Health fill in.
2. Add a routine or two (your agent can, or make a note in `Routines/`).
3. Add your calendar's private iCal link in the Calendar plugin's settings to see your events on Today.
4. Bringing your history from ChatGPT or Claude: AI import turns their exports into notes.

Changed your mind? Settings, Restore previous setup puts your old setup back. The pages and notes it added stay, and this guide is yours to edit or delete.
