# Notes for `electron/`

- Each vault is a window with its own `server.ts` (forked with `ELECTRON_RUN_AS_NODE`, a port kept per vault so each
  keeps its localStorage), dying with its window, unless a server here already serves it (its service): then the window
  attaches to that one and answers its browser calls (host.ts). `vaults.json` is this Mac's, never a vault's.
- An update's relaunch (the store's, a Dev instance's) keeps the servers: told `desktop:relaunching` first, each waits
  30 s with its claim naming this app's data as heir, and the next launch takes it over (heir.ts: its own from then on,
  told things over the host socket, as no IPC can be had again). So a server's output is a file, never a pipe to main.
- Files from outside a vault (Open with, a drop) are read or written only when the main process sent their path
  (`core/outside.ts`).
- Signing (`sign.cjs`): with a real identity macOS keeps the app's privacy grants across builds; signed ad hoc, each
  build is a new app and its terminals get "Operation not permitted" on an iCloud Drive vault. A new native need is an
  entitlement (`entitlements.plist`) or an Info.plist usage string (package.json's `build`).
- Four apps, each its own id, name and userData, so any of them install side by side: Vaultite (releases), Vaultite
  Nightly (`nightly.cjs`), Vaultite Main (`source.cjs`: built from source, `app:build`) and Vaultite Dev (`dev.cjs`).
- Vaultite Dev runs a worktree's own code (`VAULTITE_CODE_ROOT`) in a Dev shell built for its fingerprint (`dev.ts`:
  `npm run app:dev`), one instance per worktree with data of its own (userData, ports, sandbox, keepers; no helper):
  it opens the sandbox, never Set up, and takes in the worktree's changes as they're saved (`devroot.ts`, `devreach.ts`):
  web/dist rebuilt, its servers restarted, a relaunch offered (done, headless). `--stop` ends one with everything it
  started (whatever carries its `VAULTITE_USER_DATA`); its shell has `--inspect` on, so QA drives it (`VAULTITE_QA_SHELL=dev`).
- Vaultite Main where `use-code-store` is in its data folder (`storepolicy.ts`, read at each look and launch) updates
  through the root store (core/update/store.ts, `storehost.ts`): each commit made once into a read-only root, then only
  what it changed acts (core/update/plan.ts): its servers take the new web build or restart from the new root, the main
  process is offered a relaunch onto it (seconds, nothing installed); only a new shell fingerprint builds and installs the
  app as before. Attached to a service it takes only its server's commit; standalone, the branch's newest. A server it started (this launch's, its last one's taken over) is never a service: a window attaching to one would pin the app to a commit that only moves with the app (storepolicy.ts pinOf). Processes run
  from a root hold it (core/update/lease.ts) until they end. Removing the marker runs the bundle at the next launch.
- An update (update.sh install) is staged beside the app and renamed in once it quit: a copy opened from the old bundle
  meanwhile would run the replaced tree while the disk says new (`ps` still shows the old path), so a running main is
  looked for first, and the app checks its server against build.json once up (installed.ts). The app's binary also runs
  its server, terminal keeper and agents' `vau mcp`: those aren't the app running.
- The app's entry is its shell (`shell/`: package.json `main` is `shell/boot.mjs`), plain .mjs on Node's and Electron's
  own modules: it sets the app's name and id (shell.json), picks the code root (`roots.mjs`: the bundle; Dev's worktree;
  Main's store once turned on in `ENABLED`) and keeps a record in userData/shell (attempts, bad roots, events, told in
  the first window's Errors). Its files and what `inputs.json` lists are the shell fingerprint (stamped in shell.json): a
  change to one needs a new build of the app. `shell/vau.mjs` is the CLI's one stable path (`VAULTITE_VAU_ENTRY`).
- Test a release under another `appId` and `productName`: one sharing the installed app's bundle id makes macOS re-check
  its privacy grants. Uploading the update feed is by hand, never part of a build.
