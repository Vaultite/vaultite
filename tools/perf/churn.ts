// What each deploy costs a phone holding the build before: main's last commits built in turn, the start's new files.
// node tools/perf/churn.ts [--commits 20] [--from origin/main] [--variant <file: (base) => config>]...
import "../test/isolate.ts" // (first: a run of its own, kept off the user's vaults)
import { execFileSync, spawnSync } from "node:child_process"
import { gitEnv } from "../../core/gitenv.ts"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"

const ROOT = path.join(import.meta.dirname, "..", "..")
const args = process.argv.slice(2)
const arg = (name: string, dflt: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt }
const N = Number(arg("commits", "20")), FROM = arg("from", "origin/main")
const variants = ["", ...args.flatMap((a, i) => (a === "--variant" ? [path.resolve(args[i + 1])] : []))]
const git = (...a: string[]) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", env: gitEnv() }).trim()

// Commits that changed what the web build is made from, oldest first (one more: the first's baseline)
const commits = git("log", "--format=%H", `-${N + 1}`, FROM, "--", "web", "plugins", "vite.config.ts", "package-lock.json").split("\n").reverse()
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-churn-"))
const brCache = new Map<string, number>()
const br = (file: string) => {
  const key = path.basename(file)
  if (!brCache.has(key)) brCache.set(key, zlib.brotliCompressSync(fs.readFileSync(file), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }).length)
  return brCache.get(key)!
}

/** The files a start fetches: index.html's scripts and styles, the editor, and what they import (statically). */
function startSet(dist: string) {
  const html = fs.readFileSync(path.join(dist, "index.html"), "utf8")
  const todo = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1])
  // the import map's targets are fetched when imported, so they're followed as imports are
  const map = /<script type="importmap"[^>]*>([\s\S]*?)<\/script>/.exec(html)
  const imports: Record<string, string> = map ? JSON.parse(map[1]).imports ?? {} : {}
  todo.push(...fs.readdirSync(path.join(dist, "assets")).filter((f) => /^editor-[\w-]+\.js$/.test(f) && fs.statSync(path.join(dist, "assets", f)).size > 100_000).map((f) => `assets/${f}`))
  const seen = new Set<string>()
  for (let f; (f = todo.pop());) {
    if (seen.has(f) || !fs.existsSync(path.join(dist, f))) continue
    seen.add(f)
    if (!f.endsWith(".js")) continue
    const code = fs.readFileSync(path.join(dist, f), "utf8")
    for (const m of code.matchAll(/(?:import|from)\s*["']([^"']+)["']/g)) {
      const spec = imports[m[1]] ?? m[1]
      if (spec.startsWith("./") || spec.startsWith("/") || spec.startsWith("assets/")) todo.push(path.posix.join("assets", path.posix.basename(spec)))
    }
  }
  return [...seen]
}

function build(commit: string, variant: string) {
  const dir = path.join(tmp, "src")
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir)
  execFileSync("sh", ["-c", `git -C "${ROOT}" archive ${commit} | tar -x -C "${dir}"`])
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"))
  const out = path.join(tmp, "out", `${commit.slice(0, 9)}-${variants.indexOf(variant)}`)
  let config = "vite.config.ts"
  if (variant) {
    fs.copyFileSync(variant, path.join(dir, "variant.ts"))
    fs.writeFileSync(path.join(dir, "vite.variant.config.ts"), `import base from "./vite.config.ts"\nimport variant from "./variant.ts"\nexport default variant(base)\n`)
    config = "vite.variant.config.ts"
  }
  const r = spawnSync(process.execPath, [path.join(dir, "node_modules/vite/bin/vite.js"), "build", "-c", config, "--outDir", out, "--emptyOutDir"], { cwd: dir, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`build of ${commit.slice(0, 9)} failed:\n${(r.stderr || r.stdout).slice(-2000)}`)
  return out
}

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`
try {
  for (const variant of variants) {
    let prev: Set<string> | null = null
    const costs: number[] = [], files: number[] = []
    let total = 0, count = 0
    for (const c of commits) {
      const dist = build(c, variant)
      const set = startSet(dist)
      const bytes = (fs_: string[]) => fs_.reduce((n, f) => n + br(path.join(dist, f)), 0)
      total = bytes(set); count = set.length
      if (prev) {
        const fresh = set.filter((f) => !prev!.has(f))
        costs.push(bytes(fresh)); files.push(fresh.length)
        console.log(`  ${c.slice(0, 9)} ${git("log", "-1", "--format=%s", c).slice(0, 60).padEnd(60)} ${kb(bytes(fresh)).padStart(8)} in ${fresh.length} files`)
      }
      prev = new Set(set)
      fs.rmSync(path.join(tmp, "out"), { recursive: true, force: true })
    }
    const sorted = [...costs].sort((a, b) => a - b)
    console.log(`${variant ? path.basename(variant) : "as built"}: start set ${kb(total)} in ${count} files; per deploy: median ${kb(sorted[sorted.length >> 1])}, ` +
      `mean ${kb(costs.reduce((a, b) => a + b, 0) / costs.length)}, ${(files.reduce((a, b) => a + b, 0) / files.length).toFixed(1)} files`)
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
