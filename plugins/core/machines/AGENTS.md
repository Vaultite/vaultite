## Machines
Your other computers running Vaultite (one vault, many machines: the vault is the data, a machine is where things
run). The list is `.vaultite/plugins/machines/data.json`: `{"machines": [{"id": "studio", "label": "Studio", "url":
"https://studio.example.ts.net:8447"}]}` (`id`: lowercase letters, digits and -; `url`: where its app answers). A server
served through Tailscale Serve adds itself once (with the Tailscale plugin on; `added` remembers it, so one you remove
stays removed); edit the labels freely.
- `GET /api/machines` says which answer and what each runs (`self`: this one); `GET /api/machines/<id>/<path>` is
  `GET /api/<path>` on that machine (read-only).
- In the `machines` block and the sidebar panel, a click (or a right-click, with the panel's own menu after it) opens a
  terminal or an agent there. Other plugins take `machine: <id>` in their blocks (Claude Code's, `tailscale`; in
  /api/render any block with it is drawn by that machine), and a terminal id ending in `@<id>` is a shell on that
  machine (workspaces save terminal tabs that way, so each machine's app opens the right shell).
- A server knows which entry is itself by its address (a loopback address on its port, or its Tailscale Serve
  address), else by asking each one. Each says its vault's id (`vault`, from `vault.json`, made once): machines with
  the same one share the vault, the others have vaults of their own.

### Read-only file agents
A VM behind a firewall can dial a server's public MCP listener with the Python file agent at
`<public-address>/machines/agent.py`: download it to `~/.vaultite-dial/agent.py` and run
`python3 ~/.vaultite-dial/agent.py enroll <public-address> <id> "Label"`. It makes its key locally and shows an
eight-digit code for ten minutes; approve it in the Machines tab, picking the relay server. No key is copied. Its entry
is `{"id": "sandbox", "label": "Sandbox", "via": "studio"}`: `via` names a normal Vaultite server in the list, the only
one that keeps its key hash (in its private config).
- Read it with `GET /api/machines/<id>/fs/list?path=~`, `…/fs/read?path=<absolute path>` and `…/fs/recent?path=~` (its
  files changed last, hidden folders left out; an agent from before it says no), owner only; the server's own code uses
  the service `machines:fs`. A read asked while the connection dropped waits for it to come back (a few seconds), once.
- Reads are text or base64, with size and truncation: regular files only, text previews up to 1 MB, listings stop at
  5,000 entries. No terminals or coding agents; nothing runs or writes on the VM but the agent's own setup files, and
  nothing is stored in the vault. Offline machines stay listed.
- `agent.py start`, `stop` and `status`; a reboot or provider reset needs `start` again (on Muse, keep it under the home
  folder: only that persists). To update, download agent.py over the old one, then `stop` and `start`. Revoke access
  from the machine menu.
