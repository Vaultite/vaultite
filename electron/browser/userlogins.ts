// Your own logins in your own pages (never an agent's: logins.ts fills those): the address bar's key fills one from your
// passwords (passwords.ts), and a sign-in they don't have yet is offered to save. Its preload tells forms and sign-ins.
import { ipcMain, type IpcMainEvent, type WebContents } from "electron"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"
import { agentState } from "./agent.ts"
import { allPages, eachPage, eachSession, handle, openedByAgent, tell, webSessionMade, type EnginePage, type EngineWindow } from "./engine.ts"
import { filledLately, fillLogin } from "./fill.ts"
import { saveOffer } from "./loginform.ts"
import { ranNear, siteOf } from "./pagesecrets.ts"
import { configured, entriesForUrl, isUnlocked, saveLogin, secretsOf } from "./passwords.ts"

const PRELOAD = fileURLToPath(new URL("./userlogins-preload.cjs", import.meta.url))
eachSession((s) => { s.registerPreloadScript({ type: "frame", filePath: PRELOAD }) })

/** The page a frame's message came from, if it's a web page of the user's own (an agent's says nothing here). */
function senderPage(e: IpcMainEvent) {
  if (!webSessionMade(e.sender.session) || !e.senderFrame) return null
  const p = allPages().find((x) => x.wc === e.sender)
  return p && !agentState(p.id).by ? p : null
}
/** Page `id` of window `win`, the user's own. */
function userPage(win: EngineWindow, id: unknown) {
  const p = allPages().find((x) => x.id === Number(id))
  if (!p || p.wc.isDestroyed() || p.win !== win) throw new Error("that page isn't open anymore")
  if (agentState(p.id).by) throw new Error("that page is an agent's: agents log in with their own passwords")
  return p
}

// ---------- which pages show a login form (the key in their address bar), and a password field ----------

type Shows = { form: boolean; password: boolean }
/** Each page's frames that show a login form now, by frame. */
const forms = new WeakMap<WebContents, Map<string, Shows>>()
const shows = (p: EnginePage, what: keyof Shows) => [...(forms.get(p.wc)?.values() ?? [])].some((s) => s[what])
const tellForm = (p: EnginePage) => tell(p.win, { type: "engine:passwords:form", id: p.id, on: shows(p, "form") })

ipcMain.on("vaultite:logins:form", (e, given: unknown) => {
  const p = senderPage(e)
  if (!p || !given || typeof given !== "object") return
  const g = given as Partial<Shows>, f = e.senderFrame!
  const map = forms.get(p.wc) ?? new Map<string, Shows>()
  forms.set(p.wc, map)
  const was = shows(p, "form")
  map.set(`${f.processId}:${f.routingId}`, { form: g.form === true, password: g.password === true })
  if (shows(p, "form") !== was) tellForm(p)
  weigh(p)
})
eachPage((p) => {
  p.wc.on("did-frame-navigate", (_e, _url, _code, _status, main, processId, routingId) => {
    const map = forms.get(p.wc)
    if (!map) return
    const was = shows(p, "form")
    if (main) map.clear(); else map.delete(`${processId}:${routingId}`)
    if (shows(p, "form") !== was) tellForm(p)
    weigh(p)
  })
  p.wc.on("did-stop-loading", () => weigh(p))
  p.wc.once("destroyed", () => { const w = waiting.get(p.wc); if (w) clearTimeout(w.timer) })
})
handle("passwords:forms", (win) => allPages().filter((p) => p.win === win && !p.wc.isDestroyed() && !agentState(p.id).by && shows(p, "form")).map((p) => p.id))

// ---------- filling: the user picked an entry of the site's ----------

/** The site's entries, for the key's list (no secret: it works locked). Null when no passwords file is set up here. */
handle("passwords:fill-list", async (win, id) => {
  const p = userPage(win, id)
  if (!configured()) return null
  return (await entriesForUrl(p.wc.getURL())).map((r) => ({ id: r.id, title: r.title, username: r.username, otp: r.otp }))
})
/** Fill entry `entry` into page `id`: `{ locked: true }` while the file is (the app unlocks it, then asks again). */
handle("passwords:fill", async (win, id, entry) => {
  const p = userPage(win, id)
  const url = p.wc.getURL()
  const row = (await entriesForUrl(url)).find((r) => r.id === String(entry))
  if (!row) throw new Error("that login isn't for this site")
  let s: Awaited<ReturnType<typeof secretsOf>>
  try { s = await secretsOf(row.id) } catch (e) { if ((e as Error).message === "locked") return { locked: true }; throw e }
  if (!s) throw new Error("that login is gone from your passwords")
  if (ranNear(p, siteOf(url))) throw new Error("an agent ran a script in a page of this site since it loaded, and could read what's filled: reload the page, then fill")
  return { filled: await fillLogin(p, row, s, { noForm: "this page has no login form to fill" }) }
})

