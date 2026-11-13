// Import from Brave or Chrome: a profile's history (into history.ts's store) and its bookmarks (handed to the app, for
// the vault's bookmarks note). Never passwords or cookies.
import { app } from "electron"
import { z } from "zod"
import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { handle } from "./engine.ts"
import { add } from "./history.ts"
import { PROFILE_NAMES } from "./extwire.ts"
import { CHROME_ROWS, chromeVisits } from "./historyrows.ts"

const BROWSER = z.enum(["brave", "chrome"])
export type Browser = z.infer<typeof BROWSER>
const browserOf = (b: unknown) => { const r = BROWSER.safeParse(b); if (!r.success) throw new Error("no such browser"); return r.data }
const NAMES: Record<Browser, string> = { brave: "Brave", chrome: "Chrome" }

/** A browser's user data folder on this computer. VAULTITE_TEST_BROWSERS: a folder with brave/ and chrome/ in it (QA). */
function dataDir(b: Browser) {
  if (process.env.VAULTITE_TEST_BROWSERS) return path.join(process.env.VAULTITE_TEST_BROWSERS, b)
  const home = os.homedir()
  if (process.platform === "darwin") return path.join(home, "Library/Application Support", b === "brave" ? "BraveSoftware/Brave-Browser" : "Google/Chrome")
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData/Local"), b === "brave" ? "BraveSoftware/Brave-Browser" : "Google/Chrome", "User Data")
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), b === "brave" ? "BraveSoftware/Brave-Browser" : "google-chrome")
}

export type Profile = { dir: string; name: string; history: boolean; bookmarks: boolean }

/** A browser's profiles ("Default", "Profile 1"...) with the names it shows them by; [] when it isn't here. */
export function profiles(b: Browser): Profile[] {
  const root = dataDir(b)
  let names: z.infer<typeof PROFILE_NAMES> = {}
  try { names = PROFILE_NAMES.parse(JSON.parse(fs.readFileSync(path.join(root, "Local State"), "utf8"))) } catch { /* named by folder */ }
  let dirs: string[] = []
  try { dirs = fs.readdirSync(root).filter((d) => d === "Default" || /^Profile \d+$/.test(d)) } catch { return [] }
  return dirs.flatMap((dir) => {
    const has = (f: string) => fs.existsSync(path.join(root, dir, f))
    if (!has("History") && !has("Bookmarks")) return []
    const name = names[dir]?.name || dir
    return [{ dir, name, history: has("History"), bookmarks: has("Bookmarks") }]
  }).sort((a, b) => (a.dir === "Default" ? -1 : b.dir === "Default" ? 1 : a.dir.localeCompare(b.dir, undefined, { numeric: true })))
}

/** A profile's folder, checked to be one of the browser's. */
function profileDir(b: Browser, dir: unknown) {
  if (typeof dir !== "string" || !(dir === "Default" || /^Profile \d+$/.test(dir))) throw new Error("no such profile")
  return path.join(dataDir(b), dir)
}

/** A profile's history brought into this Mac's: the visits it shows (not frames', reloads or the redirects on the way).
 *  How many visits were new. */
export function importHistory(b: Browser, dir: string, profile: string) {
  const from = profileDir(b, dir)
  const tmp = fs.mkdtempSync(path.join(app.getPath("temp"), "vaultite-import-"))
  try {
    // Copied first (the browser keeps it locked while it runs), with its journal: a copy taken mid-write rolls back whole.
    for (const f of ["History", "History-journal", "History-wal"]) if (fs.existsSync(path.join(from, f))) fs.copyFileSync(path.join(from, f), path.join(tmp, f))
    const src = new DatabaseSync(path.join(tmp, "History"))
    try {
      // (its times in milliseconds: in microseconds they're past what a JavaScript number holds exactly)
      const rows = src.prepare("SELECT v.visit_time / 1000 AS at, v.transition AS t, u.url, u.title FROM visits v JOIN urls u ON u.id = v.url WHERE u.hidden = 0").all()
      const visits = chromeVisits(CHROME_ROWS.parse(rows), profile, b)
      return { found: visits.length, added: add(visits) }
    } finally { src.close() }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

export type Bookmark = { url: string; title: string; folder: string }
type Node = { type?: string; name?: string; url?: string; children?: Node[] }

/** A profile's bookmarks, each with its folder's path ("Bookmarks bar/Reading"), in the browser's order. */
export function bookmarks(b: Browser, dir: string): Bookmark[] {
  const file = path.join(profileDir(b, dir), "Bookmarks")
  let roots: Record<string, Node> = {}
  try { roots = JSON.parse(fs.readFileSync(file, "utf8"))?.roots ?? {} } catch { return [] }
  const out: Bookmark[] = []
  // (a folder's own "/" would read as a level)
  const named = (n: Node) => String(n.name ?? "").replace(/\//g, "-").trim()
  const walk = (n: Node, at: string[]) => {
    if (out.length >= 20_000 || !n || typeof n !== "object") return
    if (n.type === "url" && typeof n.url === "string" && /^https?:\/\//i.test(n.url)) out.push({ url: n.url, title: String(n.name ?? "").trim(), folder: at.join("/") })
    else if (Array.isArray(n.children)) for (const c of n.children) walk(c, c?.type === "folder" ? [...at, named(c)] : at)
  }
  for (const key of ["bookmark_bar", "other", "synced"]) {
    const r = roots[key]
    if (r && Array.isArray(r.children) && r.children.length) walk(r, [named(r) || key])
  }
  return out
}

handle("import:sources", () => BROWSER.options.map((b) => ({ browser: b, name: NAMES[b], profiles: profiles(b) })).filter((s) => s.profiles.length))
handle("import:history", (_w, b, dir, profile) => importHistory(browserOf(b), String(dir), typeof profile === "string" ? profile.slice(0, 64) : ""))
handle("import:bookmarks", (_w, b, dir) => bookmarks(browserOf(b), String(dir)))
