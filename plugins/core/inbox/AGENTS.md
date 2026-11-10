## Inbox (`Inbox/<Title>.md`, and events)
The inbox is for decisions: what only the user can settle. Each question is its own item, with its options and the
default you take if they don't answer; never a question in prose (a "Your call" list in a report goes unanswered).
- A question: `vau inbox ask "<question>" --options "<a>: <what it causes>" "<b>: <what it causes>" --default "<a>"
  --why "<context>" [--blocking]`. The user reads it cold, days later: the question names its subject (the feature, the
  note, never "it" or "the first two steps"), each option's few words after its colon say what picking it does (shown
  under its button), and why (required) says in plain words what it's about and which agent or project asks.
  blocking: you're stopped on it (it comes first, toasts and pushes to the phone); else you went with the default already
  and it reads "Went with X; change it?", quietly. The same question open already (yours or another agent's) is that one.
- The end of a task: `vau inbox report` (below), its questions as `--decision`.
- Progress (a check-in, still working, a step done): `vau inbox progress "<line>"`, on your session's own row (the Agents
  panel), each line replacing the last. Never a report or a result.
- Something for the user to read later (research, a summary): `vau inbox add "<title>" --tldr "<in short>" --body
  "<markdown>"` (MCP's `inbox_add`). A long task finished: `vau notify "<text>"`.

**Decisions**: a file in `Inbox/` each (`type: inbox` with a `question`), drawn with its buttons (a `decisions` block):
````
---
type: inbox
status: new                 # new: open; done once answered or closed (archived into Inbox/.archive/)
from: Claude Code
created: '2026-10-01 18:00:00'
question: Ship the new sidebar to the phone too?
options: [Ship it, Not yet]
effects: [The phone gets it today, Desktop only for now]   # what each option causes, under its button
default: Not yet            # what its agent takes (or took) if the user doesn't answer
blocking: true              # its agent waits on it; absent: it went with the default already
report: '[[Fix done · Sidebar scrolls again]]'   # the report that asked it; also: other reports that asked it too
answer: Ship it             # set by vau inbox decide, with answered (when)
closed: The sidebar was replaced in 3f2a1c       # instead of an answer: why it no longer matters
agent: claude               # the session its answer goes to (session, terminal, machine)
---

```block-decisions
```

Its why: one or two plain sentences (what it's about, who asks).
````
- The user answers (`vau inbox decide <path> "<option>"`, `--default`, `--defaults` for Accept all defaults, `--moot
  "<why>"`, `--undo`): only with their own answer, never for them. Its agent is told (one reply per session, into its
  report) when it waits on it or the user changed the default it took; a default kept goes nowhere.
- Later work settles a question: name it in your report (`--settles <path>`), and it closes saying so; a small model also
  reads each new report and answer against what's open and closes what they clearly settle, and merges a question asked
  again in other words. `vau inbox decisions` lists what's open.

**Results**: a file in `Inbox/` for the user to review, then settle (archive) or file into a folder:
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
- Settle it with `vau inbox settle <path>` (`done`: its old name), not by editing `status` (that leaves the file in
  place): settled is archived, into `Inbox/.archive/`. A clip lands here with `inbox: true`.
- Snooze (`vau inbox snooze <path|event id> --until tomorrow`, or 3h, weekend...): out of the way until then, then back
  on top, unread, and told again (toast, phone). A snoozed thread stays open meanwhile; news from its session wakes it.
  Wake (`vau inbox wake <path|event id>`) brings it back now.
- Pin (`vau inbox pin <path|event id>`, `--off` unpins): kept on top under Pinned whatever it waits on, until it's settled.
- Hold (`vau inbox hold 30m --label "Practice guitar"`, or 07:30, off): nothing is told (toasts, the Mac's and the phone's
  notifications) until then, on every machine; what came is unread, summed up in one line when it ends.
- **A TL;DR on top** of every result you write (`--tldr`): what it says, in a line or two of plain words.
- **A report** ends a task you were handed to do alone (a voice note, a note handed to you: Dispatch, a schedule):
  `vau inbox report "<title>" --work <feature|fix|change|research|plan|answer> --tldr "<one line>" --summary
  "<markdown>" --decision "<question>? | <option>: <what it causes>* | <option>: <what it causes> | why: <context>"` (`*`
  the default; `--help` for the rest). It's a record,
  not an inbox item: archived as it comes (`work:` says what kind), listed in one line in the morning brief (`vau inbox
  reports`) and under Reports today. Only a failure (`--state stuck`), something that went out publicly (`--public`) or
  the daily digest itself (`--digest`) stays in the inbox, told. Its shape: a one-line TL;DR, its decisions (drawn with
  their buttons), screenshots, then the details folded (at most about 1,500 words): what was asked (link the note), what
  you did, where (files, repo, branch, commit), what's left; a new session may pick it up without your context. It names
  your session (from VAULTITE_TERMINAL and CLAUDE_CODE_SESSION_ID) and ends with a reply box. Report last: your terminal
  ends when that turn does. The user's answers and replies are typed into your terminal if it still runs, else resume your
  session while its prompt cache lasts, else start a new one told to read the report; that session's next report goes
  on in the same file (one file per exchange).

**Threads**: each coding agent's session is one thread, its event (kept on the machine it runs on, not in the vault),
with a `state`:
- `open`, it needs the user: it asks (a permission, a question, any dialog it shows, to sign in, a plan to approve), its
  turn ended with something for them (a question or a failure: `reply`; judged from its last message, by a small model
  when its words don't settle it), or its report is one the inbox keeps (a failure, public, the digest). It's told then
  (toast, the phone and watch). A report that isn't leaves its thread done, quietly. A turn that only tells them
  something (`answer`: what they asked to know, a status) is done quietly, unread on its row, never told; the setting
  `answers: inbox` keeps it open and told instead.
- `working`: the user answered (a reply, Approve, a pick, a prompt in its terminal) and its agent is on it. Its next turn
  ends open again when it has something for them, else done.
- `done`: the user settled it (`vau inbox settle <id>`, which archives its report too), or a turn after their answer
  ended with nothing for them, or they ended its terminal. Kept `keep_days` under Settled (`vau inbox --done`).
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
  "approve" | "deny"} | {picks: Choice[]} | {chat: true}) => Promise<boolean>` Approve, Deny, picks and Chat about this (true: it took it), and
  `agent-chat-new:<agent>` `({prompt, account?, by?}) => Promise<{id} | null>` starting a new session where a reply
  would start a terminal (its cache gone) or a voice note is dispatched. A permission it asks can't be snoozed.
- Push needs Apple's push key (a .p8) in data/ and `"inbox": {"apns": {"key_id", "team_id", "key": "<file in data/>"}}`
  in data/config.json on the server's machine; the setting `push` says which events go.
