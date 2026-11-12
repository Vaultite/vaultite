// The web app's build server.ts serves (web/dist): its entry script (named by content), the files it starts with and
// the commit it's from (core/buildstamp.ts). Watched while anyone listens, so open pages hear of a new one at once.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { buildName, type Stamp, stampIn } from "./buildstamp.ts"
import { logger } from "./log.ts"

const log = logger("webbuild")

export type WebBuild = { entry: string | null; eager: string[]; stamp: Stamp | null }
const NONE: WebBuild = { entry: null, eager: [], stamp: null }

const ENTRY = /<script type="module"[^>]*\ssrc="[^"]*\/([^"/]+\.js)"/
const IMPORT_MAP = /<script type="importmap"[^>]*>([\s\S]*?)<\/script>/
const EAGER = /<(?:script|link)\b[^>]*?(?:src|href)="\.?\/?(assets\/[^"]+\.(?:js|css))"/g

/** A build folder's: `read` its index.html (again once changed), `on` hears a new entry once it held still (polled: a
 *  watch can lose a rewrite). `adopt`: another folder's from now on (a code root's, plan.ts' adopt-web), told as new. */
export function webBuilds(first: string, ms = 1000) {
  let dist = first, index = path.join(dist, "index.html")
  let seen = "", built = NONE
  function read(): WebBuild {
    try {
      const st = fs.statSync(index), key = `${st.mtimeMs}:${st.size}`
      if (key !== seen) {
        const html = fs.readFileSync(index, "utf8")
        const entry = ENTRY.exec(html)?.[1]
        built = { entry: entry ? buildName(entry, IMPORT_MAP.exec(html)?.[1]) : null, eager: [...html.matchAll(EAGER)].map((e) => path.join(dist, e[1])), stamp: stampIn(html) }
        seen = key
      }
    } catch { seen = ""; built = NONE }
    return built
  }

  const subs = new Set<(b: WebBuild) => void>()
  let told: string | null = null, settle: ReturnType<typeof setTimeout> | undefined
  const changed = () => {
    clearTimeout(settle)
    // (a build being written reads as none, or half: told once it's whole and new)
    settle = setTimeout(() => {
      const b = read()
      if (!b.entry || b.entry === told) return
      told = b.entry
      for (const f of [...subs]) try { f(b) } catch (e) { log.error("a listener of the new build failed", e) }
    }, 300)
    settle.unref?.()
  }
  function on(fn: (b: WebBuild) => void) {
    if (!subs.size) { told = read().entry; fs.watchFile(index, { interval: ms, persistent: false }, changed) }
    subs.add(fn)
    return () => {
      subs.delete(fn)
      if (!subs.size) { fs.unwatchFile(index, changed); clearTimeout(settle) }
    }
  }
  function adopt(to: string) {
    if (path.resolve(to) === dist) return
    if (subs.size) fs.unwatchFile(index, changed)
    dist = path.resolve(to); index = path.join(dist, "index.html"); seen = ""
    if (subs.size) { fs.watchFile(index, { interval: ms, persistent: false }, changed); changed() }
  }
  return { get dist() { return dist }, read, on, adopt }
}

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
/** This server's: web/dist (VAULTITE_WEB_DIST: a test's copy of it, which the test builds anew). */
export const served = webBuilds(process.env.VAULTITE_WEB_DIST || path.join(ROOT, "web", "dist"))
