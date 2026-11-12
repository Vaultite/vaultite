// Where a job runs, from what the ask was over (no registry): a preview -> the process serving it -> its repo; a live site
// -> the checkout whose deploy names it; a GitHub page -> its checkout; an editor -> its project; a note -> the vault.
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { gitEnv, type Machine } from "../../../core/plugins.ts"

/** What an ask was over, as far as routing needs it (a Moment's). */
export type Over = { url?: string; app?: string; title?: string; path?: string; screen?: string; under?: string }
/** Where it resolved: the folder (a repo's top, else the vault), why, what led there, and the preview it came from. */
export type Found = { cwd: string; why: string; from?: "note" | "github" | "preview" | "site" | "editor" | "vault"; preview?: string }

const HOME = os.homedir()
/** A command's output, null when it failed. */
const ran = (cmd: string, args: string[], cwd?: string) => new Promise<string | null>((ok) =>
  execFile(cmd, args, { timeout: 3000, cwd, maxBuffer: 1 << 20, env: gitEnv() }, (e, out) => ok(e ? null : String(out))))
const run = async (cmd: string, args: string[], cwd?: string) => (await ran(cmd, args, cwd)) ?? ""
export const tilde = (p: string, home = HOME) => (p === home ? "~" : p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p)
const untilde = (p: string) => p.replace(/^~(?=$|\/)/, HOME)

/** A repo's top folder, or "" (not in one). */
export const repoOf = async (dir: string) => (await run("git", ["rev-parse", "--show-toplevel"], dir)).trim()
/** Its commit now, the base a review's diff is counted from. */
export const headOf = async (dir: string) => (await run("git", ["rev-parse", "HEAD"], dir)).trim()

const LOCAL = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/
/** The addresses an ask's words, title or screen show, the page's own first. */
export function urlsIn(o: Over): URL[] {
  const text = [o.url, o.title, o.under, o.screen?.slice(0, 6000)].filter(Boolean).join("\n")
  const found = text.match(/\b(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|[\w-]+(?:\.[\w-]+)*\.ts\.net|github\.com)(?::\d{2,5})?(?:\/[^\s"'<>)]*)?/g) ?? []
  return [...new Set(found)].flatMap((s) => { try { return [new URL(/^https?:/.test(s) ? s : `http://${s}`)] } catch { return [] } })
}

/** A browser's address bar as Accessibility reads it: a line that is an address alone, or labelled as one. */
const ADDRESS_LINE = /^\s*(?:(?:address(?: and search)? bar|url|location)\b[^:]{0,20}:\s*)?(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?)\s*$/i
/** A live site's address (not this machine's, a tailnet preview's or GitHub's). */
const isLive = (u: URL) => /^https?:$/.test(u.protocol) && u.hostname.includes(".") && !LOCAL.test(u.hostname) && !u.hostname.endsWith(".ts.net") &&
  u.hostname !== "github.com" && !/^[\d.]+$/.test(u.hostname)
/** The live sites an ask is over: its page's address, else what a browser's address bar shows (never a link on the page). */
export function sitesIn(o: Over): URL[] {
  const lines = (o.screen ?? "").split("\n").slice(0, 60).flatMap((l) => { const m = ADDRESS_LINE.exec(l); return m ? [`https://${m[1]}`] : [] })
  return [o.url ?? "", ...lines].flatMap((s) => { try { const u = new URL(s); return isLive(u) ? [u] : [] } catch { return [] } })
    .filter((u, i, all) => all.findIndex((x) => x.href === u.href) === i)
}

/** What an ask is over, as one surface a job can work on: a note, else a page's site (a preview's address, the app's);
 *  "" none (a GitHub page is a repo's, not one page). */
export function surfaceOf(m: (Over & { path?: string }) | undefined) {
  if (!m) return ""
  if (m.path) return `note:${m.path}`
  const u = urlsIn({ url: m.url, title: m.title, under: m.under, screen: m.screen }).find((x) => x.hostname !== "github.com" && /^https?:$/.test(x.protocol))
  return u ? `site:${u.origin}` : ""
}

/** The local port a Tailscale Serve name's port proxies to here (`tailscale serve status`), or 0. */
export function servedPort(status: unknown, host: string, port: string): number {
  const web = ((status ?? {}) as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> }).Web ?? {}
  const site = web[`${host}:${port || "443"}`]
  const proxy = Object.values(site?.Handlers ?? {}).map((h) => h.Proxy ?? "").find(Boolean) ?? ""
  return Number(/:(\d+)\/?$/.exec(proxy)?.[1]) || 0
}
const TAILSCALE = ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale"]
async function serveStatus() {
  for (const bin of TAILSCALE) {
    const out = await run(bin, ["serve", "status", "--json"])
    if (out.trim()) try { return JSON.parse(out) } catch { /* not JSON */ }
  }
  return null
}

/** The folder of the process listening on local port `port` (lsof), or "". */
async function listenerDir(port: number) {
  const pids = (await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])).split("\n").filter(Boolean)
  for (const pid of pids) {
    const cwd = /^n(.+)$/m.exec(await run("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"]))?.[1] ?? ""
    if (cwd && cwd !== "/") return cwd
  }
  return ""
}

