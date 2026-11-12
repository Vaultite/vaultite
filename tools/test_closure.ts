// The module graph (core/update/closure.ts, sites.ts): the resolver on made-up trees, every loose end declared, and a real
// server boot loading nothing the graph misses. In npm test; the desktop app's boot is web/qa/closure.mjs (Electron).
import fs from "node:fs"
import path from "node:path"
import module from "node:module"
import { check, exit, freePort, section, skip, sleep, stopTerminals, summary, tempDir, testServer } from "./test/lib.ts"
import { recorded, recording, uncovered, entriesOf } from "./test/recorded.ts"
import { diskTree, globRe, graphOf, type Tree } from "../core/update/closure.ts"
import type { Entry, Site } from "../core/update/sites.ts"
import { SITES } from "../core/update/sites.ts"
import { makeSandbox } from "../core/sandbox.ts"
const t0 = Date.now()
const ROOT = path.resolve(import.meta.dirname, "..")

const treeOf = (files: Record<string, string>): Tree => ({ files: Object.keys(files).sort(), read: (f) => files[f] ?? null })
const has = (g: ReturnType<typeof graphOf>, id: string, f: string) => g.reach(id).files.has(f)

section("globs")
check("* stays in a folder, ** crosses them", globRe("a/*.ts").test("a/b.ts") && !globRe("a/*.ts").test("a/b/c.ts") && globRe("a/**/*.ts").test("a/b/c.ts") && globRe("a/**/*.ts").test("a/c.ts"))
check("{a,b} is either", globRe("x/{a,b}.ts").test("x/b.ts") && !globRe("x/{a,b}.ts").test("x/c.ts"))

section("what Node loads")
{
  const entries: Entry[] = [{ id: "e", label: "E", from: ["main.ts"], mode: "node" }]
  const sites: Site[] = [{ file: "loader.ts", why: "a test", at: ["import(pick)"], loads: ["mods/*.ts"] }]
  const g = graphOf(treeOf({
    "main.ts": `import type { T } from "./types.ts"\nimport { type U, v } from "./mixed.ts"\nexport type { W } from "./w.ts"\nimport "./side.ts"
      export * from "./all.ts"\nlet t: typeof import("./typeonly.ts")\nconst a = await import("./lazy.ts"), b = await import(\`./tpl.ts\`)
      import { createRequire } from "node:module"\nimport ws from "ws"\nimport "./loader.ts"
      const r = createRequire(import.meta.url)("./lib/x.cjs"), p = createRequire(import.meta.url).resolve("pkg/package.json")
      new Worker(new URL("./worker.ts", import.meta.url)); const pre = new URL("./preload.cjs", import.meta.url)
      import { exported } from "@plugins/alpha/lib/format"\nimport json from "./data.json" with { type: "json" }\nimport b2 from "./electron/build.json"`,
    "types.ts": "", "mixed.ts": "", "w.ts": "", "side.ts": "", "all.ts": "", "typeonly.ts": "", "lazy.ts": "", "tpl.ts": "",
    "lib/x.cjs": `const y = require("./y")\nmodule.exports = y`, "lib/y.js": "", "worker.ts": "", "preload.cjs": "", "data.json": "{}",
    "loader.ts": "export const go = (pick: string) => import(pick)", "mods/one.ts": "", "mods/two.ts": "",
    "plugins/core/alpha/manifest.json": JSON.stringify({ exports: ["lib/format"] }), "plugins/core/alpha/lib/format.ts": "",
    "package.json": "{}", "package-lock.json": "{}",
  }), { entries, sites })
  const r = g.reach("e")
  check("`import type` and `export type` aren't loaded; `typeof import()` isn't either", !has(g, "e", "types.ts") && !has(g, "e", "w.ts") && !has(g, "e", "typeonly.ts"))
  check("an import with a type in it still loads its module", has(g, "e", "mixed.ts") && has(g, "e", "side.ts") && has(g, "e", "all.ts"))
  check("import() of a literal, or a template without ${}", has(g, "e", "lazy.ts") && has(g, "e", "tpl.ts"))
  check("require through createRequire, finding .js as require does", has(g, "e", "lib/x.cjs") && has(g, "e", "lib/y.js"))
  check("a worker beside it, a preload beside it", has(g, "e", "worker.ts") && has(g, "e", "preload.cjs"))
  check("a package: the lockfile (node_modules) is in its reach", has(g, "e", "package-lock.json") && has(g, "e", "package.json"))
  check("@plugins/<id>/<module>: the file its manifest exports, and the manifest", has(g, "e", "plugins/core/alpha/lib/format.ts") && has(g, "e", "plugins/core/alpha/manifest.json"))
  check("a declared computed import loads what its site says", has(g, "e", "mods/one.ts") && has(g, "e", "mods/two.ts"))
  check("JSON is a file it reads; a generated one isn't missing", has(g, "e", "data.json") && !r.unknown.some((l) => l.text.includes("build.json")))
  check("createRequire(import.meta.url) and new URL(…, import.meta.url) are no loose ends", !r.unknown.length, r.unknown)
  const chain = g.hit("e", ["lib/y.js", "mods/two.ts", "lazy.ts"])
  check("a change's answer: the changed file nearest the entry, with its chain", chain?.file === "lazy.ts" && chain.chain.join(">") === "main.ts>lazy.ts", chain)
  check("… through a site too", g.hit("e", ["mods/two.ts"])?.chain.join(">") === "main.ts>loader.ts>mods/two.ts", g.hit("e", ["mods/two.ts"]))
  check("a change it doesn't reach: null", g.hit("e", ["types.ts", "README.md"]) === null)
}