// ---------- saving: a sign-in sent with a password your passwords don't have ----------

/** A sign-in heard, waiting to see it worked (its password field gone: a wrong one shows it again). */
type Heard = { url: string; username: string; password: string; until: number; timer?: ReturnType<typeof setTimeout> }
const HEARD_MS = 60_000
const waiting = new WeakMap<WebContents, Heard>()
/** A username-first sign-in's username, by page: its password step is another submit. */
const named = new WeakMap<WebContents, { site: string; username: string; at: number }>()
/** What's offered: memory only, gone after a while. */
type Offer = { win: EngineWindow; url: string; username: string; password: string; entry?: string; timer: ReturnType<typeof setTimeout> }
const OFFER_MS = 5 * 60_000
const offers = new Map<string, Offer>()
/** Sign-ins already weighed (a page, a username, a password's hash), so one isn't offered twice. */
const weighed = new Map<string, number>()

ipcMain.on("vaultite:logins:submitted", (e, given: unknown) => {
  const p = senderPage(e)
  if (!p || openedByAgent(p.id) || !given || typeof given !== "object") return
  const url = e.senderFrame!.url
  const g = given as { username?: unknown; password?: unknown }
  const username = typeof g.username === "string" ? g.username.trim().slice(0, 256) : ""
  const password = typeof g.password === "string" && g.password.length <= 1024 ? g.password : ""
  if (!/^https?:/i.test(url)) return
  const site = siteOf(url)
  if (!password) { if (username) named.set(p.wc, { site, username, at: Date.now() }); return }
  if (filledLately(p.wc, password) || !configured()) return
  const first = named.get(p.wc)
  const user = username || (first && first.site === site && Date.now() - first.at < OFFER_MS ? first.username : "")
  const was = waiting.get(p.wc)
  if (was) clearTimeout(was.timer)
  waiting.set(p.wc, { url, username: user, password, until: Date.now() + HEARD_MS })
  weigh(p)
})

/** A sign-in heard in `p`, once its page no longer shows a password field (and isn't loading): offered, if new. */
function weigh(p: EnginePage) {
  const h = waiting.get(p.wc)
  if (!h) return
  clearTimeout(h.timer)
  if (Date.now() > h.until || p.wc.isDestroyed()) { waiting.delete(p.wc); return }
  h.timer = setTimeout(() => {
    if (waiting.get(p.wc) !== h || p.wc.isDestroyed()) return
    if (Date.now() > h.until) { waiting.delete(p.wc); return }
    if (p.wc.isLoading() || shows(p, "password")) { h.timer = setTimeout(() => weigh(p), h.until - Date.now()); return }
    waiting.delete(p.wc)
    void offer(p, h).catch((e) => console.error("vaultite: a sign-in wasn't offered to save:", (e as Error).message))
  }, 1200)
}

async function offer(p: EnginePage, h: Heard) {
  const key = `${p.id}\n${h.username}\n${crypto.createHash("sha256").update(h.password).digest("base64")}`
  const now = Date.now()
  for (const [k, t] of weighed) if (t < now - OFFER_MS) weighed.delete(k)
  if (weighed.has(key)) return
  weighed.set(key, now)
  const rows = await entriesForUrl(h.url)
  // (unlocked, each entry's password is compared here; locked, an entry of that username may have it: none offered)
  let same: Set<string> | null = null
  if (isUnlocked()) {
    same = new Set()
    for (const r of rows) if ((await secretsOf(r.id).catch(() => null))?.password === h.password) same.add(r.id)
  }
  const kind = saveOffer(rows, h.username, same)
  if (!kind || p.wc.isDestroyed()) return
  const id = crypto.randomBytes(12).toString("base64url")
  const timer = setTimeout(() => offers.delete(id), OFFER_MS)
  offers.set(id, { win: p.win, url: h.url, username: h.username, password: h.password, ...(kind.kind === "update" ? { entry: kind.id } : {}), timer })
  if (offers.size > 20) { const [old, o] = offers.entries().next().value!; clearTimeout(o.timer); offers.delete(old) }
  tell(p.win, { type: "engine:passwords:offer", offer: id, site: new URL(h.url).hostname.replace(/^www\./, ""), username: h.username, kind: kind.kind })
}

/** The user's yes to an offer: saved to the passwords file (no unlock needed: it shows nothing). */
handle("passwords:save-offer", async (win, id) => {
  const o = offers.get(String(id))
  if (!o || o.win !== win) throw new Error("it's been too long: sign in again to save it")
  offers.delete(String(id))
  clearTimeout(o.timer)
  return saveLogin({ url: o.url, username: o.username, password: o.password, ...(o.entry ? { id: o.entry } : {}) })
})
