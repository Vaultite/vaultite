import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { gitEnv } from "../../../core/plugins.ts"
import { parseJson } from "../../../core/agents.ts"

export type Over = { url?: string; app?: string; title?: string; path?: string; screen?: string; under?: string
  ui?: string; chrome?: string }
export type Found = { cwd: string; why: string; from?: "note" | "github" | "preview" | "site" | "editor" | "vault"; preview?: string }

const HOME = os.homedir()
const ran = (cmd: string, args: string[], cwd?: string, timeout = 3000) => new Promise<string | null>((ok) =>
  execFile(cmd, args, { timeout, cwd, maxBuffer: 1 << 20, env: gitEnv({ GIT_TERMINAL_PROMPT: "0" }) }, (e, out) => ok(e ? null : String(out))))
const run = async (cmd: string, args: string[], cwd?: string) => (await ran(cmd, args, cwd)) ?? ""
export const tilde = (p: string, home = HOME) => (p === home ? "~" : p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p)
const untilde = (p: string) => p.replace(/^~(?=$|\/)/, HOME)

export const repoOf = async (dir: string) => (await run("git", ["rev-parse", "--show-toplevel"], dir)).trim()
export const headOf = async (dir: string) => (await run("git", ["rev-parse", "HEAD"], dir)).trim()
const fetched = new Map<string, { at: number; done: Promise<unknown> }>()
export async function jobBase(dir: string) {
  const head = await headOf(dir), ref = (await run("git", ["symbolic-ref", "-q", "HEAD"], dir)).trim()
  const [remote, from, to] = ref ? (await run("git", ["for-each-ref", "--format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)", ref], dir)).trim().split("\0") : []
  if (!head || !remote || remote === "." || !from || !to?.startsWith("refs/remotes/")) return head
  const f = fetched.get(dir)
  if (!f || Date.now() - f.at > 30_000) fetched.set(dir, { at: Date.now(), done: ran("git", ["-c", "gc.auto=0", "fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "--no-auto-maintenance", remote, `+${from}:${to}`], dir, 4000) })
  await fetched.get(dir)!.done
  const tip = (await run("git", ["rev-parse", "-q", "--verify", `${to}^{commit}`], dir)).trim()
  return tip && tip !== head && await ran("git", ["merge-base", "--is-ancestor", head, tip], dir) !== null ? tip : head
}
export const fileAt = (dir: string, base: string, file: string) => ran("git", ["show", `${base}:${file}`], dir)

const LOCAL = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/
export function urlsIn(o: Over): URL[] {
  const text = [o.url, o.title, o.under, o.screen?.slice(0, 6000)].filter(Boolean).join("\n")
  const found = text.match(/\b(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|[\w-]+(?:\.[\w-]+)*\.ts\.net|github\.com)(?::\d{2,5})?(?:\/[^\s"'<>)]*)?/g) ?? []
  return [...new Set(found)].flatMap((s) => URL.parse(/^https?:/.test(s) ? s : `http://${s}`) ?? [])
}

const ADDRESS_LINE = /^\s*(?:(?:address(?: and search)? bar|url|location)\b[^:]{0,20}:\s*)?(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?)\s*$/i
const isLive = (u: URL) => /^https?:$/.test(u.protocol) && u.hostname.includes(".") && !LOCAL.test(u.hostname) && !u.hostname.endsWith(".ts.net") &&
  u.hostname !== "github.com" && !/^[\d.]+$/.test(u.hostname)
export function sitesIn(o: Over): URL[] {
  const lines = (o.screen ?? "").split("\n").slice(0, 60).flatMap((l) => { const m = ADDRESS_LINE.exec(l); return m ? [`https://${m[1]}`] : [] })
  return [o.url ?? "", ...lines].flatMap((s) => { const u = URL.parse(s); return u && isLive(u) ? [u] : [] })
    .filter((u, i, all) => all.findIndex((x) => x.href === u.href) === i)
}

export const APP_REPO = "Vaultite/vaultite"
const UI_KINDS: Record<string, string> = { panel: "panel", button: "button", group: "tab group", tab: "tab" }
export function appUiOf(o: Over) {
  if (o.chrome) return `Vaultite's own ${o.chrome}`
  const [kind, id] = (o.ui ?? "").split(/:(.*)/)
  if (!id || kind === "pane") return ""
  const name = (o.title ?? "").trim() || id.split(":")[0]
  return `Vaultite's own ${UI_KINDS[kind] ?? "UI"} ${JSON.stringify(name.slice(0, 60))}`
}

export function surfaceOf(m: (Over & { path?: string }) | undefined) {
  if (!m) return ""
  if (m.path) return `note:${m.path}`
  const u = urlsIn({ url: m.url, title: m.title, under: m.under, screen: m.screen }).find((x) => x.hostname !== "github.com" && /^https?:$/.test(x.protocol))
  return u ? `site:${u.origin}` : ""
}

const ServeStatus = z.object({ Web: z.record(z.string(), z.object({ Handlers: z.record(z.string(), z.object({ Proxy: z.string().optional() })).optional() })).optional() })
export function servedPort(status: unknown, host: string, port: string): number {
  const web = ServeStatus.safeParse(status ?? {}).data?.Web ?? {}
  const site = web[`${host}:${port || "443"}`]
  const proxy = Object.values(site?.Handlers ?? {}).map((h) => h.Proxy ?? "").find(Boolean) ?? ""
  return Number(/:(\d+)\/?$/.exec(proxy)?.[1]) || 0
}
const TAILSCALE = ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale"]
async function serveStatus() {
  for (const bin of TAILSCALE) {
    const out = await run(bin, ["serve", "status", "--json"]), status = out.trim() ? ServeStatus.safeParse(parseJson(out)).data : undefined
    if (status) return status
  }
  return null
}

async function listenerDir(port: number) {
  const pids = (await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])).split("\n").filter(Boolean)
  for (const pid of pids) {
    const cwd = /^n(.+)$/m.exec(await run("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"]))?.[1] ?? ""
    if (cwd && cwd !== "/") return cwd
  }
  return ""
}

const DEFAULT_ROOTS = ["~/Projects", "~/Documents/personal/Projects", "~/Documents/Projects", "~/code", "~/src", "~/dev", "~/Developer", "~/Work", "~/repos", "~/git"]
let ROOTS = DEFAULT_ROOTS
let scanned: { at: number; key: string; repos: string[] } | null = null
export const checkoutsIn = (roots?: string[]) => { ROOTS = roots ?? DEFAULT_ROOTS; scanned = null }
function checkouts(roots: string[]) {
  const key = roots.join("\n")
  if (scanned && scanned.key === key && Date.now() - scanned.at < 60_000) return scanned.repos
  const repos: string[] = [], dirs = (d: string) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules").map((e) => path.join(d, e.name)) } catch { return [] } }
  for (const root of roots.map(untilde)) for (const a of dirs(root)) {
    if (fs.existsSync(path.join(a, ".git"))) repos.push(a)
    else for (const b of dirs(a)) if (fs.existsSync(path.join(b, ".git"))) repos.push(b)
  }
  scanned = { at: Date.now(), key, repos }
  return repos
}
// A worktree's .git is a file naming its own git folder.
function remotes(dir: string) {
  try {
    let git = path.join(dir, ".git")
    if (fs.statSync(git).isFile()) git = path.resolve(dir, /gitdir: (.+)/.exec(fs.readFileSync(git, "utf8"))?.[1]?.trim() ?? "", "../..")
    return [...fs.readFileSync(path.join(git, "config"), "utf8").matchAll(/url\s*=\s*(\S+)/g)].map((m) => m[1])
  } catch { return [] }
}
export function checkoutOf(slug: string, roots = ROOTS) {
  const want = slug.toLowerCase().replace(/\.git$/, "")
  const hits = checkouts(roots).filter((d) => remotes(d).some((u) => u.toLowerCase().replace(/\.git$/, "").replace(/^git@github\.com:/, "github.com/").endsWith(`github.com/${want}`)))
  return hits.find((d) => fs.statSync(path.join(d, ".git")).isDirectory()) ?? hits[0] ?? ""
}
const namedCheckout = (name: string, roots = ROOTS) => { const n = name.trim().toLowerCase(); return n ? checkouts(roots).find((d) => path.basename(d).toLowerCase() === n) ?? "" : "" }
export function checkoutNamed(repo: string, roots: string[] = ROOTS) {
  const r = repo.trim().replace(/\/+$/, ""), slug = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/i.exec(r)?.[1] ?? (/^[\w.-]+\/[\w.-]+$/.test(r) ? r : "")
  if (slug) return checkoutOf(slug, roots) || namedCheckout(slug.split("/")[1], roots)
  return namedCheckout(path.basename(r), roots)
}
export const checkoutNames = (roots: string[] = ROOTS) => [...new Set(checkouts(roots).flatMap((d) => [path.basename(d).toLowerCase(),
  ...remotes(d).flatMap((u) => { const m = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(u); return m ? [m[1].toLowerCase()] : [] })]))]
export const checkoutsLine = (n = 30, roots: string[] = ROOTS) => { const all = checkouts(roots).map((d) => tilde(d)); return all.length ? `${all.slice(0, n).join(", ")}${all.length > n ? `, and ${all.length - n} more` : ""}` : "none" }
export const rootsLine = (roots: string[] = ROOTS) => roots.filter((r) => fs.existsSync(untilde(r))).join(", ") || "none of its usual project folders exist"

const nocomment = (t: string) => t.split("\n").filter((l) => !/^\s*(#|\/\/)/.test(l)).join("\n")
const patterns = (t: string) => [...nocomment(t).matchAll(/["']?\b(?:pattern|route)["']?\s*[=:]\s*["']([^"']+)["']/g)].map((m) => m[1])
const firstWord = (t: string) => nocomment(t).split(/\s+/).filter(Boolean).slice(0, 1)
const siteKey = (t: string) => [...nocomment(t).matchAll(/\b(?:site|url)\s*:\s*["'`](https?:\/\/[^"'`]+)/g)].map((m) => m[1])
type Deploy = [string, (text: string) => string[], number]
const Package = z.object({ homepage: z.string().regex(/^https?:/) })
const DEPLOYS: Deploy[] = [
  ["wrangler.toml", patterns, 1], ["wrangler.json", patterns, 1], ["wrangler.jsonc", patterns, 1],
  ["CNAME", firstWord, 1], ["public/CNAME", firstWord, 1], ["static/CNAME", firstWord, 1], ["docs/CNAME", firstWord, 1],
  ["package.json", (t) => { const h = Package.safeParse(parseJson(t)).data?.homepage; return h ? [h] : [] }, 0],
  ...["astro.config.mjs", "astro.config.ts", "astro.config.js", "docusaurus.config.js", "docusaurus.config.ts"].map((f): Deploy => [f, siteKey, 0]),
]
export function routeCovers(pattern: string, u: URL) {
  const p = pattern.trim().replace(/^https?:\/\//i, ""), cut = p.indexOf("/")
  const bare = (h: string) => h.toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "")
  const host = bare(cut < 0 ? p : p.slice(0, cut)), rest = cut < 0 ? "" : p.slice(cut), h = bare(u.hostname)
  if (!host || !(host.startsWith("*") ? h.endsWith(host.slice(1)) : host === h)) return 0
  const pathOk = !rest || rest === "/" || rest === "/*" ? true : rest.endsWith("*") ? u.pathname.startsWith(rest.slice(0, -1)) : u.pathname.replace(/\/$/, "") === rest.replace(/\/$/, "")
  return pathOk ? (host.startsWith("*") ? 1000 : 2000) + rest.replace(/\*$/, "").replace(/\/$/, "").length : 0
}
function gitHome(dir: string) {
  try {
    const git = path.join(dir, ".git")
    return fs.realpathSync(fs.statSync(git).isFile() ? path.resolve(dir, /gitdir: (.+)/.exec(fs.readFileSync(git, "utf8"))?.[1]?.trim() ?? "", "../..") : git)
  } catch { return dir }
}
export function siteCheckout(u: URL, roots = ROOTS): { dir: string; file: string; pattern: string } | { both: string[] } | null {
  const hits: { dir: string; file: string; pattern: string; score: number }[] = []
  for (const dir of checkouts(roots)) for (const [file, read, deploys] of DEPLOYS) {
    let text = ""
    try { text = fs.readFileSync(path.join(dir, file), "utf8") } catch { continue }
    for (const pattern of read(text)) { const score = routeCovers(pattern, u); if (score) hits.push({ dir, file, pattern, score: score + deploys * 10_000 }) }
  }
  const best = Math.max(0, ...hits.map((x) => x.score)), top = hits.filter((x) => x.score === best)
  const repos = new Map<string, typeof top>()
  for (const x of top) { const k = remotes(x.dir).find((r) => /github\.com/i.test(r))?.toLowerCase().replace(/\.git$/, "").replace(/^git@github\.com:/, "github.com/").replace(/^.*github\.com\//, "") || gitHome(x.dir); repos.set(k, [...(repos.get(k) ?? []), x]) }
  if (!repos.size) return null
  if (repos.size > 1) return { both: [...repos.values()].map((xs) => xs[0].dir).sort() }
  const xs = [...repos.values()][0], main = xs.find((x) => fs.statSync(path.join(x.dir, ".git"), { throwIfNoEntry: false })?.isDirectory()) ?? xs[0]
  return { dir: main.dir, file: main.file, pattern: main.pattern }
}

const EDITORS = /vscode|VSCode|cursor|zed|xcode|sublime|jetbrains|intellij|webstorm|nova|windsurf/i

export async function resolveHere(o: Over, vault: string, self: string[] = [], roots = ROOTS): Promise<Found> {
  if (o.path) return { cwd: vault, why: `the note ${o.path}`, from: "note" }
  let away = ""
  const sites = sitesIn(o), first = o.url ? sitesIn({ url: o.url }).slice(0, 1) : sites
  for (const [u, live] of [...first.map((u) => [u, true] as const), ...urlsIn(o).map((u) => [u, false] as const), ...sites.slice(first.length).map((u) => [u, true] as const)]) {
    if (live) {
      if (away) continue
      const hit = siteCheckout(u, roots), where = `${u.host}${u.pathname === "/" ? "" : u.pathname}`
      if (hit && "dir" in hit) return { cwd: hit.dir, why: `${where} is deployed from ${tilde(hit.dir)} (its ${hit.file} names ${hit.pattern})`, from: "site" }
      away = hit ? `${where} is deployed from ${hit.both.map((d) => tilde(d)).join(" and ")} alike, so which is unclear`
        : `no checkout here deploys ${u.host} (no wrangler config, CNAME, package.json homepage or site config names it)`
      continue
    }
    if (u.hostname === "github.com") {
      const [owner, repo] = u.pathname.split("/").filter(Boolean)
      const dir = owner && repo ? checkoutOf(`${owner}/${repo}`, roots) : ""
      if (dir) return { cwd: dir, why: `${owner}/${repo} on GitHub, checked out at ${tilde(dir)}`, from: "github" }
      continue
    }
    let port = 0
    if (LOCAL.test(u.hostname)) port = Number(u.port) || (u.protocol === "https:" ? 443 : 80)
    else if (u.hostname.endsWith(".ts.net") && self.includes(u.hostname)) port = servedPort(await serveStatus(), u.hostname, u.port)
    if (!port) continue
    const dir = await listenerDir(port), top = dir ? await repoOf(dir) : ""
    if (top) return { cwd: top, why: `the preview ${u.host} is served from ${tilde(top)}`, from: "preview", preview: u.origin }
    if (dir) away = `the preview ${u.host} is served from ${tilde(dir)}, not a repo`
  }
  if (o.app && EDITORS.test(o.app) && o.title) {
    for (const part of o.title.split(/ [—–-] /).reverse()) {
      const dir = namedCheckout(part.replace(/\s*\(.*\)$/, ""), roots)
      if (dir) return { cwd: dir, why: `${path.basename(dir)}, open in ${o.title}`, from: "editor" }
    }
  }
  return { cwd: vault, why: `${away || "nothing on screen named a project"}: the vault`, from: "vault" }
}

export const watched = (f: Found) => f.from === "preview" || f.from === "editor"
export async function githubOf(dir: string) {
  for (const u of [(await run("git", ["remote", "get-url", "origin"], dir)).trim(), ...remotes(dir)]) {
    const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(u)
    if (m) return `${m[1]}/${m[2]}`
    // An SSH host alias (git@work:owner/repo.git) goes where ssh's config says.
    const a = /^(?:[\w.-]+@)?([\w.-]+):([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(u)
    if (a && await sshHost(a[1]) === "github.com") return `${a[2]}/${a[3]}`
  }
  return ""
}
const hosts = new Map<string, Promise<string>>()
const sshHost = (alias: string) => {
  if (!hosts.has(alias)) hosts.set(alias, run("ssh", ["-G", alias]).then((out) => /^hostname (\S+)/m.exec(out)?.[1]?.toLowerCase() ?? ""))
  return hosts.get(alias)!
}
export async function onlyHere(dir: string) {
  const [status, ahead] = await Promise.all([ran("git", ["status", "--porcelain"], dir), ran("git", ["rev-list", "--count", "HEAD", "--not", "--remotes"], dir)])
  if (status === null || ahead === null) return "changes git couldn't read"
  const n = status.split("\n").filter(Boolean).length, c = Number(ahead.trim()) || 0
  return [n ? `${n} uncommitted change${n > 1 ? "s" : ""}` : "", c ? `${c} unpushed commit${c > 1 ? "s" : ""}` : ""].filter(Boolean).join(" and ")
}
export async function unpushed(dir: string) {
  const ahead = await ran("git", ["rev-list", "--count", "HEAD", "--not", "--remotes"], dir)
  if (ahead === null) return "commits git couldn't read"
  const c = Number(ahead.trim()) || 0
  return c ? `${c} unpushed commit${c > 1 ? "s" : ""}` : ""
}
export async function dropTree(dir: string, tree: string, branch: string) {
  if (fs.existsSync(tree)) {
    if (path.resolve(tree) === path.resolve(dir)) return "it's the checkout itself"
    const left = await onlyHere(tree)
    if (left) return left
    if (await ran("git", ["worktree", "remove", tree], dir, 120_000) === null) return "git wouldn't remove it"
  }
  if (branch && await ran("git", ["merge-base", "--is-ancestor", `refs/heads/${branch}`, "@{upstream}"], dir) !== null) await ran("git", ["branch", "-D", branch], dir)
  return ""
}
export const branchOf = async (dir: string) => { const b = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], dir)).trim(); return b === "HEAD" ? "" : b }

export function machineOfUrl(o: Over, hosts: Record<string, string>): { machine: string; url: string } | null {
  for (const u of urlsIn(o)) for (const [id, host] of Object.entries(hosts)) if (u.hostname === host) return { machine: id, url: u.href }
  return null
}

export function refusal(cwd: string, never: string[], home = HOME) {
  const here = tilde(cwd, home)
  for (const line of never) {
    const [folder, ...why] = line.split(":"), f = folder.trim().replace(/\/+$/, "")
    if (f && (here === f || here.startsWith(`${f}/`))) return why.join(":").trim() || `jobs never run under ${f} on this machine`
  }
  return ""
}
