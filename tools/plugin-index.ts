// The plugin directory's index.json (core/pluginindex.ts), built daily in the Vaultite/plugins repository: repos with the
// topic vaultite-plugin plus listed.json's, at their latest release (several in one: each folder's newest <folder>/v1.2.0).
// node tools/plugin-index.ts [--listed l.json] [--blocked b.json] [--out index.json]; GITHUB_TOKEN
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { disclosuresOf, ICON_FILE, ICON_MAX, iconOf, REPO, svgIcon } from "../core/pluginmeta.ts"
import { compareVersions, tagVersion } from "../core/version.ts"

/** One GET: its status and body (JSON when it parses). */
export type Get = (url: string, accept?: string) => Promise<{ status: number; body: unknown }>
type Repo = { full_name: string; stargazers_count?: number; created_at?: string; pushed_at?: string; topics?: string[]; archived?: boolean; disabled?: boolean
  owner?: { login?: string }; description?: string | null }
type Any = Record<string, unknown>

const API = "https://api.github.com", RAW = "https://raw.githubusercontent.com"
const STABLE = /^v?\d+\.\d+\.\d+$/
const DAY = 86400_000

/** A README's first paragraph of prose (no headings, badges, images or HTML), at most 280 characters. */
export function excerpt(md: string) {
  const text = md.replace(/<!--[\s\S]*?-->/g, "").replace(/```[\s\S]*?```/g, "")
  for (const para of text.split(/\n\s*\n/)) {
    const p = para.split("\n").filter((l) => !/^\s*(#|!\[|\[!\[|<|>|\||[-*_]{3,}\s*$)/.test(l)).join(" ").trim()
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim()
    if (p.length >= 20) return p.length > 280 ? `${p.slice(0, 277).replace(/\s+\S*$/, "")}...` : p
  }
  return ""
}

/** Stars blended with upkeep, 0 to 100: stars (log, 1000 is full) half, how recently it released or was pushed (full
 *  within a month, none after a year) 30%, the share of its issues closed (none yet counts half) 20%. */
export function scoreOf(stars: number, last: string | null, open: number, closed: number, now: number) {
  const age = last ? (now - Date.parse(last)) / DAY : Infinity
  const recency = age <= 30 ? 1 : age >= 365 ? 0 : 1 - (age - 30) / 335
  const closing = open + closed ? closed / (open + closed) : 0.5
  return Math.round(100 * (0.5 * Math.min(1, Math.log10(1 + stars) / 3) + 0.3 * recency + 0.2 * closing))
}

/** The index: `listed` adds repositories ("owner/name") the topic search misses; `blocked` is the blocklist as it goes
 *  out ({"owner/name" or id: [versions or ranges]}). `skipped` says which repositories were left out, and why. */
export async function buildIndex({ get, listed = [], blocked = {}, now = Date.now() }: { get: Get; listed?: string[]; blocked?: Record<string, string[]>; now?: number }) {
  const repos = new Map<string, Repo>()
  for (let page = 1; page <= 10; page++) {
    const r = await get(`${API}/search/repositories?q=${encodeURIComponent("topic:vaultite-plugin")}&sort=stars&per_page=100&page=${page}`)
    const items = r.status === 200 ? ((r.body as Any).items as Repo[] ?? []) : []
    for (const it of items) repos.set(it.full_name.toLowerCase(), it)
    if (items.length < 100) break
  }
  const skipped: string[] = []
  for (const full of listed) {
    if (!REPO.test(full) || repos.has(full.toLowerCase())) continue
    const r = await get(`${API}/repos/${full}`)
    if (r.status === 200) repos.set(full.toLowerCase(), r.body as Repo); else skipped.push(`${full}: not found (${r.status})`)
  }
  const plugins: Any[] = []
  for (const repo of repos.values()) {
    const full = repo.full_name
    if (repo.archived || repo.disabled) { skipped.push(`${full}: archived`); continue }
    type Tag = { name: string; commit?: { sha?: string } }
    const tags = await get(`${API}/repos/${full}/tags?per_page=100`)
    const all = tags.status === 200 && Array.isArray(tags.body) ? tags.body as Tag[] : []
    const dateOf = async (t: Tag) => {
      const c = t.commit?.sha ? await get(`${API}/repos/${full}/commits/${t.commit.sha}`) : null
      return c?.status === 200 ? (((c.body as Any).commit as Any)?.committer as Any)?.date as string ?? null : null
    }
    // Its plugins: one at its top at the latest release, else the newest version tag; or one per folder, each at its
    // newest <folder>/v1.2.0 tag (a repository of several).
    const newest = new Map<string, Tag>()
    for (const t of all) {
      const i = t.name.lastIndexOf("/"), dir = t.name.slice(0, i)
      if (i > 0 && STABLE.test(t.name.slice(i + 1)) && (!newest.has(dir) || compareVersions(tagVersion(t.name), tagVersion(newest.get(dir)!.name))! > 0)) newest.set(dir, t)
    }
    const units: { dir: string | null; tag: string; ref: string; released: string | null }[] = []
    for (const [dir, t] of newest) units.push({ dir, tag: t.name, ref: t.commit?.sha ?? `refs/tags/${t.name}`, released: await dateOf(t) })
    if (!units.length) {
      const rel = await get(`${API}/repos/${full}/releases/latest`)
      if (rel.status === 200 && typeof (rel.body as Any).tag_name === "string" && STABLE.test((rel.body as Any).tag_name as string)) {
        const tag = (rel.body as Any).tag_name as string
        units.push({ dir: null, tag, ref: tag, released: ((rel.body as Any).published_at as string) ?? null })
      } else {
        const top = all.filter((t) => STABLE.test(t.name)).sort((a, b) => compareVersions(b.name, a.name)!)[0]
        if (top) units.push({ dir: null, tag: top.name, ref: top.name, released: await dateOf(top) })
      }
    }
    if (!units.length) { skipped.push(`${full}: no version tag (v1.0.0, or <folder>/v1.0.0 for several plugins) or release`); continue }
    const count = async (state: string) => {
      const r = await get(`${API}/search/issues?q=${encodeURIComponent(`repo:${full} type:issue state:${state}`)}&per_page=1`)
      return r.status === 200 && typeof (r.body as Any).total_count === "number" ? (r.body as Any).total_count as number : 0
    }
    const open = await count("open"), closed = await count("closed")
    for (const { dir, tag, ref, released } of units) {
      const where = dir ? `${full}/${dir}` : full
      // (a folder gone from the default branch, removed or renamed, keeps its old tags but isn't listed)
      if (dir && (await get(`${RAW}/${full}/HEAD/${dir}/manifest.json`)).status !== 200) { skipped.push(`${where}: no longer in the repository`); continue }
      const mf = await get(`${RAW}/${full}/${ref}/${dir ? `${dir}/` : ""}manifest.json`)
      const m = (mf.status === 200 && mf.body && typeof mf.body === "object" ? mf.body : null) as Any | null
      if (!m) { skipped.push(`${where}: no manifest.json at ${tag}`); continue }
      if (typeof m.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(m.id)) { skipped.push(`${where}: its manifest's id isn't one`); continue }
      if (m.version !== tagVersion(tag)) { skipped.push(`${where}: its manifest's version (${String(m.version)}) isn't its tag's (${tag})`); continue }
      const readme = dir ? await get(`${RAW}/${full}/${ref}/${dir}/README.md`, "application/vnd.github.raw") : await get(`${API}/repos/${full}/readme`, "application/vnd.github.raw")
      // Its icon by name as it is; its SVG file inline, so the directory draws it before it's installed.
      let icon = iconOf(m.icon)
      if (typeof m.icon === "string" && ICON_FILE.test(m.icon)) {
        const svg = await get(`${RAW}/${full}/${ref}/${dir ? `${dir}/` : ""}${m.icon}`, "application/vnd.github.raw")
        icon = svg.status === 200 && typeof svg.body === "string" && svg.body.length <= ICON_MAX ? svgIcon(svg.body) : null
        if (!icon) skipped.push(`${where}: its icon ${m.icon} isn't an SVG of at most ${ICON_MAX / 1000} kB (listed without it)`)
      }
      const stars = repo.stargazers_count ?? 0
      const last = [released, repo.pushed_at ?? null].filter((d): d is string => !!d).sort().at(-1) ?? null
      plugins.push({
        id: m.id, name: typeof m.name === "string" ? m.name : m.id, description: typeof m.description === "string" ? m.description : repo.description ?? "",
        author: typeof m.author === "string" ? m.author : repo.owner?.login ?? full.split("/")[0], repo: full, ...(dir ? { dir } : {}), version: m.version, tag, stars,
        released, created: repo.created_at ?? null, pushed: repo.pushed_at ?? null, issues: { open, closed }, topics: repo.topics ?? [],
        disclosures: disclosuresOf(m), readme: readme.status === 200 && typeof readme.body === "string" ? excerpt(readme.body) : "", score: scoreOf(stars, last, open, closed, now),
        ...(typeof m.fundingUrl === "string" && m.fundingUrl.startsWith("https://") ? { fundingUrl: m.fundingUrl } : {}),
        ...(m.replaces && typeof m.replaces === "object" ? { replaces: m.replaces } : {}),
        ...(icon ? { icon } : {}), ...(typeof m.tint === "string" && /^[a-z][a-z-]*$/.test(m.tint) ? { tint: m.tint } : {}),
      })
    }
  }
  // One entry per id: the one with more stars (the others are copies or clashes).
  const byId = new Map<string, Any>()
  for (const p of plugins.sort((a, b) => (b.stars as number) - (a.stars as number))) {
    if (byId.has(p.id as string)) skipped.push(`${p.repo as string}: id '${p.id as string}' is ${byId.get(p.id as string)!.repo as string}'s`)
    else byId.set(p.id as string, p)
  }
  const out = [...byId.values()].sort((a, b) => (b.score as number) - (a.score as number) || (b.stars as number) - (a.stars as number))
  return { index: { format: 1, generated: new Date(now).toISOString(), plugins: out, blocked }, skipped }
}

/** GitHub over fetch (GITHUB_TOKEN when set). */
export function githubGet(token = process.env.GITHUB_TOKEN): Get {
  return async (url, accept = "application/vnd.github+json") => {
    const r = await fetch(url, { headers: { Accept: accept, "User-Agent": "vaultite-plugin-index", ...(token && (url.startsWith(API) || url.startsWith(RAW)) ? { Authorization: `Bearer ${token}` } : {}) } })
    const text = await r.text()
    let body: unknown = text
    if (!accept.endsWith(".raw")) try { body = JSON.parse(text) } catch { /* text */ }
    return { status: r.status, body }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = (n: string) => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1] }
  const json = (f: string | null, fallback: unknown) => (f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : fallback)
  const { index, skipped } = await buildIndex({ get: githubGet(), listed: json(flag("--listed"), []), blocked: json(flag("--blocked"), {}) })
  fs.writeFileSync(flag("--out") ?? "index.json", JSON.stringify(index, null, 2) + "\n")
  for (const s of skipped) console.log(`skipped ${s}`)
  console.log(`${index.plugins.length} plugins`)
}
