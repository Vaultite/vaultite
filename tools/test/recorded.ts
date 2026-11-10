// What processes recorded with tools/test/loads.ts loaded, against the module graph (core/update/closure.ts): every file
// of the app's a process loaded is in its entry's reach. tools/test_closure.ts (a server) and web/qa/closure.mjs (the app).
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { Graph } from "../../core/update/closure.ts"

/** The recorder (tools/test/loads.ts), for Electron's -r. */
export const LOADS = path.join(import.meta.dirname, "loads.ts")
/** The env that records a process's loads (and its children's) into `dir`. */
export const recording = (dir: string) => ({ NODE_OPTIONS: `--import=${pathToFileURL(LOADS).href}`, VAULTITE_LOADS: dir })

export type Recorded = { pid: string; what: string; script: string; files: string[]; packages: boolean }
/** Each process's loads: the app's files (as the repo names them), and whether it loaded any package. */
export function recorded(dir: string, root: string): Recorded[] {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).map((f) => {
    const [head, ...urls] = fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean)
    const [, what = "", script = ""] = /^# (\S+) ?(.*)$/.exec(head) ?? []
    const files = new Set<string>()
    let packages = false
    for (const u of urls) {
      if (!u.startsWith("file:")) continue
      const rel = path.relative(root, fileURLToPath(u.replace(/[?#].*$/, ""))).split(path.sep).join("/")
      if (rel.startsWith("..") || path.isAbsolute(rel)) continue
      if (rel.includes("node_modules/")) packages = true
      else if (rel !== "tools/test/loads.ts") files.add(rel)
    }
    return { pid: f.slice(0, -4), what, script, files: [...files].sort(), packages }
  })
}

/** Which entries a recorded process is: Electron's main process is the app's (and its helper slice), a script its own. */
export function entriesOf(r: Recorded, root: string): string[] {
  if (r.what === "browser") return ["desktop", "helper"]
  const rel = path.relative(root, r.script).split(path.sep).join("/")
  return { "server.ts": ["server"], "bin/vau": ["cli"], "plugins/core/terminal/termd/termd.ts": ["termd"], "plugins/core/claude-code/chatd.ts": ["chatd"] }[rel] ?? []
}

/** What `r` loaded that the graph says its entries don't reach (empty: static covers it). */
export function uncovered(g: Graph, r: Recorded, entries: string[]) {
  const reach = entries.map((e) => g.reach(e).files)
  const out = r.files.filter((f) => !reach.some((m) => m.has(f)))
  if (r.packages && !reach.some((m) => m.has("package-lock.json"))) out.push("(a package: package-lock.json isn't reached)")
  return out
}
