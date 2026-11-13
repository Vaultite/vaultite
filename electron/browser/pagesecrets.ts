// What agents never read in a page: the secrets the app filled, and the documents an agent's script ran in.
import type { WebContents } from "electron"
import { getDomain } from "tldts-experimental"
import { allPages, eachPage, type EnginePage } from "./engine.ts"
import { mask } from "./mask.ts"

const KEEP_MS = 12 * 3600_000
const kept = new Map<string, number>()
export const keep = (secret: string, ms = KEEP_MS) => { if (secret) kept.set(secret, Math.max(kept.get(secret) ?? 0, Date.now() + ms)) }
function live() {
  const now = Date.now()
  for (const [s, until] of kept) if (until < now) kept.delete(s)
  return [...kept.keys()]
}

export const scrub = (text: string, secrets: Iterable<string> = live()) => mask(text, secrets)
const BINARY = new Set(["png", "pdf"])
export function scrubDeep<T>(v: T): T {
  const secrets = live()
  if (!secrets.length) return v
  const go = (x: unknown): unknown => typeof x === "string" ? scrub(x, secrets) : Array.isArray(x) ? x.map(go)
    : x && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype
      ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, BINARY.has(k) && typeof y === "string" ? y : go(y)])) : x
  return go(v) as T
}
export const hasSecret = (text: string) => { const s = live(); return s.length > 0 && scrub(text, s) !== text }

const docs = new WeakMap<WebContents, number>()
eachPage((p) => p.wc.on("did-navigate", () => docs.set(p.wc, docOf(p.wc) + 1)))
export const docOf = (wc: WebContents) => docs.get(wc) ?? 0

export function siteOf(url: string) {
  let host = ""
  try { host = new URL(url).hostname.toLowerCase() } catch { return "" }
  return getDomain(host, { allowPrivateDomains: true }) || host
}

const ran = new WeakMap<WebContents, { doc: number; site: string }>()
const held = new WeakMap<WebContents, { doc: number; sites: Set<string> }>()
const filledFields = new WeakMap<WebContents, { doc: number; ids: Set<number> }>()
export function markFilled(p: EnginePage, id: number) {
  const m = filledFields.get(p.wc)
  if (m && m.doc === docOf(p.wc)) m.ids.add(id); else filledFields.set(p.wc, { doc: docOf(p.wc), ids: new Set([id]) })
}
export const wasFilled = (wc: WebContents, id: number) => { const m = filledFields.get(wc); return !!m && m.doc === docOf(wc) && m.ids.has(id) }
export const filling = new Set<number>()

// A script reaches the pages its page opened and the one that opened it: any page of `site` in these logins counts.
const near = (p: EnginePage, site: string, of: WeakMap<WebContents, { doc: number; site?: string; sites?: Set<string> }>) =>
  [p, ...allPages().filter((q) => q !== p)].find((q) => {
    const m = of.get(q.wc)
    return q.profile === p.profile && !q.wc.isDestroyed() && !!m && m.doc === docOf(q.wc) && (m.site === site || !!m.sites?.has(site))
  })
const where = (p: EnginePage, q: EnginePage) => (q === p ? "this page" : `tab ${q.id}`)

export const markRan = (p: EnginePage) => ran.set(p.wc, { doc: docOf(p.wc), site: siteOf(p.wc.getURL()) })
export function ranNear(p: EnginePage, site: string) {
  const q = near(p, site, ran)
  if (!q) return ""
  if (q === p) return "an agent's script (browser evaluate) ran in this page since it loaded, and could read what's filled: load it again (browser go <tab> reload), then log in"
  return `an agent's script (browser evaluate) ran in tab ${q.id}, a page of ${site}, since it loaded, and could read what's filled here: log in once that tab is loaded again (browser go ${q.id} reload) or closed; if it's another agent's, once it's done`
}
export function markHeld(p: EnginePage, site: string) {
  const m = held.get(p.wc)
  if (m && m.doc === docOf(p.wc)) m.sites.add(site); else held.set(p.wc, { doc: docOf(p.wc), sites: new Set([site]) })
}
export function heldNear(p: EnginePage) {
  const q = near(p, siteOf(p.wc.getURL()), held)
  if (q) return `the app filled a login in ${where(p, q)} of this site, and it still has it: load it again (browser go ${q === p ? "<tab>" : q.id} reload) once signed in`
  if (hasSecret(p.wc.getURL())) return "its address has a secret the app filled in it"
  return ""
}

export async function exposed(p: EnginePage): Promise<boolean> {
  if (!live().length) return false
  if (hasSecret(`${p.wc.getURL()}\n${p.wc.getTitle()}`)) return true
  const code = `(() => { const out = [], values = []
    const walk = (root) => {
      if (root.body) out.push(root.body.innerText)
      for (const el of root.querySelectorAll("*")) {
        if ((el.tagName === "INPUT" && el.type !== "password") || el.tagName === "TEXTAREA") values.push(el.value)
        if (el.shadowRoot) { out.push(el.shadowRoot.textContent || ""); walk(el.shadowRoot) }
      }
    }
    walk(document)
    return [...out, ...values, values.join("")].join("\\n") })()`
  for (const f of p.wc.mainFrame.framesInSubtree) {
    const text = await f.executeJavaScript(code).catch(() => "")
    if (typeof text === "string" && hasSecret(text)) return true
  }
  return false
}
