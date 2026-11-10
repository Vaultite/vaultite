// Which processes a change reaches, and why (core/update/closure.ts), each commit in its own tree. node tools/closure.ts
// [<commit> | <a>..<b>] (none: uncommitted changes) [--entry <id>: its reach] | --since <date> [--today]: a history.
import { execFileSync, spawnSync } from "node:child_process"
import path from "node:path"
import { gitEnv } from "../core/gitenv.ts"
import { backendChanged } from "../core/selfupdate.ts"
import { diskTree, type Graph, graphOf, type ParseCache, type Tree } from "../core/update/closure.ts"
import { ENTRIES } from "../core/update/sites.ts"

const ROOT = path.resolve(import.meta.dirname, "..")
const git = (...a: string[]) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 << 20, env: gitEnv() }).trim()
const lines = (s: string) => s.split("\n").filter(Boolean)

/** A commit's tree, its text files read from git (all at once, a blob read once for every commit). */
const blobs = new Map<string, string>()
function treeAt(commit: string): Tree {
  const byPath = new Map<string, string>()
  for (const l of git("ls-tree", "-r", "-z", commit).split("\0").filter(Boolean)) {
    const [meta, file] = l.split("\t"), sha = meta.split(" ")[2]
    if (meta.split(" ")[1] === "blob") byPath.set(file, sha)
  }
  const want = [...byPath].filter(([f, sha]) => /\.(ts|tsx|mts|js|jsx|mjs|cjs|json|html|css)$|^bin\//.test(f) && !blobs.has(sha)).map(([, sha]) => sha)
  if (want.length) {
    const out = spawnSync("git", ["cat-file", "--batch"], { cwd: ROOT, input: want.join("\n") + "\n", maxBuffer: 1 << 30, env: gitEnv() }).stdout
    for (let at = 0; at < out.length;) {
      const nl = out.indexOf(10, at), [sha, , size] = out.subarray(at, nl).toString().split(" ")
      blobs.set(sha, out.subarray(nl + 1, nl + 1 + Number(size)).toString("utf8"))
      at = nl + 1 + Number(size) + 1
    }
  }
  return { files: [...byPath.keys()].sort(), read: (f) => { const sha = byPath.get(f); return sha ? blobs.get(sha) ?? null : null } }
}

const cache: ParseCache = new Map()
const say = (g: Graph, files: string[], also?: Graph) => {
  console.log(`${files.length} files changed`)
  for (const e of ENTRIES) {
    const hit = g.hit(e.id, files) ?? also?.hit(e.id, files)
    console.log(`  ${hit ? "reaches" : "-      "} ${e.label}${hit ? `: ${hit.unknown ? `unknown (${hit.unknown.file}:${hit.unknown.line} ${hit.unknown.text})` : hit.chain.join(" > ")}` : ""}`)
  }
  console.log(`  (backendChanged, today's rule: ${backendChanged(files) ? "restart" : "no restart"})`)
}

const argv = process.argv.slice(2)
const flag = (n: string) => { const i = argv.indexOf(n); return i < 0 ? null : argv[i + 1] ?? "" }
const entry = flag("--entry"), since = flag("--since")
const target = argv.find((a, i) => !a.startsWith("--") && !["--entry", "--since"].includes(argv[i - 1]))

if (entry) {
  const g = graphOf(target ? treeAt(target) : diskTree(ROOT), { cache }), r = g.reach(entry)
  for (const [f, by] of r.files) console.log(`${f}${by ? `  < ${by}` : ""}`)
  console.log(`${r.files.size} files${r.unknown.length ? `; unknown: ${r.unknown.map((l) => `${l.file}:${l.line} ${l.text}`).join("; ")}` : ""}`)
} else if (since) {
  const commits = lines(git("log", "--first-parent", "--no-merges", "--reverse", `--since=${since}`, "--format=%H"))
  const today = argv.includes("--today") ? graphOf(diskTree(ROOT), { cache }) : null
  const shares = { main: 0, helperOnly: 0, serverNotMain: 0, webOnly: 0, otherOnly: 0, nothing: 0 }
  const per = Object.fromEntries(ENTRIES.map((e) => [e.id, 0]))
  const disagree = { graphRestarts: [] as string[], ruleRestarts: [] as string[] }
  const outside = new Map<string, { commits: number; chain: string[] }>(), unknown: string[] = []
  let prev: Graph | null = null
  const t0 = Date.now()
  for (const c of commits) {
    const files = lines(git("diff-tree", "--no-commit-id", "--name-only", "-r", "--no-renames", `${c}^`, c))
    // (what runs is the parent's code: its reach counts, and the commit's, which the process would load next)
    const before = today ?? prev ?? graphOf(treeAt(`${c}^`), { cache }), g = today ?? graphOf(treeAt(c), { cache })
    prev = g
    // (an older tree has loose ends today's sites.ts doesn't know: counted below, and its imports read as they are)
    const lenient = (gr: Graph, id: string) => {
      const r = gr.reach(id), best = files.filter((f) => r.files.has(f)).map((f) => gr.chainOf(r, f)).sort((a, b) => a.length - b.length)[0]
      return best ? { file: best[best.length - 1], chain: best } : null
    }
    const hit = (id: string) => lenient(g, id) ?? lenient(before, id)
    const hits = new Set(ENTRIES.map((e) => e.id).filter((id) => hit(id)))
    const unsure = ENTRIES.filter((e) => g.reach(e.id).unknown.length)
    if (unsure.length) unknown.push(`${git("log", "-1", "--format=%h", c)} ${unsure.map((e) => `${e.id}: ${g.reach(e.id).unknown.slice(0, 2).map((l) => `${l.file}:${l.line} ${l.text}`).join(", ")}`).join("; ")}`)
    for (const id of hits) per[id]++
    if (hits.has("desktop") || hits.has("helper")) { shares.main++; if (!hits.has("desktop")) shares.helperOnly++ }
    else if (hits.has("server")) shares.serverNotMain++
    else if (hits.has("web") && hits.size === 1) shares.webOnly++
    else if (hits.size) shares.otherOnly++
    else shares.nothing++
    const rule = backendChanged(files), graph = hits.has("server"), subject = git("log", "-1", "--format=%h %s", c)
    if (graph && !rule) disagree.graphRestarts.push(`${subject}  [${hit("server")!.chain.join(" > ")}]`)
    if (rule && !graph) disagree.ruleRestarts.push(`${subject}  [${files.filter((f) => backendChanged([f])).slice(0, 4).join(", ")}]`)
    const main = [...g.reach("desktop").files.keys(), ...g.reach("helper").files.keys()]
    for (const f of files) if (!f.startsWith("electron/") && main.includes(f)) {
      const o = outside.get(f) ?? { commits: 0, chain: [] }
      o.chain = (g.reach("desktop").files.has(f) ? g.chainOf(g.reach("desktop"), f) : g.chainOf(g.reach("helper"), f)) // (the newest tree's)
      o.commits++
      outside.set(f, o)
    }
  }
  const n = commits.length, pct = (x: number) => `${x} (${Math.round((100 * x) / n)}%)`
  console.log(`${n} commits since ${since}, ${today ? "on today's graph" : "each in its own tree"} (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
  console.log(`  reach the main process: ${pct(shares.main)}, of which its menu-bar helper only: ${shares.helperOnly}`)
  console.log(`  the server, not the main process: ${pct(shares.serverNotMain)}`)
  console.log(`  the web app only: ${pct(shares.webOnly)}`)
  console.log(`  vau or a keeper only (or with the web app): ${pct(shares.otherOnly)}`)
  console.log(`  nothing that runs: ${pct(shares.nothing)}`)
  console.log(`  each entry: ${ENTRIES.map((e) => `${e.id} ${per[e.id]}`).join(", ")}`)
  console.log(`  trees with loose ends today's sites.ts doesn't declare (their imports read as they are): ${unknown.length}`)
  for (const u of unknown.slice(0, 10)) console.log(`    ${u}`)
  console.log(`\nbackendChanged and the graph (server): agree on ${n - disagree.graphRestarts.length - disagree.ruleRestarts.length}`)
  console.log(`  the graph restarts, the rule doesn't: ${disagree.graphRestarts.length}`)
  for (const d of disagree.graphRestarts) console.log(`    ${d}`)
  console.log(`  the rule restarts, the graph doesn't: ${disagree.ruleRestarts.length}`)
  for (const d of disagree.ruleRestarts.slice(0, 15)) console.log(`    ${d}`)
  console.log("\nfiles outside electron/ most often reaching the main process (commits touching them):")
  for (const [f, o] of [...outside].sort((a, b) => b[1].commits - a[1].commits).slice(0, 25)) console.log(`  ${String(o.commits).padStart(3)}  ${f}  [${o.chain.join(" > ")}]`)
} else if (target?.includes("..")) {
  const [a, b] = target.split("..")
  say(graphOf(treeAt(b || "HEAD"), { cache }), lines(git("diff", "--name-only", "--no-renames", a, b || "HEAD")), graphOf(treeAt(a), { cache }))
} else if (target) {
  say(graphOf(treeAt(target), { cache }), lines(git("diff-tree", "--no-commit-id", "--name-only", "-r", "--no-renames", `${target}^`, target)), graphOf(treeAt(`${target}^`), { cache }))
} else {
  say(graphOf(diskTree(ROOT), { cache }), [...new Set([...lines(git("diff", "--name-only", "--no-renames", "HEAD")), ...lines(git("ls-files", "--others", "--exclude-standard"))])], graphOf(treeAt("HEAD"), { cache }))
}
