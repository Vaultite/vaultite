## MCP
The vault's operations for AIs outside the app, as an MCP server (modelcontextprotocol.io): every operation marked for
MCP is a tool, named in its docs (`vau docs api`), plus `ops` (list the operations, or explain one) and `call` (run any
by its id). Plugins that are on add theirs. Each runs as the client, so what it writes follows the formats in these
docs, and Activity names the client that did it. Its instructions (initialize's, `mcp.instructions`) are a short intro,
the `forAgents` line of each plugin that's on, and how to use the tools.
- Over stdio: `vau mcp` (Claude Code: `claude mcp add vaultite -- vau mcp`). Over HTTP: `POST /api/mcp` on the
  server (Streamable HTTP, a JSON answer per message), for this machine and its owner through Tailscale Serve only, like
  Terminal: `.vaultite/plugins/mcp/data.json` takes `{"allowUsers": ["someone@example.com"]}` and
  `{"allowRemote": true}` (off by default).
- On the internet, for apps that connect from their own servers (claude.ai and the Claude apps, ChatGPT): `<url>/mcp` on a
  listener of its own that a tunnel makes public, set in this machine's `data/config.json` (`mcp.public`: `url`, `port`).
  Sign-in has no accounts: the app's sign-in page shows a code, typed in view:connections, where connections are also
  ended. The same tools, `ops` and `call` too, without what only this machine's owner may run (terminals, the screen).
  What can run code on this machine or change what does (turning a plugin on, writing under `.vaultite/`, bundles,
  settings, palette commands, clipping a local address) waits for the owner's yes: Approve and Deny in the Inbox and on
  the phone. Waiting past ~45 seconds, the tool says so: call it again with the same arguments once approved.
- **Vaultite Cloud** gives that listener an address without a tunnel of one's own: `https://<handle>.vaultite.app/mcp`.
  Signing in: the user gets a one-time code at https://cloud.vaultite.com/connect and types it in Connections or `vau cloud
  sign-in <code>` (ops `mcp.cloud-sign-in`, `mcp.cloud-status`, `mcp.cloud-sign-out`); never use a code from someone else.
  The machine then keeps a tunnel to the relay, which reaches only the public listener.
- Nothing is stored in the vault: sessions are in memory, and the vault is changed only by the operations the tools run.
