## OpenCode
Read live from OpenCode's database on the machine the server runs on (`~/.local/share/opencode/opencode.db`); nothing is
written to the vault. Cost is what OpenCode recorded for each reply (0 for free models). The `opencode` block finds its
project by the folder name of the project's `path`, its repo or its name. Clicking a session goes to the app's terminal
it runs in, or opens its conversation in a tab (with "Resume in terminal"). A session's conversation, as JSON:
`GET /api/opencode/session/<session id>?limit=150&before=<n>`.
