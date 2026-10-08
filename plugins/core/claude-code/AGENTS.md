## Claude Code
Read live from Claude Code's files on the machine the server runs on (`~/.claude`); nothing is written to the vault. The
`claude` block finds its project by the folder name of the project's `path`, its repo or its name; `machine:` needs the
Machines plugin on. Clicking a session goes to the app's terminal it runs in, or opens its conversation in a tab (with
"Resume in terminal"). A session's conversation, as JSON: `GET /api/claude-code/session/<session id>?limit=150&before=<n>`.
Accounts: every Claude Code config folder is one: `~/.claude` (`default`) and `~/.claude-<name>` (`<name>`, when it
has sessions). Name them, keep one private (its usage counts; no titles, folders or conversations) or leave one out in
`.vaultite/plugins/claude-code/data.json`: `{"accounts": {"default": {"label": "Work", "private": true}, "personal":
{"label": "Personal"}, "old": {"hidden": true}, "lab": {"dir": "~/code/claude-lab"}}}`. `GET /api/claude-code/accounts`
lists them; "Open Claude Code in an account or on a machine…" starts one there.
