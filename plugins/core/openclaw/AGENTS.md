## OpenClaw
Read live from OpenClaw's databases on the machine the server runs on (`~/.openclaw`: `agents/<agent>/agent/openclaw-agent.sqlite`,
`state/openclaw.sqlite` for scheduled jobs) and its agents' workspaces (memory: `IDENTITY.md`, `SOUL.md`, `USER.md`,
`MEMORY.md`, `memory/<date>.md`); nothing is written to the vault. Cost is what OpenClaw recorded for each reply. Its
agents (main...) are the blocks' `account`. A session's conversation, as JSON: `GET /api/openclaw/session/<session
id>?limit=150&before=<n>`. `vau openclaw connect` (the owner's) saves the vault's MCP server (`vau mcp`) in OpenClaw's
config with `openclaw mcp set`, so its agents get the vault's tools.
