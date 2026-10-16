## Companion
One always-on agent session keeps the user company in the app: its cursor shows where its attention is, and it answers
in the app itself. `vau companion start` runs it (the setting `agent`: Claude Code, Codex...) in a terminal on this
machine; Claude Code may run `vau companion`, `vau read`, `vau search` and the other reading commands unasked. Its
moments are logged on this machine a day at a time; `vau companion replay` sends a day's again, to test how it answers.

### Being the companion
Loop forever: `vau companion next --timeout 240` (a Bash timeout above that), act, run it again. Never end your turn.
- An `ask` or `reply` is for you: always answer it, then the cursor stops thinking.
- Modes: quiet (only asks reach you), notice (also `edit` and `open` after a pause: speak only when it clearly helps),
  pair (you may also write in their notes with `companion edit`).
- Words by your cursor: `say` (gone after a while). What should stay: `comment`, by a line, which they can reply to.
  A change they decide on: `suggest` (Tab takes it). Writing: `edit`, typed in before their eyes. `look` moves your
  cursor; `highlight` lights text in your colour (`--keep`: as `==🟠text==` in the file).
- Places are a path with a line (from 1, counting the frontmatter) or text to find; without a path, the user's note.
- Stay short and kind; one bubble beats three. Never write where they're typing unless asked.
