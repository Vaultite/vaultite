# Contributing

Thanks for helping. Vaultite is small on purpose: a core that indexes files and loads plugins, and everything else as
plugins. Read [CLAUDE.md](CLAUDE.md) and the `CLAUDE.md` of each folder you touch before a change: they hold the rules
that keep it simple (written for AI agents, and they work for people too).

## Setup

```sh
npm ci
npm run build
node bin/vau sandbox /tmp/vaultite-dev    # the sample vault, dated as of today (examples/vault + core/sandbox.ts)
VAULTITE_VAULT=/tmp/vaultite-dev VAULTITE_LOCAL=/tmp/vaultite-local PORT=8799 npm start
```

Run against a copy of a vault: the server writes into the vault it serves. Needs Node.js 23.6 or later (the server runs
TypeScript directly) and, for the QA scripts, Playwright's Chromium (`npx playwright-core install chromium`).

- Desktop app: `npm run app` (`-- --vault <path>` opens one). `npm run release` builds the signed, notarized dmgs and
  zips (Apple silicon and Intel) and latest-mac.yml in `dist-app/`; `npm run app:build` an unsigned app for this Mac,
  Vaultite Main (`dist-app/mac-arm64/Vaultite Main.app`): an app of its own beside a release, updating itself from main.
- Desktop app on Linux: `npm run release:linux` for the AppImage, .deb and latest-linux.yml (built on Linux, for its
  architecture: node-pty is compiled there), or `npm run app:install` to install this checkout for your user, updating
  itself from main. On Ubuntu 24.04+, `npm run app` needs an AppArmor profile for `node_modules/electron/dist/electron`
  allowing `userns` (Chromium's sandbox); `app:install` prints the one for its own copy.
- Releases are built by GitHub Actions (`.github/workflows/release.yml`). A `v<version>` tag matching package.json's is
  that release: its notes are the summary atop its CHANGELOG.md section, its zips go on the update feed. Each night
  main changed, it's the `nightly` prerelease: Vaultite Nightly (`npm run release:nightly`, `electron/nightly.cjs`), an
  app of its own that updates from the feed's `nightly/`. CI (`ci.yml`) builds and tests every push to main and every
  pull request.
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
npm run check       # the plugin rules, blocks, ops, bundles and skills (tools/check_plugins.ts)
npm test            # browser-free web modules, then the backend on a throwaway vault
npm run smoke       # the build starts: Chrome, desktop and phone, no page error, and opening a vault of your own
                    # changes none of its files (web/qa/boot.mjs, its own servers)
```

`npm run verify` runs what this branch's changes need (build, check, the vault test's areas and the QA scripts that
name the changed files, the web test and smoke when web/ changed) and times each.

UI changes: the scripts in `web/qa/` drive the app in Chromium at desktop and phone sizes (`node web/qa/layout.mjs
http://127.0.0.1:8799`). Many write to the vault, so run them only against a throwaway server; each one's header says
what it covers and whether it writes. `npm run qa` runs them all, each on a sandbox and server of its own
(`npm run qa -- sheets links` runs some, `--repeat 3` finds flaky ones, `--lint` finds selectors nothing draws). The
desktop ones (`desktop.mjs`, `webviewer.mjs`, `weblogins.mjs`, `media-desktop.mjs`) run the Electron app quietly
(`VAULTITE_QUIET`: its windows transparent, click-through and never focused); `SHOW=1` shows the window.

The web demo (the app and its server in the browser, on the sample vault: `web/demo/CLAUDE.md`): `npm run build:demo`
builds it into `web/dist-demo/`, static files for any host and path; `node web/qa/demo.mjs` checks it.
