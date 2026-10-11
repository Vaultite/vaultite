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


Agent VMs behind a firewall can dial a server's public MCP listener with the read-only Python file agent at
`<public-address>/machines/agent.py`. In the VM, download it to `~/.vaultite-dial/agent.py` and run
`python3 ~/.vaultite-dial/agent.py enroll <public-address> <id> "Label"`. It generates a key locally and shows an
eight-digit code (ten minutes); approve it in the Machines tab, selecting the relay server. No key needs to be copied.
The machine's entry is `{ "id": "sandbox", "label": "Sandbox", "via": "studio" }`; `via` names a normal Vaultite
server in the same list. Only that server keeps its key hash, in its private config. List and read through
`GET /api/machines/<id>/fs/list?path=~` and `…/fs/read?path=<absolute-path>` (owner only). These machines advertise
no terminal or coding-agent capability. Read results are text or base64, with size and truncation; only regular files
are readable, text previews default to 1 MB, and listings stop at 5,000 entries. Nothing runs or writes on the VM
except the file agent's own setup files. Contents are live, never stored in the vault; offline machines stay listed.
Use the machine menu to revoke access. Start/stop/status use the same script; a reboot or provider reset requires
starting it again (Muse's persistent files must be under its home directory).
