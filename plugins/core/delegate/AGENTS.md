## Delegation
Hand a task to another coding agent, as your subagent: `vau delegate <claude|codex|opencode> "<task>"` (MCP's
`delegate`). Worth it for a second opinion from another model (Codex reviewing your plan or diff), for parallel work
(several subagents on independent parts, `--mode async`), or for something another model does better or cheaper
(`--model haiku`). Not for what you can do in a step or two yourself: a subagent starts with none of your context.
- Write the task to stand alone: the goal, where (`--cwd`, default your folder), what to answer. It reads none of your
  conversation, and its last message is your answer (with the files it changed).
- `--mode wait` (default) answers when its turn ends, at most `--timeout` seconds (100; keep it under your shell's
  timeout), then it goes on as async. `--mode async` answers its id at once; its result comes to you as a message
  when it's done. `vau delegate status <id> --wait 300`, `vau delegate send <id> "<more>"`, `vau delegate list`.
- It never gets more permissions than you (`--permissions`, default yours). What it asks permission for goes to the
  user, not you; a question it asks (AskUserQuestion) you may answer: `vau delegate answer <id> --picks 1`.
- `vau delegate cancel <id>` stops it and every subagent it started.
- Small runs: Claude on `--model haiku` or sonnet, Codex at `--effort low` unless the task needs more.
