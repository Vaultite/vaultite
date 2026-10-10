<h1 align="center">
  <img src="web/public/icon-512.png" width="128" alt="Vaultite icon"><br>
  <p>Vaultite</p>
</h1>

<p align="center">
  <b>Own your memories.</b> A local knowledge base you and your AI write together, in plain Markdown files.
  <br>
  <a href="https://github.com/Vaultite/vaultite/releases/latest/download/Vaultite-arm64.dmg">Download</a>
  (<a href="https://github.com/Vaultite/vaultite/releases/latest/download/Vaultite-x64.dmg">Intel</a>)
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue" alt="Platform: macOS and Linux">
  <img src="https://img.shields.io/github/v/release/Vaultite/vaultite?label=version" alt="Latest version">
  <img src="https://img.shields.io/badge/license-Apache%202.0-lightgrey" alt="License: Apache 2.0">
</p>

<p align="center">
  <img src="screenshots/today.webp" width="32%" alt="Today: routines ticked this week, tomorrow, the week's training, sleep and nutrition">
  <img src="screenshots/person.webp" width="32%" alt="A person: where they live, when you last talked, how often to keep in touch">
  <img src="screenshots/health.webp" width="32%" alt="Health: workouts by week, lifts, sleep and meals">
</p>

## What it is

A folder of Markdown files (your vault) that you or your AI (Claude, ChatGPT, OpenClaw, Hermes) writes in and Vaultite
draws as pages.

- **Plain files, no database.** Open the same vault in another Markdown app, grep it, sync it with iCloud or keep it in git.
- **Made for agents.** Claude Code, Codex and any MCP client use one set of operations (the `vau` CLI, MCP, HTTP).
- **Everything is a plugin.** Modular and hot-reloadable. Even the file tree is one; Vaultite's own (People, logs, notes)
  come with it, off until a bundle or you turn them on; write your own in the vault.
- **Also a full editor and workspace**: live preview, tabs and splits, backlinks, graph, terminals for your agents, on
  the Mac, Linux and the web. iPhone coming soon.

## Get started

1. **Download** [Vaultite for Mac](https://github.com/Vaultite/vaultite/releases/latest/download/Vaultite-arm64.dmg)
   ([Intel](https://github.com/Vaultite/vaultite/releases/latest/download/Vaultite-x64.dmg); macOS 13 or later) and drag
   it to Applications. On Linux, the [AppImage or the .deb](https://github.com/Vaultite/vaultite/releases/latest)
   (`sudo apt install ./vaultite_*.deb` also sets up Chromium's sandbox on Ubuntu 24.04+).
2. **Make a vault**, or open a folder of Markdown you already have: Vaultite changes none of it. Or try the playground,
   a made-up vault, first.
3. **Connect your AI** in Settings, Connections: Claude, ChatGPT, Muse or Grok Bot, on the web and your phone. Claude
   Code and Codex in Vaultite's terminals already know the vault.

Then try "log a 30 minute run this morning" or "what did I tell you about Alice?". More is a bundle away: Life OS for
your days, people and health.

Agents outside Vaultite:

```sh
claude mcp add vaultite -- vau mcp
```

Skills that teach any agent the vault's rules and how to write a plugin: `npx skills add Vaultite/vaultite`, or in
Claude Code `/plugin marketplace add Vaultite/vaultite` and `/plugin install vaultite@vaultite`.

## Run from source

```sh
npm ci && npm run build                              # Node.js 23.6 or later
node bin/vau sandbox /tmp/vaultite-sandbox           # a made-up vault, dated as of today
VAULTITE_VAULT=/tmp/vaultite-sandbox npm start       # http://127.0.0.1:8793
```

No accounts: keep it on `127.0.0.1` or a private network like Tailscale ([SECURITY.md](SECURITY.md)). The desktop and
iPhone apps, tests and how to send a change: [CONTRIBUTING.md](CONTRIBUTING.md). Your own plugin: `vau plugin new <id>`
([vault plugins](core/docs/vault-plugins.md)).

## Run it on a server

The server runs on Linux too, on a box at home or a VPS, next to agents like Claude Code, OpenClaw or Hermes. Open it
from the desktop app (Connect to a server), the iPhone app or a browser on your tailnet.

```sh
git clone https://github.com/Vaultite/vaultite && cd vaultite
npm ci && npm run build                          # on Linux, node-pty builds with build-essential and python3
node bin/vau service install --vault ~/Vault     # a systemd user unit (launchd on a Mac), running now and at boot
tailscale serve --bg --https=8447 http://127.0.0.1:8793
```

Then add `https://<machine>.<tailnet>.ts.net:8447` in the app, and apply the Self-hosted bundle.

## License

[Apache 2.0](LICENSE).

Obsidian is a trademark of Dynalist Inc. Vaultite is not affiliated with or endorsed by it; the name is used only to
say what Vaultite is compatible with.
