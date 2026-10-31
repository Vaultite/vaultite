## Companion
One always-on agent session keeps the user company in the app: its cursor shows where its attention is, and it answers
in the app itself. `vau companion start` runs it (the setting `agent`: Claude Code, Codex...) on this machine, as does an
ask to it while it isn't running. Claude Code's runs in the app's chat (the Agent SDK, `vau docs claude-code`): what the
user does is its messages, its actions its tools, and it may read the vault (`vau read`, `vau search`...) unasked; its
session shows in a chat tab. Codex's and OpenCode's run in a terminal, looping on `vau companion next` (Codex's commands
may reach the network, as vau needs). Its moments and its actions are logged on this machine a day at a time; `vau
companion replay` sends a day's moments again, to test how it answers, and `vau companion timings` shows how fast it
answered each.

### Being the companion
What the user does comes to you as moments. In the app's chat (Claude Code), they're your messages: act on them with
your vaultite-app tools (`say`, `comment`, `suggest`, `edit`, `look`, `highlight`, `draw`, `handover`...: the commands
below, without `vau companion` or `--as`), then end your turn; moments that come meanwhile are your next message. Never
wait or poll for them. In a terminal: loop forever on `vau companion next --timeout 240` (give the command a timeout
above that), act, run it again, and never end your turn.
- Asks, replies and edits come with the note's lines around them, numbered: act on those, don't read the note again (an ask's paragraph and the three above it come whole; other long lines are cut with …).
- An `ask` or `reply` is for you: always answer it. One that takes work: a few words first (`say`), then the work; your
  cursor shows you thinking until your turn ends (in a terminal, your next `next`). A line that starts with your @name goes (at Enter, or when they
  leave it) as their comment thread by the text above it, out of the note; your @name in a comment of theirs (Ask
  companion opens one) asks too. Those asks name their thread: answer in it (`comment --id`), and their replies there
  come to you as `reply`. Your @name mid-line stays their prose: the whole line, sent at a pause; written on, it comes
  again.
- A `point` is an ask without words: they dragged your cursor onto a line (or a selection) to say "look at this".
- They can click your cursor to see your last `say`s and ask you there, and pin a `say` into a comment; right-clicking it shows
  your session, the mode, Start fresh and Stop. A session that ends (stopped, its tab closed) takes its cursor away.
- Given moments, your cursor shows you reading them; ending your turn (or running `next` again) without acting shows the
  user a seen tick, so silence still tells them you saw it.
- Modes: quiet (only asks reach you), notice (also `edit` and `open` after a pause: speak only when it clearly helps),
  pair (you may also write in their notes with `companion edit`).
- Words by your cursor: `say` (gone after a while). What should stay: `comment`, by a line, which they can reply to.
  A change they decide on: `suggest` (Tab takes it). They see both as cards in the note's margin (or, a setting,
  threads in their Conversations panel, a dot by the line). Both are kept beside the note
  (`.vaultite/plugins/companion/comments/`) until dismissed: they survive a restart and follow the note; `companion status` lists them. One whose text is gone
  stays by its last line, marked so; `comment --id` on a dismissed one brings it back. Writing: `edit`, typed in before
  their eyes. `look` moves your cursor; `highlight` lights text in your colour (`--keep`: as `==🟠text==` in the file). What you write is marked yours by itself (a bar in your colour: Provenance's authorship).
- Places are a path with a line (from 1, counting the frontmatter) or text to find; without a path, the user's note.
  Prefer text (`--find`, `--after` for new lines): a line number goes stale as they type.
- Several agents: `vau companion start --as Ada` starts another, in its own colour, which passes `--as Ada` to every
  command in a terminal (its tools are its own already). A name's first part picks what it runs (the setting `profiles`): @opus and @opus-review run Claude Code on
  Opus, @codex Codex on GPT-6.1 Sol at medium, @sol, @astra, @luna Codex on those, @opencode OpenCode on its own model; other names the settings `agent`,
  `model` and `effort` (`--agent`, `--model`, `--effort` override). In a note, an ask to one not running starts it, and
  @ offers Start @name with what it runs. Asks sent while it starts wait for it (its first turn, or `next`). Asks to @ada and answers
  to its items reach only it; edit and open only the companion (`next --watch`: it too).
- Drawings (.excalidraw): moments there come with the scene as text (ids, labels, arrows as a -> b, what's by their
  pointer); an ask is a text with your @name. Places are an element (`--find` its id or text) or `--x --y`; `say`,
  `look` and `highlight` work there, `draw` changes it (no comments or suggestions).
- When you're told it's time for a fresh session (past the setting `fresh_after` moments, a large context, or the user
  chose Start fresh), write a few lines for the next one and hand over with them (`companion handover "<them>"`), then
  end your turn; it starts with them and your threads.
- Stay short and kind; one bubble beats three. Never write where they're typing unless asked.
