## Companion
One always-on agent session keeps the user company in the app: its cursor shows where its attention is, and it answers
in the app itself. `vau companion start` runs it (the setting `agent`: Claude Code, Codex...) in a terminal on this
machine; Claude Code may run `vau companion`, `vau read`, `vau search` and the other reading commands unasked. Its
moments and its actions are logged on this machine a day at a time; `vau companion replay` sends a day's moments again,
to test how it answers, and `vau companion timings` shows how fast it answered each.

### Being the companion
Loop forever: `vau companion next --timeout 240` (a Bash timeout above that), act, run it again. Never end your turn.
- Asks, replies and edits come with the note's lines around them, numbered: act on those, don't read the note again.
- An `ask` or `reply` is for you: always answer it. One that takes work: a few words first (`say`), then the work; your
  cursor shows you thinking until your next `next`. An ask is a line with your @name anywhere in it (sent at Enter, or
  when they pause): its text is what follows a leading @name, else the whole line; written on after it went, it comes
  again.
- A `point` is an ask without words: they dragged your cursor onto a line (or a selection) to say "look at this".
- They can click your cursor to see your last `say`s and ask you there, and pin a `say` into a comment.
- Given moments, your cursor shows you reading them; running `next` again without acting shows the user a seen tick,
  so silence still tells them you saw it.
- Modes: quiet (only asks reach you), notice (also `edit` and `open` after a pause: speak only when it clearly helps),
  pair (you may also write in their notes with `companion edit`).
- Words by your cursor: `say` (gone after a while). What should stay: `comment`, by a line, which they can reply to.
  A change they decide on: `suggest` (Tab takes it). They see both as threads in their Conversations panel, a dot by the
  line (or as margin cards). Both are kept beside the note (`.vaultite/plugins/companion/comments/`)
  until dismissed: they survive a restart and follow the note; `companion status` lists them. One whose text is gone
  stays by its last line, marked so; `comment --id` on a dismissed one brings it back. Writing: `edit`, typed in before
  their eyes. `look` moves your cursor; `highlight` lights text in your colour (`--keep`: as `==🟠text==` in the file).
- Places are a path with a line (from 1, counting the frontmatter) or text to find; without a path, the user's note.
  Prefer text (`--find`, `--after` for new lines): a line number goes stale as they type.
- Several agents: `vau companion start --as Ada` (`--agent codex`) starts another, in its own colour, which passes
  `--as Ada` to every command; in a note, @ and a new name offers Start @name. Claude Code runs Sonnet at medium effort
  (the settings `model` and `effort`, or `--model`, `--effort`); asks sent while it starts wait for its first `next`.
  Asks to @ada and answers to its items reach only it; edit and open only the companion (`next --watch`: it too).
- Drawings (.excalidraw): moments there come with the scene as text (ids, labels, arrows as a -> b, what's by their
  pointer); an ask is a text with your @name. Places are an element (`--find` its id or text) or `--x --y`; `say`,
  `look` and `highlight` work there, `draw` changes it (no comments or suggestions).
- When `next` says it's time for a fresh session (past the setting `fresh_after` moments, or a large context), write a
  few lines for the next one and run `companion handover "<them>"`, then end your turn; it starts with them and your
  threads.
- Stay short and kind; one bubble beats three. Never write where they're typing unless asked.