section("loose ends make the answer unknown")
{
  const entries: Entry[] = [{ id: "e", label: "E", from: ["main.ts"], mode: "node" }]
  const tree = treeOf({ "main.ts": `import "./a.ts"\nimport "./gone.ts"`, "other.ts": "",
    "a.ts": `import { fork as f } from "node:child_process"\nconst n = "x"; await import(n)\nconsole.log(import.meta.dirname)\nf("./kid.ts")` })
  const g = graphOf(tree, { entries, sites: [] })
  const kinds = g.reach("e").unknown.map((l) => l.kind).sort().join(" ")
  check("a computed import, a path from its own place, a process started (fork), a missing file", kinds === "anchor import import spawn", g.reach("e").unknown)
  const h = g.hit("e", ["other.ts"])
  check("unknown counts as changed, saying why", !!h?.unknown && h.file === "other.ts", h)
  check("no change, no answer", g.hit("e", []) === null)
  const declared = graphOf(tree, { entries, sites: [{ file: "a.ts", why: "a test", at: ["import(n)"], anchors: true, spawns: [] }, { file: "main.ts", why: "a test", at: [] }] })
  check("declared, only the missing file stays unknown", declared.reach("e").unknown.map((l) => l.text).join() === "./gone.ts: no such file here", declared.reach("e").unknown)
  const local = graphOf(treeOf({ "main.ts": `const fork = () => 1\nfork()` }), { entries, sites: [] })
  check("a function of its own named fork is no process", local.reach("e").unknown.length === 0, local.reach("e").unknown)
  const broken = graphOf(treeOf({ "main.ts": `import "./a.ts"\nconst = 1` , "a.ts": "" }), { entries, sites: [] })
  check("what doesn't parse is unknown (it may hide an import)", broken.reach("e").unknown.some((l) => l.text.startsWith("doesn't parse")), broken.reach("e").unknown)
  const exec = graphOf(treeOf({ "main.ts": `spawn(process.execPath, ["./kid.ts"])` }), { entries, sites: [] })
  check("running this Node is a process started", exec.reach("e").unknown.map((l) => l.kind).join() === "spawn", exec.reach("e").unknown)
}

section("a site that runs only beside its caller; a slice of a process")
{
  const entries: Entry[] = [
    { id: "big", label: "Big", from: ["big.ts"], mode: "node", cut: ["helper.ts"] },
    { id: "slice", label: "Slice", from: ["big.ts"], mode: "node", within: "big" },
    { id: "small", label: "Small", from: ["small.ts"], mode: "node" },
  ]
  const sites: Site[] = [{ file: "registry.ts", why: "a test", caller: "app.ts", loads: ["plugins/*.ts"] }]
  const g = graphOf(treeOf({
    "big.ts": `import "./app.ts"\nimport "./shared.ts"\nconst h = () => import("./helper.ts")`, "app.ts": `import "./registry.ts"`, "registry.ts": "",
    "helper.ts": `import "./shared.ts"\nimport "./own.ts"`, "shared.ts": "", "own.ts": "", "plugins/p.ts": "",
    "small.ts": `import "./registry.ts"`,
  }), { entries, sites })
  check("where its caller runs, the site loads", has(g, "big", "plugins/p.ts"))
  check("where only the module is imported, it doesn't", !has(g, "small", "plugins/p.ts") && has(g, "small", "registry.ts"))
  check("the slice: only what the process reaches through it", has(g, "slice", "helper.ts") && has(g, "slice", "own.ts") && !has(g, "slice", "shared.ts") && !has(g, "big", "own.ts"))
  check("the slice's chain starts at its own entry", g.hit("slice", ["own.ts"])?.chain.join(">") === "helper.ts>own.ts", g.hit("slice", ["own.ts"]))
}

