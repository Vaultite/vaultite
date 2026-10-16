## Coding agents
Every coding agent's usage is the same blocks, `agent:` naming whose (its plugin's id): `agent-limits` (only agents
with a plan: claude-code, codex, cursor, grok-bot), `agent-sessions`, `agent-usage`, `agent-projects`, `agent-models`,
and `agent-project` in a project file (it finds the project by the file's name, its `path`'s folder or its repo; not
grok-bot, which runs in the cloud). An agent whose plugin is off draws nothing; how each one reads its data:
`vau docs <its plugin>`.
````
```block-agent-usage
agent: codex
days: 7
```
````