- Debugging the real window: `debugPort` in `vaults.json` (or `VAULTITE_DEBUG_PORT`) serves Chromium's DevTools
  protocol on 127.0.0.1; connect over CDP to read the user's live window, read only.
- The menu bar (`menu.ts`) is the focused window's commands as its page tells them: an item is a command id, never a
  copy of what it does. Only single ⌘/⌃/⌥ steps become accelerators (the page gets every key first).
- The Dock icon a page draws changes only the Dock, never the bundle.
- The first run is Set up Vaultite's window (the vault) and then the welcome card in the vault's window (web
  Welcome.tsx: the look, AI, permissions). It writes nothing outside `.vaultite/` in a folder of the user's (`npm run
  smoke` checks) but what they turn on there (agents' plugins and their pages), nor outside the vault but what they
  press (Allow on the card: Claude Code's and Codex's computer use); its tests write only under `VAULTITE_SETUP_HOME`.
- Location, Input monitoring and the drag panel (Settings > Permissions' Allow) are a Node addon in the main process
  (`macpermissions.m`), not a helper: CoreLocation and IOHIDCheckAccess answer for the process that asks, and macOS
  gives a helper binary no Location of the app's. Electron itself never asks macOS for Location.
- macOS credits what programs in the app's terminals do (screen capture, Accessibility) to the app: the terminal keeper
  is the app's child, and stays its even after the app quits. One grant covers every agent there.
- Windows: a release build only (no update.sh; Vaultite Main is Mac and Linux). Its title bar is the page's, with
  Windows' controls drawn over the top-right corner (preload.cjs tells their colours, index.css keeps clear of them);
  files and vaultite:// links come in argv and `second-instance`, outside paths go to the page with forward slashes.
  Its installer stops every process running its .exe, terminal keepers and `vau` included, before it updates.
- The menu-bar helper (helper.ts, a Mac's): Electron's own process kept windowless with a Tray, not a second app, so it
  is one install with one signature and the grants the app already has (microphone, Accessibility, screen recording).
  One per Mac (a lock socket in the temp folder: Vaultite, Main and Dev may all run); off in Vaultite Dev and under
  VAULTITE_QUIET unless VAULTITE_HELPER=1. With it, a closed window's server is kept (`kept` in main.ts) and the Dock
  icon shows only while a window is open. Native parts: screen.swift (the keys' tap and ink, fields, other apps' text, the display's picture), dictation, voice.swift
  (the companion's voice out: it never plays under VAULTITE_QUIET, and VOICE_OUT writes a file instead). Each Swift helper
  is built by swiftbuild.ts and run by linehelper.ts; screen.swift and takeover.swift share ax.swift, so they name an element alike.
  Only the app the user runs (packaged, not VAULTITE_QUIET; VAULTITE_HELPER_TAP=1 by hand) hears their keys and takes the
  one lock; a scripted copy hears a file, never the microphone (or, where no recognizer is, as on macOS 15, VAULTITE_DICTATION_TEXT's words), and where that lock is held (the user's app runs) its QA
  (web/qa/helper.mjs) is skipped unless VAULTITE_QA_LIVE=1. Each Talk-key press is logged (presslog.ts:
  userData/talk/talk-<day>.jsonl, a missed press's audio beside it): a press that went nowhere can be traced, and one
  that went shows its answer's first sound (`sound`: whose voice, ms after let-go), a voice failing over and one saying nothing (`voice-silent`: a notice says so once, and the answer shows in its box), one kept quiet for a call (`quiet`: calllogic.ts; `not-a-call`, its box's button pressed); `stt` names
  the recognizer that heard it (`soniox`, else this Mac's with `why`), `stt-fallback` one failing mid-press; its `mic`
  and `micWhy` the input device and why, `mic-change` one that went mid-press.
- The helper reloads onto a new code root in place (helperload.ts, the store's plan `helper: reload`: a commit only its
  slice runs), once `helperBusy()` says nothing would be cut short: the new root's helper.ts is a module graph of its own,
  started after the old one's `stopHelper`. So the helper keeps no state in a module the main process imports too (a
  second copy would drift from main's): the main process's comes through `HelperHost` (dictation's one recognizer and
  owner), a shared module stays stateless (tools/test_closure.ts lists both), and what a module of its sets up on
  Electron's emitters goes through helperscope.ts, given back at stop (web/qa/helperreload.mjs counts it). ESM never
  unloads: each reload leaves the old graph's code and module state in memory (nothing live) till the next relaunch.
- A dictation that leaves its window moves to the helper (dictation.ts `handOver`, the page keeps where it began till its
  words land: web core/dictation.ts): it's the helper's overlay that shows over every app. dictationroam.ts picks where they land;
  dictationfix.ts follows another app's field they went into for the user's fixes (screen.swift `follow`, polled: apps
  don't all post AX value changes), learned as in the window (plugins/core/dictation/learn.ts).
- The realtime voice (realtimefront.ts over realtime.ts, OpenAI's WebSocket): dictation's session taps the mic for it
  (`tap`, 16 kHz, made 24 kHz), voice.ts' `stream()` plays its audio. It only gives the first sound: dictation still runs,
  and its words go to the summoned session at once, as on the pipeline (a screen answer is never slower for it); that
  answer is held (voice.ts `hold`) till the realtime voice routes the press (`look`: played after its two words, which
  give way, voice.swift `yield`; `talk`: it answered alone, the summoned answer withdrawn). Its tests are a stand-in
  socket; tools/evals/realtime.ts the real one.
- Bluetooth headsets drop to a call's sound while their microphone is open, and leave it about 2 s after it closes.
  So with one as the output, miclogic.ts picks the built-in (else a wired) mic (the setting Microphone, `auto`;
  dictation.swift lists the devices and opens the pick, the next one should it go); one used anyway is held open after
  a Talk key's press till its answer is said and a second on (`releaseMic`, at most 60 s). voice.swift follows its output device all the same (an engine started before a switch
  plays into nothing): a new engine, said again from the pause before (`voice-reroute`; `sound` says where it plays).
- An overlay window lets the pointer through but over what its page marks `data-hold` (web screendraw/hold.ts tells
  their boxes): overlaywin.ts `takesPointer` decides by where the pointer is, never a page's enters and leaves (a node
  gone under a still pointer, a reload, a crash or a hide left one taking every click under it: web/qa/overlayholds.mjs).
- The overlay (overlay.ts) is BrowserWindows, never `AppWindow`s: those count as the app's windows (the Dock, menus).
  Each is made by overlaywin.ts (a new one too): over every Space, and kept out of screen shares and recordings
  (content protection; the setting `hide_from_shares`). The companion's own pictures leave them out by number all the same.
  `skipTransformProcessType`, or showing it on every Space takes the app out of the Dock. It never takes the keyboard: a
  cursor's conversation is a window of its own (`type: "panel"`, non-activating), so typing there leaves the app in
  front in front, and closing it gives that app its keyboard back.
- Every window is an `AppWindow` (appwindow.ts): a BaseWindow whose page is a view, so it can go over the Browser's
  pages (web.ts `raise`); a BrowserWindow's own page is always under its views. Pop-outs are adopted into one.
- A page's sized popup (a sign-in, a call's video) is a window of its own (popup.ts), never its opener window's child:
  on a Mac a child moves, minimizes and changes Space with its parent. One that stays on its opener's site (or is a
  blank one the opener writes into) is a pop-out, bare as a player; once it goes to another site it's a sign-in for good,
  its title bar naming that site, so the user sees who's asking. Keep on top (ontop.ts) skips Electron's process
  transform (it takes the app out of the Dock and the menu bar) and turns full screen off for the window meanwhile.
