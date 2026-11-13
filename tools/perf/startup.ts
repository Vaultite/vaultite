// What a launch loads before drawing, against startup.json: the desktop main process's imports, web/dist's eager files.
// node tools/perf/startup.ts [--ratchet] [--main]   (--ratchet: limits lowered to now plus headroom; --main: no build)
import "../test/isolate.ts" // (first: a run of its own, kept off the user's vaults)
import fs from "node:fs"
import path from "node:path"

const ROOT = path.join(import.meta.dirname, "..", "..")
const LIMITS = path.join(import.meta.dirname, "startup.json")
const HEADROOM = 1.1
const NEVER_IN_MAIN = ["core/vault.ts", "core/plugins.ts", "core/app.ts"]

function graph(entry: string) {
  const seen = new Map<string, number>()
  const walk = (file: string) => {
    if (seen.has(file) || !fs.existsSync(file)) return
    const text = fs.readFileSync(file, "utf8")
    seen.set(file, text.length)
    for (const m of text.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["'](\.[^"']+)["']|^(?:const [^=\n]+=\s*)?await import\(["'](\.[^"']+)["']\)/gm)) {
      walk(path.resolve(path.dirname(file), m[1] ?? m[2]))
    }
  }
  walk(entry)
  return seen
}

const main = new Map([...graph(path.join(ROOT, JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).main)), ...graph(path.join(ROOT, "electron", "boot.ts"))])
const kb = (n: number) => Math.round(n / 1024)
const now: Record<string, number> = { desktopMainKB: kb([...main.values()].reduce((a, b) => a + b, 0)) }
const DIST = path.join(ROOT, "web", "dist")
const eagerOf = (page: string) =>
  [...fs.readFileSync(path.join(DIST, page), "utf8").matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="\.?\/?(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1])
const sizeOf = (files: string[], ext: string) => kb(files.filter((f) => f.endsWith(ext)).reduce((n, f) => n + fs.statSync(path.join(DIST, f)).size, 0))
const web = !process.argv.includes("--main")
if (web && fs.existsSync(path.join(DIST, "index.html"))) {
  const eager = eagerOf("index.html")
  now.webEagerJsKB = sizeOf(eager, ".js")
  now.webEagerCssKB = sizeOf(eager, ".css")
  // (a browser asks 6 at a time over HTTP/1.1: a hundred small files cost a phone seconds; vite.config.ts bootChunks)
  now.webEagerFiles = eager.length
  now.phoneEagerJsKB = sizeOf(eagerOf("phone.html"), ".js")
} else if (web) console.log("startup: no web/dist (npm run build first): the web app's part skipped")

const limits: Record<string, number> = fs.existsSync(LIMITS) ? JSON.parse(fs.readFileSync(LIMITS, "utf8")) : {}
if (process.argv.includes("--ratchet")) {
  for (const [k, v] of Object.entries(now)) limits[k] = Math.min(limits[k] ?? Infinity, Math.ceil(v * HEADROOM))
  fs.writeFileSync(LIMITS, JSON.stringify(limits, null, 2) + "\n")
}
let failed = 0
const say = (ok: boolean, line: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${line}`); if (!ok) failed++ }
for (const f of NEVER_IN_MAIN) {
  const chain = main.has(path.join(ROOT, f))
  say(!chain, `the desktop app's main process doesn't load ${f} at launch${chain ? " (import it where it's needed, with import())" : ""}`)
}
if (web && fs.existsSync(path.join(DIST, "index.html"))) {
  const html = fs.readFileSync(path.join(DIST, "index.html"), "utf8"), eager = new Set(eagerOf("index.html"))
  const late = [...html.matchAll(/"\.\/assets\/(?:app|vendor)-[^"]+\.js":"\.\/(assets\/[^"]+)"/g)].flatMap((m) => (eager.has(m[1]) ? [] : [m[1]]))
  const zod = [...eager].filter((f) => f.endsWith(".js") && fs.readFileSync(path.join(DIST, f), "utf8").includes("ZodError"))
  say(!zod.length, `zod isn't in what the app loads before drawing${zod.length ? ` (${zod.join(", ")}: about 90 KB; parse in a file loaded later, or type the state through PluginState)` : ""}`)
  say(!late.length, `every app-/vendor- file is one index.html loads before drawing (vite.config.ts indexBoot leaves them out of preloads)${late.length ? `: not ${late.join(", ")}` : ""}`)
}
for (const [k, v] of Object.entries(now)) say(!(k in limits) || v <= limits[k], `${k}: ${v} (limit ${limits[k] ?? "none"})`)
process.exit(failed ? 1 : 0)
