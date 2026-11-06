// Where a job runs, derived on the spot from what the ask was over (no registry): a preview's address -> its port -> the
// process listening -> its repo; a GitHub page -> its checkout; an editor's window -> its project; a note -> the vault.
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { gitEnv } from "../../../core/plugins.ts"

/** What an ask was over, as far as routing needs it (a Moment's). */
export type Over = { url?: string; app?: string; title?: string; path?: string; screen?: string; under?: string }
/** Where it resolved: the folder (a repo's top, else the vault), why, and the preview it came from. */
export type Found = { cwd: string; why: string; preview?: string }

const HOME = os.homedir()
const run = (cmd: string, args: string[], cwd?: string) => new Promise<string>((ok) =>
  execFile(cmd, args, { timeout: 3000, cwd, maxBuffer: 1 << 20, env: gitEnv() }, (e, out) => ok(e ? "" : String(out))))
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
const ROOTS = ["~/Projects", "~/Documents/personal/Projects", "~/Documents/Projects", "~/code", "~/src", "~/dev", "~/Developer", "~/Work", "~/repos", "~/git"]
let scanned: { at: number; key: string; repos: string[] } | null = null
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

/** Editors whose window title names the project (VS Code, Cursor, Zed, Xcode...: "file.ts — project"). */
const EDITORS = /vscode|VSCode|cursor|zed|xcode|sublime|jetbrains|intellij|webstorm|nova|windsurf/i

/** Where an ask over `o` runs on this machine; `self`: this machine's Tailscale names (its Serve sites). */
export async function resolveHere(o: Over, vault: string, self: string[] = [], roots = ROOTS): Promise<Found> {
  if (o.path) return { cwd: vault, why: `the note ${o.path}` }
  for (const u of urlsIn(o)) {
    if (u.hostname === "github.com") {
      const [owner, repo] = u.pathname.split("/").filter(Boolean)
      const dir = owner && repo ? checkoutOf(`${owner}/${repo}`, roots) : ""
      if (dir) return { cwd: dir, why: `${owner}/${repo} on GitHub, checked out at ${tilde(dir)}` }
      continue
    }
    let port = 0
    if (LOCAL.test(u.hostname)) port = Number(u.port) || (u.protocol === "https:" ? 443 : 80)
    else if (u.hostname.endsWith(".ts.net") && self.includes(u.hostname)) port = servedPort(await serveStatus(), u.hostname, u.port)
    if (!port) continue
    const dir = await listenerDir(port), top = dir ? await repoOf(dir) : ""
    if (top || dir) return { cwd: top || dir, why: `the preview ${u.host} is served from ${tilde(top || dir)}`, preview: u.origin }
  }
  if (o.app && EDITORS.test(o.app) && o.title) {
    for (const part of o.title.split(/ [—–-] /).reverse()) {
      const dir = namedCheckout(part.replace(/\s*\(.*\)$/, ""), roots)
      if (dir) return { cwd: dir, why: `${path.basename(dir)}, open in ${o.title}` }
    }
  }
  return { cwd: vault, why: "nothing on screen named a project: the vault" }
}

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