/** The folders checkouts are looked for in: `roots` (~ for home), two levels down. */
const DEFAULT_ROOTS = ["~/Projects", "~/Documents/personal/Projects", "~/Documents/Projects", "~/code", "~/src", "~/dev", "~/Developer", "~/Work", "~/repos", "~/git"]
let ROOTS = DEFAULT_ROOTS
let scanned: { at: number; key: string; repos: string[] } | null = null
/** Other folders to look for checkouts in (the tests'), or the usual ones again (none); either looks afresh. */
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
/** A checkout's remote URLs (its .git/config; a worktree's .git file points at its own). */
function remotes(dir: string) {
  try {
    let git = path.join(dir, ".git")
    if (fs.statSync(git).isFile()) git = path.resolve(dir, /gitdir: (.+)/.exec(fs.readFileSync(git, "utf8"))?.[1]?.trim() ?? "", "../..")
    return [...fs.readFileSync(path.join(git, "config"), "utf8").matchAll(/url\s*=\s*(\S+)/g)].map((m) => m[1])
  } catch { return [] }
}
/** The checkout here of GitHub's `owner/repo` (its main one before a worktree), or "". */
export function checkoutOf(slug: string, roots = ROOTS) {
  const want = slug.toLowerCase().replace(/\.git$/, "")
  const hits = checkouts(roots).filter((d) => remotes(d).some((u) => u.toLowerCase().replace(/\.git$/, "").replace(/^git@github\.com:/, "github.com/").endsWith(`github.com/${want}`)))
  return hits.find((d) => fs.statSync(path.join(d, ".git")).isDirectory()) ?? hits[0] ?? ""
}
/** A checkout here named `name` (a folder's name), or "". */
const namedCheckout = (name: string, roots = ROOTS) => { const n = name.trim().toLowerCase(); return n ? checkouts(roots).find((d) => path.basename(d).toLowerCase() === n) ?? "" : "" }
/** This machine's own checkout of a repo another names: by GitHub's `owner/repo` (or its address), by a folder's name,
 *  or by another machine's path to it (its folder's name): each machine keeps its repos in its own place. */
export function checkoutNamed(repo: string, roots: string[] = ROOTS) {
  const r = repo.trim().replace(/\/+$/, ""), slug = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/i.exec(r)?.[1] ?? (/^[\w.-]+\/[\w.-]+$/.test(r) ? r : "")
  if (slug) return checkoutOf(slug, roots) || namedCheckout(slug.split("/")[1], roots)
  return namedCheckout(path.basename(r), roots)
}
/** The checkouts this machine has, by their folders' names (~ for home), at most `n`: what's there when a repo isn't. */
export const checkoutsLine = (n = 30, roots: string[] = ROOTS) => { const all = checkouts(roots).map((d) => tilde(d)); return all.length ? `${all.slice(0, n).join(", ")}${all.length > n ? `, and ${all.length - n} more` : ""}` : "none" }
/** Where checkouts are looked for, in words ("~/Projects, ~/Documents/personal/Projects..."). */
export const rootsLine = (roots: string[] = ROOTS) => roots.filter((r) => fs.existsSync(untilde(r))).join(", ") || "none of its usual project folders exist"

