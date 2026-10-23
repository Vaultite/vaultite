// What agents never read in a page (logins.ts fills, agent.ts answers them): the secrets the app filled, scrubbed from
// every answer, and which documents ran an agent's script or hold a filled login, each of which refuses the other.
import type { WebContents } from "electron"
import { getDomain } from "tldts-experimental"
import { allPages, eachPage, type EnginePage } from "./engine.ts"

/** A filled secret is scrubbed this long after (a page may show it later: in its address, revealed). Memory only. */
const KEEP_MS = 12 * 3600_000
const kept = new Map<string, number>()
export const keep = (secret: string, ms = KEEP_MS) => { if (secret) kept.set(secret, Math.max(kept.get(secret) ?? 0, Date.now() + ms)) }
export const forgetSecrets = () => kept.clear()
function live() {
  const now = Date.now()
  for (const [s, until] of kept) if (until < now) kept.delete(s)
  return [...kept.keys()]
}

const MASK = "•••"
const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const patterns = new Map<string, RegExp>()
/** A secret however an address or a form encodes it: each character as is or %-encoded (any case), a space as +. */
function pattern(s: string) {
  let re = patterns.get(s)
  if (re) return re
  const hex = (b: number) => `%${b.toString(16).padStart(2, "0").toUpperCase().replace(/[A-F]/g, (x) => `[${x}${x.toLowerCase()}]`)}`
  re = new RegExp([...s].map((c) => `(?:${literal(c)}|${[...new TextEncoder().encode(c)].map(hex).join("")}${c === " " ? "|\\+" : ""})`).join(""), "g")
  if (patterns.size > 100) patterns.clear()
  patterns.set(s, re)
  return re
}
/** `text` with each secret put out of sight: as is, and as an address or a form encodes it. */
export function scrub(text: string, secrets: Iterable<string> = live()): string {
  let out = text
  // (the longest first: one secret inside another leaves none of the longer one)
  for (const s of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) out = out.replace(pattern(s), MASK)
  return out
}
/** Every string in `v` scrubbed (an answer to an agent, whatever its shape). */
export function scrubDeep<T>(v: T): T {
  const secrets = live()
  if (!secrets.length) return v
  const go = (x: unknown): unknown => typeof x === "string" ? scrub(x, secrets) : Array.isArray(x) ? x.map(go)
    : x && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, go(y)])) : x
  return go(v) as T
}
/** Whether `text` has a secret in it. */
export const hasSecret = (text: string) => { const s = live(); return s.length > 0 && scrub(text, s) !== text }

// ---------- documents: which one a page shows, and what happened in it ----------

const docs = new WeakMap<WebContents, number>()
eachPage((p) => p.wc.on("did-navigate", () => docs.set(p.wc, docOf(p.wc) + 1)))
/** Which document page `wc` shows: a new one at each navigation that isn't in the page (a reload too). */
export const docOf = (wc: WebContents) => docs.get(wc) ?? 0

/** A page's site: its registrable domain (example.com for a.example.com), else its host. */
export function siteOf(url: string) {
  let host = ""
  try { host = new URL(url).hostname.toLowerCase() } catch { return "" }
  return getDomain(host, { allowPrivateDomains: true }) || host
}

/** Documents an agent's script ran in (evaluate), and ones the app filled a login in (its sites: a form in a frame). */
const ran = new WeakMap<WebContents, { doc: number; site: string }>()
const held = new WeakMap<WebContents, { doc: number; sites: Set<string> }>()
/** Pages the app is filling a login in: agents wait for it to end. */
export const filling = new Set<number>()

/** The pages a script in `p` could reach, a site's in the same logins: any page of `site` there (a script reaches the
 *  pages its page opened, and the one that opened it). */
const near = (p: EnginePage, site: string, of: WeakMap<WebContents, { doc: number; site?: string; sites?: Set<string> }>) => allPages().some((q) => {
  const m = of.get(q.wc)
  return q.profile === p.profile && !q.wc.isDestroyed() && !!m && m.doc === docOf(q.wc) && (m.site === site || !!m.sites?.has(site))
})

/** An agent's script runs in `p`'s document now. */
export const markRan = (p: EnginePage) => ran.set(p.wc, { doc: docOf(p.wc), site: siteOf(p.wc.getURL()) })
/** Whether an agent's script ran in a page of `site` (in `p`'s logins) since it last loaded: its code may still be
 *  there, listening, so the app fills nothing on that site till it loads again. */
export const ranNear = (p: EnginePage, site: string) => near(p, site, ran)
/** The app fills a login into `p`'s document now, in a frame of `site`. */
export function markHeld(p: EnginePage, site: string) {
  const m = held.get(p.wc)
  if (m && m.doc === docOf(p.wc)) m.sites.add(site); else held.set(p.wc, { doc: docOf(p.wc), sites: new Set([site]) })
}
/** Why an agent's script may not run in `p` now (a secret it could read), or "". */
export function heldNear(p: EnginePage) {
  if (near(p, siteOf(p.wc.getURL()), held)) return "the app filled a login on this site, and the page still has it: load it again (browser go <tab> reload) once you're signed in"
  if (hasSecret(p.wc.getURL())) return "its address has a secret the app filled in it"
  return ""
}

/** What the page shows that a picture would too (its text, the values of its fields but passwords', in every frame),
 *  has a filled secret: then no screenshot or PDF of it. */
export async function exposed(p: EnginePage): Promise<boolean> {
  if (!live().length) return false
  if (hasSecret(`${p.wc.getURL()}\n${p.wc.getTitle()}`)) return true
  const code = `(() => { const out = []
    const walk = (root) => {
      if (root.body) out.push(root.body.innerText)
      for (const el of root.querySelectorAll("*")) {
        if ((el.tagName === "INPUT" && el.type !== "password") || el.tagName === "TEXTAREA") out.push(el.value)
        if (el.shadowRoot) { out.push(el.shadowRoot.textContent || ""); walk(el.shadowRoot) }
      }
    }
    walk(document)
    return out.join("\\n") })()`
  for (const f of p.wc.mainFrame.framesInSubtree) {
    const text = await f.executeJavaScript(code).catch(() => "")
    if (typeof text === "string" && hasSecret(text)) return true
  }
  return false
}
