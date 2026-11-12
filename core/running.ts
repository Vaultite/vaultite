// What this server runs: the commit it started on, or the web build's when that changes nothing of the server's (a
// web-only update), and whether a commit is in what each part runs. vau version, Machines and About read it.
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import type { Process } from "./contracts/version.ts"
import { gitEnv } from "./gitenv.ts"
import { backendChanged } from "./selfupdate.ts"
import type { Graph, ParseCache } from "./update/closure.ts"
import { graphModule } from "./update/graph.ts"
import { ENTRIES } from "./update/sites.ts"
import { served, type WebBuild } from "./webbuild.ts"

const exec = promisify(execFile)

export type Running = {
  /** The commit it runs (null: unknown, not a checkout nor a packaged app), its subject and when it was made (ms). */
  commit: string | null
  subject?: string
  at?: number
  branch: string | null
  /** The commit the server started on (its own code's). */
  startedOn: string | null
  /** The web app's build served: its entry script and its commit (null: not stamped, or none built). */
  web: { entry: string | null; commit: string | null }
}


/** Whether a part (a process, or the web app) runs a commit: `it`, the commit or one after it; `untouched`, older code
 *  the commit's own change doesn't reach; `older`, code it does (`file`, the nearest); `unknown`, can't say (`why`). */
export type PartRuns = { id: string; label: string; commit: string | null; runs: "it" | "untouched" | "older" | "unknown"; file?: string; why?: string }

