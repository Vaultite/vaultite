# Notes for `plugins/core/claude-code/`

- Chat sessions run in the chat keeper (`chatd.ts`, a detached process like the terminal keeper, named by the port), so
  a turn survives a restart or deploy; the server follows it (`chat.ts`) and tells the inbox only the news it hasn't
  (the keeper's `seq`/`told`). A server serving no port (a test's) never starts one: tests run `chathost.ts` in-process
  with a stand-in SDK (`tools/test/vault/claude-chat.ts`), or a real keeper process whose SDK is one
  (`companion-chat.ts`, `chatd/hooks.ts`), so no test spends a real session.
- A plugin's session (`exports.chat`, the companion's) has tools that run on the server: the keeper serves them as an
  in-process MCP server and relays each call, holding it until a server answers (one that restarts is told it again
  when it follows). The plugin serves them again as it loads (`serve`); a call waits a moment for that. Its start
  options are kept, so a resume (its next message, a keeper gone mid-turn) runs it with them again.
- Such a tool may `stream` (its input told as the model writes it, matched to its call by the tool_use id Claude Code
  puts in the call's `_meta`) and end the turn: `endsTurn` in its result (a PostToolUse hook's `continue: false`), and
  `ends` names it in CLAUDE_CODE_TERMINAL_MCP_TOOLS, else a turn ending on it with no words is nudged for some.
- A plugin's session may be lean (`system`: its whole system prompt; `builtins`: the few Claude Code tools it has): it
  loads none of the user's settings, CLAUDE.md, MCP servers or skills, so it starts small and answers fast (the
  summoned companion's). `onText` hears its words as they're written. Thinking can't be turned off on Claude 5 models
  (`quick` asks, they think anyway): a low `effort` is what keeps it short.
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
- The keeper's code is what it started with (its `hello` says which: `codeOf`). A server that finds one running other
  code (an update in place) ends it once no session has run, started or been about to (`touch`: a Talk key pressed) for
  two minutes, and starts another; each session resumes on its next message (one that never had a turn can't: it starts
  anew). (The companion's sessions never leave it empty: without this it ran its first code for days.)
