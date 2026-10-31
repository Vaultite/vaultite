# Notes for `plugins/core/claude-code/`

- Chat sessions run in the chat keeper (`chatd.ts`, a detached process like the terminal keeper, named by the port), so
  a turn survives a restart or deploy; the server follows it (`chat.ts`) and tells the inbox only the news it hasn't
  (the keeper's `seq`/`told`). A server serving no port (a test's) never starts one: tests run `chathost.ts` in-process
  with a stand-in SDK (`tools/test/vault/claude-chat.ts`), so no test spends a real session.
- It runs the user's own `claude` (`pathToClaudeCodeExecutable`): the version their terminals run, its login and
  updates, and no 300 MB bundled binary in the packaged app (package.json leaves the SDK's platform packages out).
- Entries (`chatlog.ts`) are keyed by the ids SDK messages and transcript lines share (a user message's uuid,
  `<message id>:<block>`, a tool_use id): the chat tab merges a session's transcript and its live turn by id.
- What outlives the keeper is the server's `chats.json` (its local dir): a keeper gone mid-turn (a reboot, a crash) has
  those turns resumed with "Continue where you left off." (3 in 5 minutes at most); an ask then comes again.
- One writer per session: a terminal resuming a session the chat runs takes it over (the chat stops it, mid-turn
  too): the app's terminals before they start it, Claude Code run elsewhere within seconds of starting.
- The inbox hears sessions through `inbox:session` and answers through `agent-reply:claude` / `agent-answer:claude`; a
  session ended takes replies here only if the chat ran it (`chats.json`), else the inbox resumes it as a terminal's.
- The keeper's code is what it started with: a change to `chathost.ts`/`chatd.ts` reaches it once it has no session
  and exits (or SIGTERM its pid, `vaultite-chatd1-<name>.sock.pid` in the runtime dir; sessions resume on their next message).
