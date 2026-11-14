import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { parseJson } from "../../../core/agents.ts"
import { checkouts, DEPLOYS, gitHome, HOMEPAGE_ONLY, remotes, tilde } from "./where.ts"

export const Checkout = z.object({ repo: z.string(), dir: z.string(), title: z.string(), what: z.string(), deploys: z.array(z.string()) })
export type Checkout = z.output<typeof Checkout>
const TAGS = /<\/?(?:h\d|p|img|a|br|b|i|em|strong|div|span|picture|source|sub|sup|code|center|details|summary)\b[^>]*>/gi
const plain = (t: string) => t.replace(TAGS, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "").replace(/\s+/g, " ").trim()
const cut = (t: string, n: number) => t.length <= n ? t : `${t.slice(0, n).replace(/\s+\S*$/, "")}…`
function aboutOf(dir: string) {
  let text = ""
  for (const f of ["README.md", "readme.md", "Readme.md", "README"]) { try { text = fs.readFileSync(path.join(dir, f), "utf8").slice(0, 6000); break } catch { continue } }
  const h1 = /<h1\b[\s\S]*?<\/h1>|^#[ \t]+\S.*$/im.exec(text), title = h1 ? plain(h1[0].replace(/^#\s+/, "")) : ""
  const rest = h1 ? text.slice(h1.index + h1[0].length) : text
  const prose = rest.split(/\n\s*\n/).filter((x) => !/^\s*(?:#|```|\||>)/.test(x)).map(plain).find((x) => x.split(" ").filter((w) => /[a-z]{2}/i.test(w)).length >= 3) ?? ""
  const desc = parseJson(fs.existsSync(path.join(dir, "package.json")) ? fs.readFileSync(path.join(dir, "package.json"), "utf8") : "", z.object({ description: z.string() }))?.description ?? ""
  return { title: cut(title, 80), what: cut(prose || desc, 160) }
}
const originOf = (dir: string) => { const all = remotes(dir); return all.find((u) => all.length === 1 || remoteNamed(dir, "origin") === u) ?? all[0] ?? "" }
function remoteNamed(dir: string, name: string) {
  try {
    let git = path.join(dir, ".git")
    if (fs.statSync(git).isFile()) git = path.resolve(dir, /gitdir: (.+)/.exec(fs.readFileSync(git, "utf8"))?.[1]?.trim() ?? "", "../..")
    return new RegExp(`\\[remote "${name}"\\][^[]*?url\\s*=\\s*(\\S+)`).exec(fs.readFileSync(path.join(git, "config"), "utf8"))?.[1] ?? ""
  } catch { return "" }
}
function deploysOf(dir: string) {
  const out = new Set<string>()
  for (const [file, read] of DEPLOYS.filter(([f]) => f !== HOMEPAGE_ONLY)) {
    let text = ""
    try { text = fs.readFileSync(path.join(dir, file), "utf8") } catch { continue }
    for (const p of read(text)) out.add(p.trim().replace(/^https?:\/\//i, "").replace(/\/\*?$/, "").toLowerCase())
  }
  return [...out].filter(Boolean)
}
const carded = new WeakMap<string[], Checkout[]>()
export function checkoutCards(roots?: string[]): Checkout[] {
  const repos = checkouts(roots), had = carded.get(repos)
  if (had) return had
  const slugOf = (dir: string) => [originOf(dir), ...remotes(dir)].map((u) => /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(u)?.[1]).find(Boolean)
  const byRepo = new Map<string, string[]>()
  for (const d of repos) { const k = slugOf(d)?.toLowerCase() ?? gitHome(d); byRepo.set(k, [...(byRepo.get(k) ?? []), d]) }
  const cards = [...byRepo.values()].map((ds) => {
    const dir = ds.find((d) => fs.statSync(path.join(d, ".git"), { throwIfNoEntry: false })?.isDirectory()) ?? ds[0]
    return { repo: slugOf(dir) ?? path.basename(dir), dir: tilde(dir), ...aboutOf(dir), deploys: deploysOf(dir) }
  })
  carded.set(repos, cards)
  return cards
}