/** The files a checkout's deploy names its domain in, and the addresses (route patterns) each names. */
const nocomment = (t: string) => t.split("\n").filter((l) => !/^\s*(#|\/\/)/.test(l)).join("\n")
const patterns = (t: string) => [...nocomment(t).matchAll(/["']?\b(?:pattern|route)["']?\s*[=:]\s*["']([^"']+)["']/g)].map((m) => m[1])
const firstWord = (t: string) => nocomment(t).split(/\s+/).filter(Boolean).slice(0, 1)
const siteKey = (t: string) => [...nocomment(t).matchAll(/\b(?:site|url)\s*:\s*["'`](https?:\/\/[^"'`]+)/g)].map((m) => m[1])
/** (a host's routes and CNAMEs are what deploys there; a homepage or a site's own address in its config only says where
 *  it lives (an app's package.json names its website): weaker, so a repo that deploys the site wins) */
const DEPLOYS: [string, (text: string) => string[], number][] = [
  ["wrangler.toml", patterns, 1], ["wrangler.json", patterns, 1], ["wrangler.jsonc", patterns, 1],
  ["CNAME", firstWord, 1], ["public/CNAME", firstWord, 1], ["static/CNAME", firstWord, 1], ["docs/CNAME", firstWord, 1],
  ["package.json", (t) => { try { const h = JSON.parse(t).homepage; return typeof h === "string" && /^https?:/.test(h) ? [h] : [] } catch { return [] } }, 0],
  ...["astro.config.mjs", "astro.config.ts", "astro.config.js", "docusaurus.config.js", "docusaurus.config.ts"].map((f) => [f, siteKey, 0] as [string, (t: string) => string[], number]),
]
/** How closely a deploy's route pattern (Cloudflare's "example.com/*", "*.example.com", a CNAME's domain, a URL) covers
 *  `u`: 0 not at all; a named host over a wildcard, a longer path over a shorter. A bare www. is its apex. */
export function routeCovers(pattern: string, u: URL) {
  const p = pattern.trim().replace(/^https?:\/\//i, ""), cut = p.indexOf("/")
  const bare = (h: string) => h.toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "")
  const host = bare(cut < 0 ? p : p.slice(0, cut)), rest = cut < 0 ? "" : p.slice(cut), h = bare(u.hostname)
  if (!host || !(host.startsWith("*") ? h.endsWith(host.slice(1)) : host === h)) return 0
  const pathOk = !rest || rest === "/" || rest === "/*" ? true : rest.endsWith("*") ? u.pathname.startsWith(rest.slice(0, -1)) : u.pathname.replace(/\/$/, "") === rest.replace(/\/$/, "")
  return pathOk ? (host.startsWith("*") ? 1000 : 2000) + rest.replace(/\*$/, "").replace(/\/$/, "").length : 0
}
/** A checkout's own git folder (a worktree's is its main checkout's): what tells two folders are one repo. */
function gitHome(dir: string) {
  try {
    const git = path.join(dir, ".git")
    return fs.realpathSync(fs.statSync(git).isFile() ? path.resolve(dir, /gitdir: (.+)/.exec(fs.readFileSync(git, "utf8"))?.[1]?.trim() ?? "", "../..") : git)
  } catch { return dir }
}
/** The checkout here that deploys the live site `u`: the one whose deploy config names its address most closely (its
 *  main checkout over a worktree, one clone of a GitHub repo); `both` when two repos name it alike, null when none does. */
export function siteCheckout(u: URL, roots = ROOTS): { dir: string; file: string; pattern: string } | { both: string[] } | null {
  const hits: { dir: string; file: string; pattern: string; score: number }[] = []
  for (const dir of checkouts(roots)) for (const [file, read, deploys] of DEPLOYS) {
    let text = ""
    try { text = fs.readFileSync(path.join(dir, file), "utf8") } catch { continue }
    for (const pattern of read(text)) { const score = routeCovers(pattern, u); if (score) hits.push({ dir, file, pattern, score: score + deploys * 10_000 }) }
  }
  const best = Math.max(0, ...hits.map((x) => x.score)), top = hits.filter((x) => x.score === best)
  // (one repo by its git folder, then by its GitHub name: worktrees and clones of it aren't a second answer)
  const repos = new Map<string, typeof top>()
  for (const x of top) { const k = remotes(x.dir).find((r) => /github\.com/i.test(r))?.toLowerCase().replace(/\.git$/, "").replace(/^git@github\.com:/, "github.com/").replace(/^.*github\.com\//, "") || gitHome(x.dir); repos.set(k, [...(repos.get(k) ?? []), x]) }
  if (!repos.size) return null
  if (repos.size > 1) return { both: [...repos.values()].map((xs) => xs[0].dir).sort() }
  const xs = [...repos.values()][0], main = xs.find((x) => { try { return fs.statSync(path.join(x.dir, ".git")).isDirectory() } catch { return false } }) ?? xs[0]
  return { dir: main.dir, file: main.file, pattern: main.pattern }
}

/** Editors whose window title names the project (VS Code, Cursor, Zed, Xcode...: "file.ts — project"). */
const EDITORS = /vscode|VSCode|cursor|zed|xcode|sublime|jetbrains|intellij|webstorm|nova|windsurf/i

/** Where an ask over `o` runs on this machine; `self`: this machine's Tailscale names (its Serve sites). */
export async function resolveHere(o: Over, vault: string, self: string[] = [], roots = ROOTS): Promise<Found> {
  if (o.path) return { cwd: vault, why: `the note ${o.path}`, from: "note" }
  let away = ""
  // (the page's own address first (its url, else a browser's address bar): a live site's, before a preview its text mentions)
  const sites = sitesIn(o), first = o.url ? sitesIn({ url: o.url }).slice(0, 1) : sites
  for (const [u, live] of [...first.map((u) => [u, true] as const), ...urlsIn(o).map((u) => [u, false] as const), ...sites.slice(first.length).map((u) => [u, true] as const)]) {
    if (live) {
      if (away) continue
      const hit = siteCheckout(u, roots), where = `${u.host}${u.pathname === "/" ? "" : u.pathname}`
      if (hit && "dir" in hit) return { cwd: hit.dir, why: `${where} is deployed from ${tilde(hit.dir)} (its ${hit.file} names ${hit.pattern})`, from: "site" }
      // (never a guess between two, nor from the page's title: said, so whoever asked can name the repo)
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
    // (an app's own server, a bundle: no project to work on there)
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

/** Where jobs with nothing tying them here go (the setting jobs_machine: auto, here or a machine's id), of the machines
 *  listed: auto is an always-on one (its server on its own, not in a laptop's app) unless this one is (`here`). */
export function preferredMachine(all: Machine[], want: string, vault: string, here: boolean): { machine: Machine | null; why: string } {
  const w = want.trim() || "auto", none = { machine: null, why: "" }
  // (it runs there in its copy of this vault, through its companion: companion.where, companion.worker)
  const fits = (m: Machine) => m.online && !m.self && !!vault && m.vault === vault && !!m.plugins?.includes("companion")
  if (w === "here") return none
  if (w !== "auto") {
    const m = all.find((x) => x.id === w)
    return !m || m.self ? none : fits(m) ? { machine: m, why: "the machine jobs prefer" }
      : { machine: null, why: `${m.label}, where jobs go, ${!m.online ? "is offline" : m.vault !== vault ? "has another vault" : "runs no companion"}` }
  }
  const m = here ? null : all.find((x) => x.standalone && fits(x))
  return m ? { machine: m, why: "always on" } : none
}
/** Whether an ask placed here is over a copy the user watches here: a preview served here, an editor's project open here. */
export const watched = (f: Found) => f.from === "preview" || f.from === "editor"
/** A checkout's GitHub `owner/repo` (origin's first, else any remote's), or "". */
export async function githubOf(dir: string) {
  for (const u of [(await run("git", ["remote", "get-url", "origin"], dir)).trim(), ...remotes(dir)]) {
    const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(u)
    if (m) return `${m[1]}/${m[2]}`
  }
  return ""
}
/** What of a checkout exists only here, in words: its uncommitted changes and commits on no remote ("" when none). */
export async function onlyHere(dir: string) {
  const [status, ahead] = await Promise.all([ran("git", ["status", "--porcelain"], dir), ran("git", ["rev-list", "--count", "HEAD", "--not", "--remotes"], dir)])
  // (unread, it may hold changes: never moved on a guess)
  if (status === null || ahead === null) return "changes git couldn't read"
  const n = status.split("\n").filter(Boolean).length, c = Number(ahead.trim()) || 0
  return [n ? `${n} uncommitted change${n > 1 ? "s" : ""}` : "", c ? `${c} unpushed commit${c > 1 ? "s" : ""}` : ""].filter(Boolean).join(" and ")
}
/** The commits a job's worktree here would start from that no remote has, in words ("" when none): its uncommitted
 *  changes aren't counted, as a worktree never takes them. */
export async function unpushed(dir: string) {
  const ahead = await ran("git", ["rev-list", "--count", "HEAD", "--not", "--remotes"], dir)
  if (ahead === null) return "commits git couldn't read"
  const c = Number(ahead.trim()) || 0
  return c ? `${c} unpushed commit${c > 1 ? "s" : ""}` : ""
}
/** Its branch now ("" when detached). */
export const branchOf = async (dir: string) => { const b = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], dir)).trim(); return b === "HEAD" ? "" : b }

/** The Tailscale name of an address that's another machine's: its hostname, when `hosts` (machine id -> hostname) has it. */
export function machineOfUrl(o: Over, hosts: Record<string, string>): { machine: string; url: string } | null {
  for (const u of urlsIn(o)) for (const [id, host] of Object.entries(hosts)) if (u.hostname === host) return { machine: id, url: u.href }
  return null
}

/** A rule `never` (`<folder>: <why>`) the folder breaks: its why, else "". */
export function refusal(cwd: string, never: string[], home = HOME) {
  const here = tilde(cwd, home)
  for (const line of never) {
    const [folder, ...why] = line.split(":"), f = folder.trim().replace(/\/+$/, "")
    if (f && (here === f || here.startsWith(`${f}/`))) return why.join(":").trim() || `jobs never run under ${f} on this machine`
  }
  return ""
}