/** `root`'s: a checkout, or a packaged app's (its electron/build.json); `web`, the build it serves. */
export function runningIn(root: string, web: () => WebBuild) {
  /** git's output, or null when it failed (not a checkout, an unknown commit). */
  const git = (...args: string[]) => exec("git", ["-C", root, ...args], { timeout: 5000, env: gitEnv() }).then((r) => r.stdout.trim(), () => null)
  const label = (id: string) => ENTRIES.find((e) => e.id === id)?.label ?? id
  const start = (async () => {
    const commit = await git("rev-parse", "HEAD")
    if (commit) {
      const [at, ...subject] = (await git("log", "-1", "--format=%ct%n%s", commit) ?? "").split("\n")
      return { commit, branch: await git("symbolic-ref", "--short", "-q", "HEAD") || null, at: Number(at) * 1000 || undefined, subject: subject.join(" ") || undefined }
    }
    try { return { commit: String(JSON.parse(fs.readFileSync(path.join(root, "electron", "build.json"), "utf8")).commit ?? "") || null, branch: null } }
    catch { return { commit: null, branch: null } }
  })()
  let parses: ParseCache | undefined
  /** The module graph of this checkout's files now, or why there's none. */
  const graphNow = async (): Promise<{ graph: Graph } | { why: string }> => {
    const mod = graphModule() // (a parser: the host's, loaded only when asked)
    if (!mod) return { why: "this server has no module graph (its host gives none)" }
    try {
      const { diskTree, graphOf } = await mod
      return { graph: graphOf(diskTree(root), { cache: parses ??= new Map() }) }
    } catch (e) { return { why: `the module graph failed: ${(e as Error).message}` } }
  }
  const same = new Map<string, Promise<boolean>>()
  /** Nothing the server runs differs between the two (the graph's answer, as the updates' plan; without one, the
   *  folder rule's): false when git can't say. */
  const sameServer = (a: string, b: string) => {
    let p = same.get(`${a}..${b}`)
    if (!p) same.set(`${a}..${b}`, p = git("diff", "--name-only", "--no-renames", a, b).then(async (out) => {
      if (out === null) return false
      const files = out.split("\n").filter(Boolean), g = await graphNow()
      return "graph" in g ? !g.graph.hit("server", files) : !backendChanged(files)
    }))
    return p
  }

  async function running(): Promise<Running> {
    const s = await start, b = web(), w = b.stamp
    const base: Running = { commit: s.commit, ...(s.subject ? { subject: s.subject } : {}), ...(s.at ? { at: s.at } : {}), branch: s.branch,
      startedOn: s.commit, web: { entry: b.entry, commit: w?.commit ?? null } }
    if (w && s.commit && w.commit !== s.commit && await sameServer(s.commit, w.commit)) return { ...base, commit: w.commit, subject: w.subject, at: w.at }
    return base
  }

  /** A hash (full or short) in full, or null when this checkout doesn't have it (yet). Never a name: see isHash. */
  const resolve = async (given: string) => {
    if (!isHash(given)) return null
    const full = await git("rev-parse", "--verify", "--quiet", `${given.toLowerCase()}^{commit}`)
    return full?.startsWith(given.toLowerCase()) ? full : null // (a branch named like a hash is still a name)
  }
  /** Whether a short hash names more than one commit here. */
  const ambiguous = async (given: string) => {
    if (!isHash(given) || given.length === 40) return false
    const all = (await git("rev-parse", `--disambiguate=${given.toLowerCase()}`) ?? "").split("\n").filter(Boolean)
    if (all.length < 2) return false
    return (await Promise.all(all.map((sha) => git("cat-file", "-t", sha)))).filter((t) => t === "commit").length > 1
  }
  /** Whether `commit` is `of` or comes before it (null: git can't say: not a checkout). */
  const contains = async (of: string, commit: string) => {
    if (/^[0-9a-f]{7,}$/.test(commit) && of.startsWith(commit)) return true
    if (!(await git("rev-parse", "--git-dir"))) return null
    return exec("git", ["-C", root, "merge-base", "--is-ancestor", commit, of], { timeout: 5000, env: gitEnv() }).then(() => true, () => false)
  }
  /** Whether `commit` is on `ref` (origin/main): null when either isn't known here. */
  const onRef = async (commit: string, ref: string) => (await git("rev-parse", "--verify", "--quiet", ref)) ? contains(ref, commit) : null

  /** Each process against this checkout's files now (uncommitted changes too): what changed since its commit that it
   *  reaches. The graph is the checkout's as it is now. */
  const processes = async (list: { id: string; commit: string | null }[]): Promise<Process[]> => {
    const none = (why: string) => list.map((p) => ({ ...p, label: label(p.id), stale: null, why }))
    if (!(await git("rev-parse", "--git-dir"))) return none("not a checkout: nothing to compare with")
    const g = await graphNow()
    if (!("graph" in g)) return none(g.why)
    const { graph } = g
    return Promise.all(list.map(async (p): Promise<Process> => {
      const base = { ...p, label: label(p.id) }
      if (!p.commit) return { ...base, stale: null, why: "it didn't say what commit it runs" }
      const out = await git("diff", "--name-only", "--no-renames", p.commit)
      if (out === null) return { ...base, stale: null, why: `this checkout doesn't have ${p.commit.slice(0, 7)}` }
      const hit = graph.hit(p.id, out.split("\n").filter(Boolean))
      if (!hit) return { ...base, stale: false }
      return { ...base, stale: true, first: hit.file, chain: hit.chain,
        ...(hit.unknown ? { why: `the graph can't follow ${hit.unknown.file}:${hit.unknown.line} (${hit.unknown.text}), so counts it changed` } : {}) }
    }))
  }

  /** Whether each part runs `commit` (in full) or code equal to it in what that part runs: the commit's own change (from
   *  its first parent) reaching none of its files (closure.ts). A commit with nothing in a part needs nothing of it. */
  const runsOf = async (commit: string, list: { id: string; commit: string | null }[]): Promise<PartRuns[]> => {
    let own: Promise<string[] | null> | undefined, graph: Promise<{ graph: Graph } | { why: string }> | undefined
    return Promise.all(list.map(async (p): Promise<PartRuns> => {
      const base = { ...p, label: label(p.id) }
      if (p.commit && await contains(p.commit, commit)) return { ...base, runs: "it" }
      const files = await (own ??= git("diff", "--name-only", "--no-renames", `${commit}^`, commit).then((out) => out === null ? null : out.split("\n").filter(Boolean)))
      if (!files) return { ...base, runs: "unknown", why: `what ${commit.slice(0, 7)} changed isn't known here` }
      const g = await (graph ??= graphNow())
      if (!("graph" in g)) return { ...base, runs: "unknown", why: g.why }
      const hit = g.graph.hit(p.id, files)
      if (!hit) return { ...base, runs: "untouched" }
      if (hit.unknown) return { ...base, runs: "unknown", why: `the graph can't follow ${hit.unknown.file}:${hit.unknown.line} (${hit.unknown.text})` }
      return { ...base, runs: p.commit ? "older" : "unknown", file: hit.file, ...(p.commit ? {} : { why: "it didn't say what commit it runs" }) }
    }))
  }
  return { running, resolve, ambiguous, contains, onRef, processes, runsOf }
}

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const here = runningIn(ROOT, served.read)
/** What this server runs now. */
export const running = here.running
export const { resolve: resolveCommit, ambiguous: ambiguousCommit, contains, onRef, processes, runsOf } = here

/** A commit's hash, full or short: how a caller names one to a server. A name (HEAD, a branch, a tag, HEAD~1) is the
 *  caller's checkout's, and read in the server's would answer about another commit. */
export const isHash = (given: string) => /^[0-9a-f]{4,40}$/i.test(given)
