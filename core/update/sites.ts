// What closure.ts can't read from imports, said once: the processes (entries), and every place that loads code or reads
// the app's files by a computed path. tools/test_closure.ts fails on a loose end not declared here.

/** A long-lived process, or a part of one: what it starts from (`from`), stopping at `cut`. A slice (`within`) is what
 *  its process reaches only through its own `from`. `mode`: resolved as Node runs it, or as vite bundles it. */
export type Entry = { id: string; label: string; from: string[]; mode: "node" | "vite"; cut?: string[]; within?: string }

export const ENTRIES: Entry[] = [
  { id: "server", label: "Server", from: ["server.ts"], mode: "node" },
  // (the shell, electron/shell/, imports the code root it picks: run from a checkout, that's this tree)
  { id: "desktop", label: "Desktop app", from: ["electron/shell/boot.mjs"], mode: "node", cut: ["electron/helper.ts"] },
  { id: "helper", label: "Menu-bar helper", from: ["electron/shell/boot.mjs"], mode: "node", within: "desktop" },
  { id: "cli", label: "vau", from: ["bin/vau", "electron/shell/vau.mjs"], mode: "node" },
  { id: "termd", label: "Terminal keeper", from: ["plugins/core/terminal/termd/termd.ts"], mode: "node" },
  { id: "chatd", label: "Chat keeper", from: ["plugins/core/claude-code/chatd.ts"], mode: "node" },
  // (vite builds web/dist from its pages; its config and what that reads shape the build too)
  // (the server in a browser: npm run build:demo bundles the core against web/demo/node's stubs)
  { id: "demo", label: "Web demo", from: ["web/demo/worker.ts"], mode: "vite" },
  { id: "web", label: "Web app", from: ["web/index.html", "web/vaults.html", "web/onboarding.html", "web/phone.html", "web/screen.html", "vite.config.ts"], mode: "vite" },
]

/** A place in `file` the imports don't show (closure.ts' loose ends there, accounted for). */
export type Site = {
  file: string; why: string
  /** The computed import()s, require()s and Workers it covers, each by a piece of its source. */
  at?: string[]
  /** Its paths from its own place (import.meta, ROOT) are what `reads` and `fresh` say. */
  anchors?: true
  /** The processes it starts from a file: entries, or one run per use. */
  spawns?: string[]
  /** Code it imports by a computed path (followed like imports); files the process reads and keeps (in its reach). */
  loads?: string[]; reads?: string[]
  /** Read again at each use, so never stale: outside the reach, said so it's a decision, not an oversight. */
  fresh?: string[]; mode?: "node" | "vite"
  /** Its code runs only from this file (its one caller): what it loads and reads counts where that's reached too. */
  caller?: string
}

