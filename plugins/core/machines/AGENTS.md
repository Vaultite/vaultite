## Machines
Your other computers running Vaultite (one vault, many machines: the vault is the data, a machine is where things
run). The list is `.vaultite/plugins/machines/data.json`: `{"machines": [{"id": "studio", "label": "Studio", "url":
"https://studio.example.ts.net:8447"}]}` (`id`: lowercase letters, digits and -; `url`: where its app answers). A server
served through Tailscale Serve adds itself once (with the Tailscale plugin on; `added` remembers it, so one you remove stays removed); edit the labels
freely. `GET
/api/machines` says which answer and what each runs (`self`: this one); `GET /api/machines/<id>/<path>` is `GET
/api/<path>` on that machine (read-only). In the `machines` block and the sidebar panel, a click (or a right-click, with the panel's own menu after it) opens a terminal or an agent there. Other
plugins take `machine: <id>` in their blocks (Claude Code's, `tailscale`; in /api/render any block with it is drawn by
that machine), and a terminal id ending in `@<id>` is a shell on that machine (workspaces save terminal tabs that way,
so each machine's app opens the right shell). A server knows which entry is itself by its address (a loopback address on
its port, or its Tailscale Serve address), else by asking each one. Each says its vault's id (`vault`, from
`vault.json`, made once): machines with the same one share the vault, the others have vaults of their own.
