// The plugin directory: one index.json (tools/plugin-index.ts builds it from the GitHub repos with the topic
// vaultite-plugin), read from plugins.json's `index` (else DEFAULT_INDEX), cached in .vaultite/cache/, and its blocklist.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { git, parseSource } from "./installs.ts"
import { type Disclosures, disclosuresOf, iconOf, REPO } from "./pluginmeta.ts"
import { compareVersions, parseVersion } from "./version.ts"
import { type Item, type Vault, writeAtomic } from "./vault.ts"
import { fetchPublic } from "./web.ts"

export const DEFAULT_INDEX = "https://raw.githubusercontent.com/Vaultite/plugins/main/directory/index.json"
/** An index in a GitHub repository, read with git (so a private one works where git is signed in): owner/name/path.json */
const IN_REPO = /^[\w.-]+\/[\w.-]+\/(?:[\w.-]+\/)*[\w.-]+\.json$/
const TTL = 3600_000, STALE = 86400_000
const CACHE = ".vaultite/cache/plugin-index.json"

export type Entry = {
  id: string; name: string; description: string; author: string; repo: string; dir: string | null; version: string; tag: string | null
  stars: number; released: string | null; created: string | null; pushed: string | null; issues: { open: number; closed: number }
  topics: string[]; disclosures: Disclosures; readme: string; score: number; fundingUrl?: string; replaces?: Record<string, string[]>
  /** Its manifest's icon (a name, or its SVG as a data address: core/pluginmeta.ts iconOf) and colour. */
  icon?: string; tint?: string
}
export type Index = { generated: string | null; plugins: Entry[]; blocked: Record<string, string[]> }
export type Got = { url: string; available: boolean; fetched: string | null; error?: string; index: Index }

const EMPTY: Index = { generated: null, plugins: [], blocked: {} }
const isObj = (v: unknown): v is Item => !!v && typeof v === "object" && !Array.isArray(v)
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : "")
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0)
const date = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null)

/** An index as it reads (leniently: entries without an id, a repo or a version are left out). */
export function readIndex(o: unknown): Index {
  if (!isObj(o)) return EMPTY
  const plugins: Entry[] = []
  for (const e of Array.isArray(o.plugins) ? o.plugins : []) {
    if (!isObj(e) || !/^[a-z][a-z0-9-]*$/.test(str(e.id)) || !REPO.test(str(e.repo)) || !parseVersion(e.version)) continue
    const issues = isObj(e.issues) ? e.issues : {}
    const dir = str(e.dir, 200)
    plugins.push({ id: str(e.id), name: str(e.name, 100) || str(e.id), description: str(e.description), author: str(e.author, 100), repo: str(e.repo),
      dir: /^[\w-][\w.-]*(\/[\w-][\w.-]*)*$/.test(dir) ? dir : null,
      version: str(e.version, 50), tag: str(e.tag, 100) || null, stars: num(e.stars), released: date(e.released), created: date(e.created), pushed: date(e.pushed),
      issues: { open: num(issues.open), closed: num(issues.closed) }, topics: Array.isArray(e.topics) ? e.topics.filter((t): t is string => typeof t === "string").slice(0, 20) : [],
      disclosures: disclosuresOf(e), readme: str(e.readme, 600), score: num(e.score), ...(str(e.fundingUrl).startsWith("https://") ? { fundingUrl: str(e.fundingUrl) } : {}),
      ...(iconOf(e.icon) ? { icon: iconOf(e.icon)! } : {}), ...(/^[a-z][a-z-]*$/.test(str(e.tint, 30)) ? { tint: str(e.tint) } : {}),
      ...(isObj(e.replaces) ? { replaces: Object.fromEntries(Object.entries(e.replaces).filter(([, v]) => Array.isArray(v))
        .map(([k, v]) => [k, (v as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 20)])) } : {}) })
  }
  const blocked: Record<string, string[]> = {}
  if (isObj(o.blocked)) for (const [k, v] of Object.entries(o.blocked)) if (Array.isArray(v)) blocked[k.toLowerCase()] = v.filter((x): x is string => typeof x === "string")
  return { generated: date(o.generated), plugins, blocked }
}

/** Whether version `v` is in a blocklist range: "1.2.3", "*", or comparisons, all of them ("<1.3.0", ">=1.0.0 <1.2.0"). */
export function versionMatches(v: string, range: string): boolean {
  const r = range.trim()
  if (r === "*") return true
  const parts = r.split(/\s+/)
  return parts.every((p) => {
    const m = /^(<=|>=|<|>|=)?v?(.+)$/.exec(p)
    const c = m && parseVersion(m[2]) ? compareVersions(v, m[2]) : null
    if (c === null) return false
    switch (m![1]) {
      case "<": return c < 0
      case "<=": return c <= 0
      case ">": return c > 0
      case ">=": return c >= 0
      default: return c === 0
    }
  })
}

