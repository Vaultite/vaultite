## Codex
Read live from OpenAI Codex's files on the machine the server runs on (`~/.codex`: its sessions, and the plan's limits as
ChatGPT reports them through the `codex` CLI); nothing is written to the vault. Clicking a session goes to the app's
terminal it runs in, or opens its conversation in a tab (with "Resume in terminal"). A session's conversation, as JSON:
`GET /api/codex/session/<session id>?limit=150&before=<n>`.