/** Code and files the processes find by path. Where a read's caching wasn't plain, it's in `reads`: unknown is changed. */
export const SITES: Site[] = [
  // ---------- the server
  { file: "server.ts", why: "a test's server ends with its test, from a thread of code given as text; its own file: the code root it holds from the store's gc", at: ["new Worker(`const pid"], anchors: true },
  { file: "core/plugins.ts", why: "the server imports every built-in plugin's plugin.ts (load); a Plugin reads its folder (PLUGIN_READS)",
    at: ["import(pathToFileURL(file).href)"], anchors: true, caller: "core/app.ts", loads: ["plugins/core/*/plugin.ts"], reads: ["plugins/core/*/manifest.json"] },
  { file: "core/vaultplugins.ts", why: "vault plugins' backends: from the vault, not the app, importing the core's API and app plugins' exports; the app's Tailwind setup compiles their classes",
    at: ["import(`${pathToFileURL(file).href}?plugin="], anchors: true, caller: "core/app.ts",
    loads: ["core/{plugins,vault,client,timeline,agents,layout}.ts"], reads: ["package.json"], fresh: ["web/dist/**", "web/src/index.css"] },
  { file: "core/docs.ts", why: "the docs' topics: core/docs and plugins' docs/", anchors: true, reads: ["core/docs/*.md", "plugins/core/*/docs/*.md"] },
  { file: "core/bundles.ts", why: "the app's bundles (setups), read when listed or applied", anchors: true, reads: ["bundles/**"] },
  { file: "core/sandbox.ts", why: "a new sandbox copies the sample vault and the design doc, each time", anchors: true, fresh: ["examples/vault/**", "core/docs/design.md"] },
  { file: "core/appsource.ts", why: "palette commands, panels and icons scanned from the source at each ask; a packaged app's snapshot",
    anchors: true, fresh: ["web/src/**", "plugins/core/*/index.tsx"] },
  { file: "core/webbuild.ts", why: "the web build served: the web entry's output, taken without a restart", anchors: true, fresh: ["web/dist/**"] },
  { file: "core/running.ts", why: "git in its own checkout", anchors: true },
  { file: "core/appentry.ts", why: "bin/vau's path, and shims running it with this process's runtime", anchors: true, spawns: ["cli"] },
  { file: "core/agents.ts", why: "agents' MCP server is `vau mcp` (the CLI); finding npm beside this Node", spawns: ["cli"] },
  { file: "core/hooks.ts", why: "plugins' hook commands, run per event from their folders", spawns: ["a hook's command, per event"] },
  { file: "core/wslvau.ts", why: "WSL's vau shim runs the CLI", spawns: ["cli"] },
  { file: "bin/vaultite-server", why: "the service's stable path, run from its checkout (no root's: like the app's shell): the store's picked root's server.ts, else the checkout's", at: ['import(pathToFileURL(path.join(root, "server.ts")).href)'], anchors: true, loads: ["server.ts"] },
  { file: "core/update/servicestore.ts", why: "a service's roots made with its own Node (store.ts' steps)", spawns: ["a root's npm and node steps, per prepare"] },
  { file: "core/update/store.ts", why: "a code root's own build, helpers, stamp and preflight, run in that root", spawns: ["a root's npm and node steps, per prepare"] },
  { file: "core/cli.ts", why: "vau merges in the built-in plugins' cli.ts; `vau service` runs server.ts",
    at: ['import(pathToFileURL(path.join(d, "cli.ts")).href)'], anchors: true, caller: "bin/vau", spawns: ["server"], loads: ["plugins/core/*/cli.ts"] },
  { file: "plugins/core/agent-files/plugin.ts", why: "the core's AGENTS.md, in agents' files", anchors: true, reads: ["core/AGENTS.md"] },
  { file: "plugins/core/activity/profile.ts", why: "ROOT trims stack frames", anchors: true },
  { file: "plugins/core/companion/wiring.ts", why: "ROOT names this checkout", anchors: true },
  { file: "plugins/core/companion/jobplace.ts", why: "ROOT: whether a worker's checkout is this one", anchors: true },
  { file: "plugins/core/share/gateway.ts", why: "serves the web build and Excalidraw's fonts (a package)", anchors: true, fresh: ["web/dist/**"] },
  { file: "plugins/core/mcp/public.ts", why: "web/public's files, served per request", anchors: true, fresh: ["web/public/**"] },
  { file: "plugins/core/mcp-apps/plugin.ts", why: "its cards, in its folder", anchors: true, reads: ["plugins/core/mcp-apps/cards/**"] },
  { file: "plugins/core/sync-conflicts/plugin.ts", why: "its Swift helper, built from source on a Mac", anchors: true, reads: ["plugins/core/sync-conflicts/*.swift"] },
  { file: "plugins/core/audio-recorder/plugin.ts", why: "its Swift helper, built from source on a Mac", anchors: true, reads: ["plugins/core/audio-recorder/*.swift"] },
  { file: "plugins/core/genui/sandbox.ts", why: "a generated UI's program, in a worker made from its text in a page", at: ["new Worker(url)"] },
  { file: "plugins/core/codex/plugin.ts", why: "this Node's folder on Codex's PATH", spawns: [] },
  { file: "plugins/core/terminal/backend.ts", why: "the terminal keeper", spawns: ["termd"] },
  { file: "plugins/core/terminal/terms.ts", why: "vau shims for terminals; starter.ts runs once per terminal started", spawns: ["cli", "plugins/core/terminal/starter.ts, per terminal"] },
  { file: "plugins/core/terminal/starter.ts", why: "whether it's the script run", anchors: true },
  { file: "plugins/core/claude-code/chat.ts", why: "the chat keeper", spawns: ["chatd"] },
  // ---------- the keepers
  { file: "plugins/core/terminal/termd/termd.ts", why: "its own file: retires once it's gone (a moved checkout)", anchors: true },
  { file: "plugins/core/claude-code/chatd.ts", why: "its own file: retires once it's gone; hashes its three files as its code (chathost.ts codeOf)", anchors: true },
  // ---------- the desktop app (its windows load web/dist: the web entry's)
  { file: "electron/shell/boot.mjs", why: "the shell: the bundle's stamps, and the code root it picks (roots.mjs), whose electron/boot.ts it imports",
    at: ['import(pathToFileURL(path.join(picked.root, "electron", "boot.ts")).href)'], anchors: true, loads: ["electron/boot.ts"] },
  { file: "electron/shell/vau.mjs", why: "vau's stable path: the picked root's bin/vau", at: ['import(pathToFileURL(path.join(root, "bin", "vau")).href)'], anchors: true, loads: ["bin/vau"] },
  { file: "electron/main.ts", why: "its windows' preload and icons; forks server.ts; Help's README and CHANGELOG, opened per use",
    anchors: true, spawns: ["server", "cli"], reads: ["electron/preload.cjs", "web/public/icon-512.png", "electron/tray/**"], fresh: ["web/dist/**", "README.md", "CHANGELOG.md"] },
  { file: "electron/identity.ts", why: "the app's name and build from package.json and the stamps", anchors: true, reads: ["package.json"] },
  { file: "electron/updates.ts", why: "update.sh, run per update", anchors: true, fresh: ["electron/update.sh"] },
  { file: "electron/helperload.ts", why: "the menu-bar helper reloaded onto a new code root of the store: that root's helper.ts; its own root, the main process's",
    at: ['import(pathToFileURL(path.join(t.root, "electron", "helper.ts")).href)'], anchors: true, loads: ["electron/helper.ts"] },
  { file: "electron/storehost.ts", why: "Main's updates through the root store: its own root, and the store's current one its servers start from", anchors: true },
  { file: "electron/storeupdate.ts", why: "the store's updates' work: each root's steps and preflight, and a new shell's build, run per update",
    anchors: true, spawns: ["server, per root's preflight", "electron-builder, per new shell"] },
  { file: "electron/devroot.ts", why: "a Dev instance's worktree: Vite's build, run per change it saves", spawns: ["node_modules/vite/bin/vite.js, per change"] },
  { file: "electron/devinstance.ts", why: "Vaultite Dev's name and id from its electron-builder config (or a test's)", at: ["createRequire(import.meta.url)(config)"], loads: ["electron/dev.cjs"] },
  { file: "electron/dev.ts", why: "npm run app:dev, run by hand: its worktree from its own place; stamp.ts and electron-builder per shell it builds",
    anchors: true, spawns: ["electron/stamp.ts, per shell build"] },
  { file: "electron/permissions.ts", why: "its own bundle, from its binary's path", spawns: [] },
  { file: "electron/menu.ts", why: "menus' icons", anchors: true, reads: ["electron/menu-icons/**"] },
  { file: "electron/island.ts", why: "its windows' preload", anchors: true, reads: ["electron/screen-preload.cjs"] },
  { file: "electron/overlay.ts", why: "its windows' preload", anchors: true, reads: ["electron/screen-preload.cjs"] },
  { file: "electron/browser/extensions.ts", why: "extensions' preload", anchors: true, reads: ["electron/browser/extensions.preload.cjs"] },
  { file: "electron/swiftbuild.ts", why: "Swift helpers built from source (named by its hash) and run as long as they're needed",
    anchors: true, reads: ["electron/{screen,ax,takeover,capture,voice,appwindows}.swift"] },
  { file: "electron/dictation-build.ts", why: "dictation's Swift helper (swiftbuild.ts)", reads: ["electron/dictation.swift"] },
  { file: "electron/macaddons.ts", why: "Objective-C addons built from source and loaded into the process", anchors: true, reads: ["electron/*.m"] },
  { file: "electron/helper.ts", why: "the defaults of the settings it follows, read with them every 10 s", anchors: true, fresh: ["plugins/core/{dictation,companion,screen}/manifest.json"] },
  // ---------- commands, not long-lived processes
  { file: "electron/start.ts", why: "npm run app: starts Electron on this folder", anchors: true, spawns: ["desktop"] },
  { file: "electron/install.ts", why: "npm run app:install", anchors: true },
  { file: "electron/stamp.ts", why: "a build's stamp", anchors: true },
  // ---------- the web app
  { file: "vite.config.ts", why: "the build's pages, plugins' icons and modules, web/public copied into the build", anchors: true,
    reads: ["plugins/core/*/manifest.json", "web/public/**"] },
  // (Tailwind scans the whole project for class names; counted are the files the app ships, not tests and tools)
  { file: "web/src/index.css", why: "Tailwind finds classes in the app's source (and @source's plugins/)", reads: ["web/src/**", "web/*.html"] },
  { file: "web/src/core/vaultPlugins.ts", why: "vault plugins' bundles, from the server", at: ["import(/* @vite-ignore */ new URL(`api/plugins/", "import(/* @vite-ignore */ url)"] },
]

/** Exports that are the app's own folder: importing one is an anchor too. */
export const ROOT_EXPORTS = [{ file: "core/plugins.ts", name: "ROOT" }]
/** Made by a build, never in a tree: an import of one isn't missing. */
export const GENERATED = ["electron/build.json", "electron/cli.json", "electron/shell.json", "web/dist/**", "electron/bin/**", "plugins/core/*/bin/**"]
/** A built-in plugin's files its server reads besides code (`new Plugin(import.meta.url)`: core/plugins.ts reads its
 *  folder): its manifest, docs, pages, skills, cards, helpers' sources. Not its frontend's code and styles, nor CLAUDE.md. */
export const PLUGIN_READS = /^(?!.*\/CLAUDE\.md$).*\.(json|md|html|swift|py|wasm|txt|svg|png|yml|yaml)$/
