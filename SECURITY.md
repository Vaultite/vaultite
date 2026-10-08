# Security

Vaultite has **no accounts and no login**: whoever can reach the server can read and write the vault.

- It listens on `127.0.0.1` by default. To use it from your phone, put it on a private network you control, such as a
  Tailscale tailnet with `tailscale serve`. Don't expose it to the internet.
- Terminal tabs run a real shell on the server's machine. The terminal socket only accepts this machine (loopback, no
  proxy headers) or, through Tailscale Serve, the machine owner's Tailscale login and logins listed in
  `.vaultite/plugins/terminal/data.json` (`allowUsers`). Other origins are always refused. Another machine's shell
  (Machines) is checked on the machine you asked, then again on the one that runs it. The Screen sharing plugin's socket
  (Vaultite/plugins: another computer's screen, relayed to its VNC port) answers the same way.
- The MCP server (`POST /api/mcp`) reads and writes the whole vault, so it answers like the terminal: this machine,
  or the owner's tailnet login through Tailscale Serve (`allowUsers` in `.vaultite/plugins/mcp/data.json`), never
  another site's page. `vau mcp` reaches the server like any `vau` command. The Inbox's events (which become toasts
  and notifications) are posted the same way: this machine or its owner only. The Web clipper fetches only public
  addresses (never this machine, the local network or the tailnet), checked again on every redirect and DNS answer;
  so do Canvas's link previews.
- The desktop app's Web viewer shows pages in a session of their own (their logins kept apart from the app's, and by
  default each workspace's apart from the others'), with no
  preload, no Node and context isolation: a page can't reach the app, its bridge or the machine. Pages go only to http and
  https addresses (mailto: opens the mail app, any other scheme is refused), their permission requests are refused
  (but writing the clipboard and notifications, which come to the app's Inbox),
  and downloads go to the Downloads folder.
- HTML artifacts (the core plugin HTML pages) run in a sandboxed frame (opaque origin, no network, no access to the
  API) and read the vault only through a small bridge. With the plugin off, an .html file is only its text: it's never
  served to run.
- Vault plugins run code on the server with the app's access. They're off until you turn them on in the Plugins
  page; anyone who can write your vault's hidden files could add one, so treat write access to the vault as access to
  the machine.

## Reporting a problem

Open a private security advisory on GitHub (Security > Report a vulnerability) rather than an issue.
