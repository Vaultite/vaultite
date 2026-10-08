## Inbox (`Inbox/<Title>.md`, and events)
Something for the user to read later (research, a summary): `vau inbox add "<title>" --tldr "<in short>" --body
"<markdown>"` (MCP's `inbox_add`). A long task finished: `vau notify "<text>"`.

**Results**: a file in `Inbox/` for the user to review, then mark done or file into a folder:
````
---
type: inbox
status: new                 # new | done
from: Claude                # who put it here
source: https://example.com/a-page   # optional: the page it's about (the same address again updates it)
created: '2026-10-01 18:00:00'      # UTC, set by the app
updated: '2026-10-01 19:30:00'      # UTC, set by the app: its thread's latest report (an agent's, after a reply)
---

What it says, as Markdown.
````
- Mark it done with `vau inbox done <path>`, not by editing `status` (that leaves the file in place): done is archived,
  into `Inbox/.archive/`. A clip lands here with `inbox: true`.
- **A TL;DR on top** of every result you write (`--tldr`): what it says and what you need from the user, in two or
  three plain sentences.
- **A report** ends a task you were handed to do alone (a voice note, a dispatch): `vau inbox report "<title>" --work
  <feature|fix|change|research|plan|answer> --tldr "<in short>" --summary "<markdown>"` (`--help` for the rest). It names your
  session (from VAULTITE_TERMINAL and CLAUDE_CODE_SESSION_ID) and ends with a reply box. Write it to stand alone: what
  was asked (link the note), what you did, where (files, repo, branch, commit), what's left; a new session may pick it
  up without your context. Report last: your terminal ends when that turn does. The user's reply is typed into your
  terminal if it still runs, else resumes your session while its prompt cache lasts, else starts a new one told to read
  the report; that session's next report goes on in the same file (one file per exchange).

**Events** ("Claude Code finished", "Codex is waiting for you") matter for minutes, so they're kept on the server's
machine for `keep_days`, not in the vault. An agent's turn ending is kept read, with no toast or push (the setting `turns`): its
report says when the work is done. With Machines every app shows every machine's (another's id ends in
`@<machine>`, and changing it is done there). They toast, count on the Inbox button and go to the phone and watch, with
Approve and Deny when an agent in an app terminal asks permission or an app on the public MCP asks to run code here.
- Coding agents in the app's terminals report by themselves. Agents started elsewhere post through a hook (`vau` is
  the app's `bin/vau`, full path where it isn't on PATH):
  - Claude Code, `~/.claude/settings.json`: `"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "vau inbox
    hook claude"}]}], "Notification": [{"matcher": "permission_prompt|elicitation_dialog", "hooks": [{"type": "command",
    "command": "vau inbox hook claude"}]}]}`
  - Codex, `~/.codex/config.toml`: `notify = ["vau", "inbox", "hook", "codex"]`
  - Anything else: `POST /api/inbox/events {"source", "kind": "done" | "waiting" | "error" | "info", "title", "body",
    "link", "key"}` (this machine's owner only; a `key` replaces its source's event with that key, so a daily one doesn't
    pile up).
- Push needs Apple's push key (a .p8) in data/ and `"inbox": {"apns": {"key_id", "team_id", "key": "<file in data/>"}}`
  in data/config.json on the server's machine; the setting `push` says which events go.