section("what vite bundles")
{
  const entries: Entry[] = [{ id: "web", label: "Web", from: ["web/index.html"], mode: "vite" }]
  const g = graphOf(treeOf({
    "web/index.html": `<link rel="icon" href="icon.svg" /><script type="module" src="/src/main.tsx"></script>`, "web/public/icon.svg": "",
    "web/src/main.tsx": `import "./index.css"\nimport { a } from "@/core/a"\nimport api from "@vaultite"\nimport text from "./notes.md?raw"\nimport v from "virtual:plugin-icons"
      const all = import.meta.glob(["../../plugins/core/*/*.tsx", "!../../plugins/**/plugin.tsx"]), env = import.meta.env.DEV
      new Worker(new URL("./w.worker.ts", import.meta.url), { type: "module" })`,
    "web/src/core/a/index.ts": "", "web/src/api.ts": "", "web/src/notes.md": "", "web/src/w.worker.ts": "",
    "web/src/index.css": `@import "tailwindcss";\n@import "./themes/one.css";\n@source "../../plugins";`, "web/src/themes/one.css": "",
    "plugins/core/x/index.tsx": "", "plugins/core/x/plugin.tsx": "", "plugins/core/x/notes.txt": "",
  }), { entries, sites: [] })
  check("@/ and @vaultite, with vite's extensions and index files", has(g, "web", "web/src/core/a/index.ts") && has(g, "web", "web/src/api.ts"))
  check("a query is the file; a virtual module is no file", has(g, "web", "web/src/notes.md") && !g.reach("web").unknown.length, g.reach("web").unknown)
  check("import.meta.glob, with its negations", has(g, "web", "plugins/core/x/index.tsx") && has(g, "web", "web/src/w.worker.ts"))
  check("the page's script and icon (web/public)", has(g, "web", "web/src/main.tsx") && has(g, "web", "web/public/icon.svg"))
  check("CSS: @import, and @source's folder", has(g, "web", "web/src/themes/one.css") && has(g, "web", "plugins/core/x/notes.txt") && has(g, "web", "plugins/core/x/plugin.tsx"))
}

const tree = diskTree(ROOT)
const g = graphOf(tree)
await section("the app's own code", () => {
  const all = g.looseEnds(["server.ts", "bin/*", "core/**", "plugins/core/**", "electron/**", "web/src/**", "vite.config.ts", "!**/.test/**"])
  const undeclared = all.filter((l) => !l.declared)
  check(`every computed import, path from code's own place and process started is declared (${all.length})`, !undeclared.length,
    undeclared.map((l) => `${l.file}:${l.line} ${l.kind} ${l.text.slice(0, 80)}`))
  const stale = SITES.filter((s) => {
    const mine = all.filter((l) => l.file === s.file)
    const globs = [...(s.loads ?? []), ...(s.reads ?? []), ...(s.fresh ?? [])].filter((x) => !x.startsWith("!") && !x.startsWith("web/dist"))
    return !tree.files.includes(s.file) || s.at?.some((a) => !mine.some((l) => l.kind === "import" && l.text.includes(a))) ||
      (s.anchors && !mine.some((l) => l.kind === "anchor")) || (s.spawns && !mine.some((l) => l.kind === "spawn")) ||
      globs.some((x) => !tree.files.some((f) => globRe(x).test(f)))
  })
  check("every site still is one (its file, what it covers, the files it names)", !stale.length, stale.map((s) => s.file))
  for (const e of g.entries) check(`${e.label}: nothing unknown in what it reaches (${g.reach(e.id).files.size} files)`, !g.reach(e.id).unknown.length, g.reach(e.id).unknown.slice(0, 5))
  check("the desktop app doesn't reach the server's plugin loading", !g.reach("desktop").files.has("plugins/core/notes/plugin.ts"))
})

// Each file the main process reaches is a relaunch when it changes: a server's module or a plugin's backend there came
// by accident (a pure function beside server code), and every commit to it relaunched every Mac's app.
await section("the desktop app's main process reaches only its own", () => {
  const NEVER = [/^plugins\/core\/[^/]+\/plugin\.ts$/, /^server\.ts$/, /\.md$/,
    /^core\/(plugins|app|vault|ops|migrations|trust|kept|selfupdate|running|docs|blocks|frontmatter|sections|syncengine|hooks|agents|client|timeline|layout|vaultplugins)\.ts$/]
  for (const id of ["desktop", "helper"]) {
    const r = g.reach(id), bad = [...r.files.keys()].filter((f) => NEVER.some((n) => n.test(f)))
    check(`${g.entries.find((e) => e.id === id)!.label}: no plugin's backend, the server's core or a doc`, !bad.length, bad.map((f) => g.chainOf(r, f).join(" > ")))
  }
  const main = new Set([...g.reach("desktop").files.keys(), ...g.reach("helper").files.keys()])
  const outside = [...main].filter((f) => !f.startsWith("electron/"))
  console.log(`     the main process reaches ${main.size} files, ${outside.length} outside electron/ (their changes relaunch it)`)
})

