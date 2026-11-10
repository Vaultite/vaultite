// The web app's build server.ts serves (web/dist): its entry script (named by content), the files it starts with and
// the commit it's from (core/buildstamp.ts). Watched while anyone listens, so open pages hear of a new one at once.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { type Stamp, stampIn } from "./buildstamp.ts"

export type WebBuild = { entry: string | null; eager: string[]; stamp: Stamp | null }
const NONE: WebBuild = { entry: null, eager: [], stamp: null }

const ENTRY = /<script type="module"[^>]*\ssrc="[^"]*\/([^"/]+\.js)"/
const EAGER = /<(?:script|link)\b[^>]*?(?:src|href)="\.?\/?(assets\/[^"]+\.(?:js|css))"/g

/** A build folder's: `read` its index.html (again only once it changed), `on` hears a new entry once the file held
 *  still a moment. Polled each `ms`: a rebuild writes the file again, which a watch on it can lose. */
export function webBuilds(dist: string, ms = 1000) {
  const index = path.join(dist, "index.html")
  let seen = "", built = NONE
  function read(): WebBuild {
    try {
      const st = fs.statSync(index), key = `${st.mtimeMs}:${st.size}`
      if (key !== seen) {
        const html = fs.readFileSync(index, "utf8")
        built = { entry: ENTRY.exec(html)?.[1] ?? null, eager: [...html.matchAll(EAGER)].map((e) => path.join(dist, e[1])), stamp: stampIn(html) }
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
      for (const f of [...subs]) try { f(b) } catch (e) { console.error(e) }
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
  return { dist, read, on }
}

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
/** This server's: web/dist (VAULTITE_WEB_DIST: a test's copy of it, which the test builds anew). */
export const served = webBuilds(process.env.VAULTITE_WEB_DIST || path.join(ROOT, "web", "dist"))
