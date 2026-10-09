# Notes for `electron/`

- **Desktop app** (`npm run app`, `npm run app:build`): each vault is a window with its own `server.ts` (forked with
  `ELECTRON_RUN_AS_NODE`, a port kept per vault so each keeps its localStorage), dying with its window.
  `VAULTITE_LOCAL` is the repo's `data/` from a checkout, `userData/local` when packaged. `vaults.json` is this Mac's,
  never a vault's. Files from outside a vault (Open with, a drop) open in the focused window and are read or written only
  when the main process sent their path (`core/outside.ts`); drops on the file tree are copied (⌥: moved) by `copyIn`.
- **Signing** (`sign.cjs`): with a code signing identity (`VAULTITE_SIGN_IDENTITY`, else a Developer ID or Apple
  Development one) macOS keeps the app's privacy grants across builds; signed ad hoc, each build is a new app and its
  terminals get "Operation not permitted" on an iCloud Drive vault. The microphone needs Info.plist's
  NSMicrophoneUsageDescription (package.json's build); a new native need is an entitlement (`entitlements.plist`).
- **Updates**: a release (`npm run release`: a dmg and zip each for Apple silicon and Intel in `dist-app/`, hardened
  runtime, the apps and dmgs notarized and stapled with the `vaultite-notary` profile, `electron/dmg.cjs`) updates from
  package.json's `build.publish` feed (electron-updater, the zip: one latest-mac.yml lists both, and each Mac takes its
  own, the one named arm64 on Apple silicon; a feed that fails goes only to update.log; `VAULTITE_UPDATE_URL` for
  tests). An app for the other architecture gets its native packages from package-lock.json (`natives.cjs`), so one
  `npm ci` builds both. Uploading the feed (latest-mac.yml, both zips and their blockmaps) is by hand, never part of a
  build; a build from a checkout runs `update.sh` every half hour (the repo's newest main built in `userData/source`,
  log `userData/logs/update.log`, for this Mac), and Restart to update swaps the app and reopens the vaults.
  How this Mac takes them is vaults.json's `updates` (Settings, Updates): `notify` (left out: the default) gets one
  ready and offers Restart to update, `automatic` restarts once every window says nothing would be lost
  (`app:update-safe`, web/src/core/unsaved.ts), `off` checks only from the menu. Test a
  release under another `appId` and `productName`: one sharing the installed app's bundle id makes macOS re-check its
  privacy grants.
  **Vaultite Dev** (`npm run app:dev` in a worktree) is a branch as its own app: it updates from it and opens the
  sandbox, never Set up (which writes outside the app).
- **Debugging the real window**: `debugPort` in `vaults.json` (or `VAULTITE_DEBUG_PORT`, from the next launch) serves
  Chromium's DevTools protocol on 127.0.0.1; `chromium.connectOverCDP(...)` then reads the user's live window (only read).
- **The menu bar** (`menu.ts`) is the focused window's commands as its page tells them (`menu:sync`): an item is a
  command id, never a copy of what it does; only single ⌘/⌃/⌥ steps become accelerators (the page gets every key
  first). Icons: name a lucide icon in menu.ts, then `node tools/menu_icons.ts`.
- **The Dock icon** (the `dock-icon` plugin) is a PNG the page drew, kept in userData: only the Dock, never the bundle.
- **Pop-out windows**: the page's `window.open` of `/?popout=<id>` is a window of the vault's own (`popouts`), with its
  own tabs (sessionStorage) and no sidebars; it neither takes the files waiting for the vault nor sets the menu bar.
  QA: `web/qa/desktop.mjs`, `popout.mjs`.
- **Set up Vaultite** (`web/onboarding.html`; the Mac side in `setup.ts`, main.ts's `setup:*`, which answer only its
  window): shown until finished (`userData/setup.json`) while there's no vault but the sandbox. The vault's server sets
  up a vault it never opened (core/start.ts: Minimal, its pages in `.vaultite/pages/`), nothing outside `.vaultite/` in
  a folder of the user's (`npm run smoke` checks it); tests never write outside `VAULTITE_SETUP_HOME`. Another machine's
  server (Manage vaults' Connect) is a window with no preload. QA: `web/qa/onboarding.mjs`.
