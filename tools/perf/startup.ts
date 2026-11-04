// What a launch loads before drawing, against startup.json: the desktop main process's imports, web/dist's eager files.
// node tools/perf/startup.ts [--ratchet]   (--ratchet: limits lowered to now plus headroom)
import fs from "node:fs"
import path from "node:path"

const ROOT = path.join(import.meta.dirname, "..", "..")
const LIMITS = path.join(import.meta.dirname, "startup.json")
/** Room over the last ratchet, so an ordinary change fits and a heavy import doesn't. */
const HEADROOM = 1.1
/** The server's code: the main process reaching it loads the whole vault's machinery at every launch. */
const NEVER_IN_MAIN = ["core/vault.ts", "core/plugins.ts", "core/app.ts"]

/** Every file the entry's imports reach as it starts (static ones, not `import type`; a top-level `await import()`, which
 *  is unindented), and their bytes. */
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

const main = graph(path.join(ROOT, JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).main))
const kb = (n: number) => Math.round(n / 1024)
const now: Record<string, number> = { desktopMainKB: kb([...main.values()].reduce((a, b) => a + b, 0)) }
const html = path.join(ROOT, "web", "dist", "index.html")
if (fs.existsSync(html)) {
  const eager = [...fs.readFileSync(html, "utf8").matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="\.?\/?(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1])
  const size = (ext: string) => kb(eager.filter((f) => f.endsWith(ext)).reduce((n, f) => n + fs.statSync(path.join(ROOT, "web", "dist", f)).size, 0))
  now.webEagerJsKB = size(".js")
  now.webEagerCssKB = size(".css")
  // (a browser asks 6 at a time over HTTP/1.1: a hundred small files cost a phone seconds; vite.config.ts bootChunks)
  now.webEagerFiles = eager.length
} else console.log("startup: no web/dist (npm run build first): the web app's part skipped")

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
for (const [k, v] of Object.entries(now)) say(!(k in limits) || v <= limits[k], `${k}: ${v} (limit ${limits[k] ?? "none"})`)
process.exit(failed ? 1 : 0)