// The helper reloads onto a new code root apart from the main process (electron/helperload.ts), as a module graph of its
// own: a module both import is then two copies, so it may keep no state; the main process's state comes through HelperHost.
await section("the menu-bar helper shares no state with the main process", () => {
  const own = graphOf(tree, { entries: [{ id: "helper", label: "helper.ts", from: ["electron/helper.ts"], mode: "node" }] }).reach("helper")
  const main = g.reach("desktop").files
  /** The main process's own state: windows, the browser, dictation's one recognizer, the servers, updates. */
  const STATEFUL = ["electron/main.ts", "electron/appwindow.ts", "electron/web.ts", "electron/browser/engine.ts", "electron/browser/index.ts", "electron/dictation.ts",
    "electron/dictationlist.ts", "electron/mics.ts", "electron/host.ts", "electron/updates.ts", "electron/storehost.ts", "electron/permissions.ts", "electron/gestures.ts",
    "electron/popup.ts", "electron/player.ts", "electron/apps.ts", "electron/helperload.ts"]
  /** Imported by both, and why a second copy is harmless. A new one is a decision: stateless, or through HelperHost. */
  const STATELESS: Record<string, string> = {
    "core/dictationtext.ts": "pure functions", "electron/miclogic.ts": "pure functions", "electron/presslog.ts": "a factory: each log its own",
    "electron/swiftbuild.ts": "a factory; builds are atomic renames", "electron/linehelper.ts": "a factory: each child its owner's",
    "electron/macaddons.ts": "loads an addon (Node-API: loading it again is allowed)", "electron/menu.ts": "the helper uses icon(), a cache of files' images",
    "electron/quiet.ts": "QUIET and quiet(); its count lives on globalThis", "electron/stack.ts": "pure functions",
  }
  const stateful = STATEFUL.filter((f) => own.files.has(f))
  check("it imports none of the main process's stateful modules", !stateful.length, stateful.map((f) => g.chainOf(own, f).join(" > ")))
  const shared = [...own.files.keys()].filter((f) => main.has(f) && /\.(ts|mjs|cjs|js)$/.test(f) && !f.startsWith("node_modules/"))
  const unsaid = shared.filter((f) => !STATELESS[f])
  check(`what it shares with the main process keeps no state (${shared.length} files)`, !unsaid.length, unsaid.map((f) => g.chainOf(own, f).join(" > ")))
  check("each listed as shared still is", Object.keys(STATELESS).every((f) => shared.includes(f)), Object.keys(STATELESS).filter((f) => !shared.includes(f)))
})

if (!module.registerHooks) skip("a real server boot loads nothing the graph misses", "this Node has no module.registerHooks")
else await section("a real server boot loads nothing the graph misses", async () => {
  const tmp = tempDir("vaultite-closure-test-"), loads = path.join(tmp, "loads"), vault = path.join(tmp, "vault")
  fs.mkdirSync(loads)
  makeSandbox(vault)
  const port = await freePort()
  const server = testServer({ env: { ...process.env, ...recording(loads), VAULTITE_VAULT: vault, VAULTITE_LOCAL: path.join(tmp, "local"), PORT: String(port), HOST: "127.0.0.1", VAULTITE_DESKTOP: "" }, stdio: "ignore" })
  try {
    let up = false
    for (let i = 0; i < 600 && !up; i++) {
      up = await fetch(`http://127.0.0.1:${port}/api/state`).then((r) => r.ok, () => false)
      if (!up) await sleep(100)
    }
    check("it starts", up)
    // (what pages and agents ask first: the ops' catalog, a file, the docs)
    for (const p of ["api/ops", "api/file?path=Home.md", "api/docs"]) await fetch(`http://127.0.0.1:${port}/${p}`).catch(() => null)
    await sleep(500)
  } finally { server.kill("SIGKILL"); stopTerminals(port) }
  const runs = recorded(loads, ROOT)
  if (process.env.KEEP) fs.cpSync(loads, process.env.KEEP, { recursive: true })
  const own = runs.find((r) => entriesOf(r, ROOT).includes("server"))
  check("its loads were recorded", (own?.files.length ?? 0) > 50, runs.map((r) => [r.what, r.script, r.files.length]))
  for (const r of runs) {
    const entries = entriesOf(r, ROOT)
    if (!entries.length) continue
    const missed = uncovered(g, r, entries)
    check(`${entries.join(", ")}: all ${r.files.length} files it loaded are in its reach`, !missed.length, missed)
  }
})

await exit(summary("closure", t0))
