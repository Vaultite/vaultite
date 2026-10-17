## MCP Apps
AI apps that draw MCP Apps (claude.ai, ChatGPT) show cards for these tools: `read` of a note (drawn, Open in Vaultite),
`tasks_list` (ticks with `tasks_complete`), `kanban_read` (moves with `kanban_move`, ticks with `kanban_done`).
The same card in a note: a block naming a tool that reads, and its arguments:

```block-mcp-app
tool: tasks_list
arguments:
  query: not done
```
