# Contributing

Thanks for helping. Vaultite is small on purpose: a core that indexes files and loads plugins, and everything else as
plugins. Read [CLAUDE.md](CLAUDE.md) before a change: it explains how the app is built and the rules that keep it simple
(it's written for AI agents, and works for people too).

## Setup

```sh
npm ci
npm run build
node bin/vau sandbox /tmp/vaultite-dev    # the sample vault, dated as of today (examples/vault + core/sandbox.ts)
VAULTITE_VAULT=/tmp/vaultite-dev VAULTITE_LOCAL=/tmp/vaultite-local PORT=8799 npm start
```

Always run against a copy of a vault: the server writes into the vault it serves. Needs Node.js 23.6 or later (the
server runs TypeScript directly) and, for the QA scripts, Playwright's Chromium
(`npx playwright-core install chromium`; Google Chrome if it's missing).

- Desktop app: `npm run app` (`npm run app -- --vault <path>` opens one), `npm run release` for signed and
  notarized dmgs and zips, Apple silicon and Intel, and latest-mac.yml in `dist-app/` (the update feed's files: both
  zips), or `npm run app:build` for an unsigned app for this Mac (`dist-app/mac-arm64/Vaultite.app`; Intel: `mac/`).
- Desktop app on Linux: `npm run release:linux` for the AppImage, .deb and latest-linux.yml (built on Linux, for its
  architecture: node-pty is compiled there), or `npm run app:install` to install this checkout for your user, updating
  itself from main. On Ubuntu 24.04+, `npm run app` needs an AppArmor profile for `node_modules/electron/dist/electron`
  allowing `userns` (Chromium's sandbox); `app:install` prints the one for its own copy.
- iPhone app: `npm run ios` (needs Xcode); put your team in `ios/App/Local.xcconfig` (`DEVELOPMENT_TEAM = <team id>`).
  On the phone, add the address your Mac serves Vaultite at on the tailnet (`tailscale serve --https=8447 <port>`).
- `vau service install --vault <folder>` keeps the server running (launchd on macOS, systemd on Linux).

| Variable | Default | What it is |
| --- | --- | --- |
| `VAULTITE_VAULT` | `data/vault` | The vault folder served |
| `PORT` / `HOST` | `8793` / `127.0.0.1` | Where the server listens |
| `VAULTITE_LOCAL` | `data/` | This machine's own files, never in the vault: secrets (`config.json`), caches, file history |
| `VAULTITE_URL` | `http://127.0.0.1:8793` | Where `vau` finds the server |
| `VAULTITE_CLOUD` | `https://cloud.vaultite.com` | Vaultite Cloud's relay (a test one: `web/qa/mcpcloud.mjs`) |

## Before you send a change

All four must pass:

```sh
npm run build       # types (tsc -b, backend and frontend) and the web app
npm run check       # plugin rules (imports, settings; every block declared, with a text side, in core/pages/Design.md;
                    # no plugin API used while a plugin's module loads; skills/ short and naming real vau commands)
npm test            # browser-free web modules, then the backend on a throwaway vault
npm run smoke       # the build starts: Chrome, desktop and phone, no page error, and opening a vault of your own
                    # changes none of its files (web/qa/boot.mjs, its own servers)
```

The web demo (the app and its server in the browser, on the sample vault: `web/demo/CLAUDE.md`): `npm run build:demo`
builds it into `web/dist-demo/`, static files for any host and path; `node web/qa/demo.mjs` checks it.

`npm run qa` runs every UI script in `web/qa/` (each on a fresh sandbox and server of its own; `--repeat 3` finds
flaky ones, `npm run qa -- sheets links` runs some).

UI changes: the scripts in `web/qa/` drive the app in Chrome (playwright-core, on Playwright's own Chromium, not
the installed Google Chrome) at
desktop and phone sizes, e.g. `node web/qa/layout.mjs http://127.0.0.1:8799`. Many of them write to the vault, so run
them only against a throwaway server; each script's header says what it covers and whether it writes. The desktop
ones (`desktop.mjs`, `webviewer.mjs`, `weblogins.mjs`, `media-desktop.mjs`) run the Electron app quietly
(`VAULTITE_QUIET`: its windows transparent, click-through and never focused, so nothing pops up over your work); `SHOW=1`
shows the window, and takes the screenshots that need it.

## Guidelines

- All data is files in the vault; no database, no hidden state. Writes are small edits that keep the rest of a file.
- A new feature is a plugin (`plugins/core/`, or a vault plugin of its own); a new block needs both sides, the React render
  and the text for `/api/render`, its declaration in the manifest's `blocks` (what it shows, its options:
  `core/blocks.ts`), and an entry in `core/pages/Design.md`.
- No real names, places or accounts in code, docs, tests or examples: use made-up ones (Alice Park, Bob Lee, Lighthouse).
- UI text: sentence case, no emojis, the app's colour tokens instead of hex colours.
- Backend code is erasable TypeScript run directly by Node: no enums, no parameter properties, `import type` for types,
  imports name the `.ts` file.
- Changing the plugin API in a way that breaks existing plugins: bump `API_VERSION` in `core/version.ts` and note it in
  CHANGELOG.md.
- CHANGELOG.md: one line per user-facing change, as it ends up (edit an Unreleased line rather than add another).
- Keep the version in `core/version.ts` equal to package.json's (a test checks).