/** Why the index blocks a plugin at a version: its repo ("owner/name") or, for a key with no slash, its id. */
export function blockedBy(index: Index, id: string, version: string | null, repos: (string | null | undefined)[]): string | null {
  const keys = [id.toLowerCase(), ...repos.filter((r): r is string => !!r).map((r) => r.toLowerCase())]
  for (const k of keys) {
    const ranges = index.blocked[k]
    if (!ranges) continue
    const hit = ranges.find((r) => r.trim() === "*" || (version !== null && versionMatches(version, r)))
    if (hit) return `the plugin directory blocks ${k}${hit.trim() === "*" ? "" : ` ${version}`} (a known problem with it): it doesn't load. Update or remove it.`
  }
  return null
}

/** A file of a GitHub repository at its default branch (owner/name/path), by a clone of only that commit's tree. */
async function fromRepo(spec: string) {
  const [owner, name, ...rest] = spec.split("/")
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-index-"))
  try {
    await git(["clone", "--quiet", "--depth", "1", "--filter=blob:none", "--no-checkout", "--single-branch", parseSource(`${owner}/${name}`).url!, tmp])
    return await git(["show", `HEAD:${rest.join("/")}`], tmp)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

export class PluginIndex {
  vault: Vault
  /** Bumped when what's known changes (/api/state follows it: a blocked plugin). */
  version = 0
  private got: Got | null = null
  private at = 0
  private pending: Promise<Got> | null = null
  private tried = "" // the address whose cache was looked for

  constructor(vault: Vault) {
    this.vault = vault
  }

  /** Where the index is: VAULTITE_PLUGIN_INDEX (this machine's: may be a file, for tests), else plugins.json's `index`
   *  (an http(s) address or a file in a GitHub repository, owner/name/index.json: a vault's setting never reads this
   *  machine's files), else the directory's. */
  url() {
    const env = process.env.VAULTITE_PLUGIN_INDEX
    if (env) return env
    const set = this.vault.config("plugins").index
    const v = typeof set === "string" ? set.trim() : ""
    return /^https?:\/\//i.test(v) || IN_REPO.test(v) ? v : DEFAULT_INDEX
  }

  private async fetch(url: string): Promise<unknown> {
    if (IN_REPO.test(url)) return JSON.parse(await fromRepo(url))
    const local = url.startsWith("file://") ? fileURLToPath(url) : path.isAbsolute(url) ? url : null
    if (local !== null) {
      if (url !== process.env.VAULTITE_PLUGIN_INDEX) throw new Error("an index on this machine is only read from VAULTITE_PLUGIN_INDEX")
      return JSON.parse(fs.readFileSync(local, "utf8"))
    }
    const r = await fetchPublic(url, { timeout: 10_000, max: 8 << 20, types: /json|text/, headers: { Accept: "application/json" } })
    if (r.status !== 200) throw new Error(`${url} answered ${r.status}`)
    return JSON.parse(r.body.toString("utf8"))
  }

  /** What's known without asking: in memory, else the vault's cache (of the same address). */
  known(): Got | null {
    if (this.got || this.tried === this.url()) return this.got
    this.tried = this.url()
    try {
      const c = JSON.parse(fs.readFileSync(this.vault.abs(CACHE), "utf8"))
      if (isObj(c) && c.url === this.url()) this.got = { url: c.url, available: true, fetched: str(c.fetched) || null, index: readIndex(c.index) }
    } catch { /* none */ }
    return this.got
  }

  /** The index: fetched at most once an hour (`refresh`: now), cached in the vault; when it can't be fetched, the last
   *  one cached, else an empty one that says so. Never throws. */
  async get(refresh = false): Promise<Got> {
    const url = this.url()
    if (!refresh && this.got?.url === url && Date.now() - this.at < TTL) return this.got
    this.pending ??= this.fetch(url).then((o) => {
      const index = readIndex(o)
      const got: Got = { url, available: true, fetched: new Date().toISOString(), index }
      try { writeAtomic(this.vault.abs(CACHE), JSON.stringify({ url, fetched: got.fetched, index })) } catch { /* a cache */ }
      return got
    }, (e) => {
      const last = this.known()
      const error = String((e as Error)?.message ?? e)
      return last?.url === url ? { ...last, error } : { url, available: false, fetched: null, error, index: EMPTY }
    }).then((got) => {
      if (JSON.stringify(got.index.blocked) !== JSON.stringify(this.got?.index.blocked ?? {})) this.version++
      this.got = got
      this.at = Date.now()
      return got
    }).finally(() => { this.pending = null })
    return await this.pending
  }

  /** Fetch it again when what's cached is a day old (only asked for when plugins were installed from it). */
  refreshIfStale() {
    const k = this.known()
    if (!k?.fetched || Date.now() - Date.parse(k.fetched) > STALE) void this.get(true)
  }

  /** Why the index blocks this plugin's version (what's known: never fetched here), or null. */
  blockedWhy(id: string, version: string | null, repos: (string | null | undefined)[]) {
    const k = this.known()
    return k ? blockedBy(k.index, id, version, repos) : null
  }
}
