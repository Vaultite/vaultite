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
snoozed: '2026-10-02 08:00:00'      # optional, set by Snooze: out of what's to review until then, then back on top
---

What it says, as Markdown.
````
- Mark it done with `vau inbox done <path>`, not by editing `status` (that leaves the file in place): done is archived,
  into `Inbox/.archive/`. A clip lands here with `inbox: true`.
- Snooze (`vau inbox snooze <path|event id> --until tomorrow`, or 3h, weekend, now...): out of the way until then, then
  back on top, unread, and told again (toast, phone). A snoozed thread stays open meanwhile; news from its session wakes it.
- Hold (`vau inbox hold 30m --label "Practice guitar"`, or 07:30, off): nothing is told (toasts, the Mac's and the phone's
  notifications) until then, on every machine; what came is unread, summed up in one line when it ends.
- **A TL;DR on top** of every result you write (`--tldr`): what it says and what you need from the user, in two or
  three plain sentences.
- **A report** ends a task you were handed to do alone (a voice note, a note handed to you: Dispatch, a schedule):
  `vau inbox report "<title>" --work <feature|fix|change|research|plan|answer> --tldr "<in short>" --summary "<markdown>"`
  (`--help` for the rest). It names your session (from VAULTITE_TERMINAL and CLAUDE_CODE_SESSION_ID) and ends with a
  reply box. Write it to stand alone: what was asked (link the note), what you did, where (files, repo, branch, commit),
  what's left; a new session may pick it up without your context. Report last: your terminal ends when that turn does.
  The user's reply is typed into your terminal if it still runs, else resumes your session while its prompt cache lasts,
  else starts a new one told to read the report; that session's next report goes on in the same file (one file per
  exchange). The report is your session's thread in the inbox (one row: the file is its record, not a second item).

**Threads**: each coding agent's session is one thread, its event (kept on the machine it runs on, not in the vault),
with a `state`:
- `open`, it needs the user: it asks (a permission, a question, any dialog it shows, to sign in, a plan to approve), its
  turn ended with something for them (a question, an answer to read, a failure: judged from its last message, by a small
  model when its words don't settle it), or it reported (`vau inbox report`). It's told then (toast, the phone and watch).
- `working`: the user answered (a reply, Approve, a pick, a prompt in its terminal) and its agent is on it. Its next turn
  ends open again when it has something for them, else done.
- `done`: the user marked it done (`vau inbox done <id>`, which archives its report too), or a turn after their answer
  ended with nothing for them, or they ended its terminal. Kept `keep_days` under Done (`vau inbox --done`).
Read (bold or not) is only whether they've seen it: opening or reading a thread never settles it. A turn done with
nothing for the user goes in quietly, done. Reply with `vau inbox reply <id> "<text>"` (typed into its session, resumed
if it ended). Don't write "nothing needed from you" rules into prompts for this.
**Events** are the rest, in the same list: `waiting` (something asks the user: a server's question, a browser's ask, a
paused plugin) is open until done or answered; a message (`vau notify`: info, error) is done once read. With Machines
every app shows every machine's (another's id ends in `@<machine>`, and reading, answering or replying to it is done
there; the machine whose session it is sends the push). Approve and Deny answer a permission an agent asks in an app
terminal, or an app on the public MCP asking to run code here.
- Coding agents in the app's terminals report by themselves. Agents started elsewhere post through a hook (`vau` is
  the app's `bin/vau`, full path where it isn't on PATH):
  - Claude Code, `~/.claude/settings.json`: `"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "vau inbox
    hook claude"}]}], "Notification": [{"matcher": "permission_prompt|elicitation_dialog", "hooks": [{"type": "command",
    "command": "vau inbox hook claude"}]}]}`
  - Codex, `~/.codex/config.toml`: `notify = ["vau", "inbox", "hook", "codex"]`
  - A message or an ask from anything else: `POST /api/inbox/events {"source", "kind": "waiting" | "error" | "info",
    "title", "body", "link", "key"}` (this machine's owner only; a `key` replaces its source's event with that key, so a
    daily one doesn't pile up).
- **A session's state** from its host (an agent run outside a terminal, as the Agent SDK runs one): `POST
  /api/inbox/sessions` (owner only; 202, worked out after), or in a plugin `plugin.ask("inbox:session", null, state)`
  (resolves to its thread), with `{"agent", "session", "terminal"?, "thread"?, "state": "waiting" | "working" | "done" | "error",
  "ask"?: "permission" | "question" | "auth" | "plan", "text"?, "prompt"?, "title"?, "questions"?, "cwd"?}`. waiting
  is blocked on the user (`ask` why; `questions` as core/agents.ts' Question, else `text` says it); working, a turn
  started; done or error, a turn ended (`text` its final message, `prompt` the user's last): judged as a hook's. A
  thread's id is its own: `thread` (its event id) names it when the session's id changed (a fork, a resume), and the
  thread follows the new one. Without a terminal its thread is `host: true`: its host answers it, a service
  `agent-reply:<agent>` `(session, text) => Promise<boolean>` taking replies, `agent-answer:<agent>` `(session, {answer:
  "approve" | "deny"} | {picks: Choice[]}) => Promise<boolean>` Approve, Deny and picks (true: it took it), and
  `agent-chat-new:<agent>` `({prompt, account?, by?}) => Promise<{id} | null>` starting a new session where a reply
  would start a terminal (its cache gone) or a voice note is dispatched. A permission it asks can't be snoozed.
- Push needs Apple's push key (a .p8) in data/ and `"inbox": {"apns": {"key_id", "team_id", "key": "<file in data/>"}}`
  in data/config.json on the server's machine; the setting `push` says which events go.
