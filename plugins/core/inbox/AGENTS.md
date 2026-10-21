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
created: '2026-10-01 18:00:00'      # local time, set by the app
updated: '2026-10-01 19:30:00'      # local time, set by the app: its thread's latest report (an agent's, after a reply)
---

What it says, as Markdown.
````
- Mark it done with `vau inbox done <path>`, not by editing `status` (that leaves the file in place): done is archived,
  into `Inbox/.archive/`, and its events are read and link it there. A clip lands here with `inbox: true`.
- **A TL;DR on top** of every result you write (`--tldr`): what it says and what you need from the user, in two or
  three plain sentences.
- **A report** ends a task you were handed to do alone (a voice note, a note handed to you: Dispatch, a schedule):
  `vau inbox report "<title>" --work <feature|fix|change|research|plan|answer> --tldr "<in short>" --summary "<markdown>"`
  (`--help` for the rest). It names your session (from VAULTITE_TERMINAL and CLAUDE_CODE_SESSION_ID) and ends with a
  reply box. Write it to stand alone: what was asked (link the note), what you did, where (files, repo, branch, commit),
  what's left; a new session may pick it up without your context. Report last: your terminal ends when that turn does.
  The user's reply is typed into your terminal if it still runs, else resumes your session while its prompt cache lasts,
  else starts a new one told to read the report; that session's next report goes on in the same file (one file per
  exchange).

**Sessions**: each coding agent's session is one event, its row, kept on the machine it runs on (not in the vault).
It's in the inbox only while it needs the user: it asks (a permission, a question, to sign in, a plan to approve), or
its turn ended with something for them (a question, an answer to read, a failure: judged from its last message, by a
small model when its words don't settle it), or its report (`vau inbox report`). Then it's unread (bold), with its last
answer as Markdown, it toasts and goes to the phone and watch, and it's read once opened or replied to (`vau inbox
reply <id> "<text>"`: typed into its session, resumed if it ended). A turn done with nothing for the user goes in
quietly: the row keeps its last answer, read. Don't write "nothing needed from you" rules into prompts for this.
**Events** (`vau notify`, a paused plugin, a server's question) matter for minutes, kept the same way: an unread one
until it's read or dismissed, a read one for `keep_days` (the last 200). With Machines every app shows every machine's
(another's id ends in `@<machine>`, and reading, answering or replying to it is done there; the machine whose session it
is sends the push). Approve and Deny answer a permission an agent asks in an app terminal, or an app on the public MCP
asking to run code here.
- Coding agents in the app's terminals report by themselves. Agents started elsewhere post through a hook (`vau` is
  the app's `bin/vau`, full path where it isn't on PATH):
  - Claude Code, `~/.claude/settings.json`: `"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "vau inbox
    hook claude"}]}], "Notification": [{"matcher": "permission_prompt|elicitation_dialog", "hooks": [{"type": "command",
    "command": "vau inbox hook claude"}]}]}`
  - Codex, `~/.codex/config.toml`: `notify = ["vau", "inbox", "hook", "codex"]`
  - Anything else: `POST /api/inbox/events {"source", "kind": "waiting" | "done" | "error" | "info", "title", "body",
    "link", "key"}` (this machine's owner only; a `key` replaces its source's event with that key, so a daily one doesn't
    pile up).
- Push needs Apple's push key (a .p8) in data/ and `"inbox": {"apns": {"key_id", "team_id", "key": "<file in data/>"}}`
  in data/config.json on the server's machine; the setting `push` says which events go.
