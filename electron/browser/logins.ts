// Agents' logins (`vau browser login`): the app fills a username, password or one-time code from the agents' KeePass file
// (set up on this Mac); agents hear only what happened, and what's filled is hidden from them after (pagesecrets.ts).
import { app, dialog, safeStorage } from "electron"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { acting, byOf, pageFor, press, record, serve, settle } from "./agent.ts"
import { cdp, handle, type EnginePage } from "./engine.ts"
import type { Database, Entry } from "./keepass.ts"
import { loginForm, type Input } from "./loginform.ts"
import { docOf, filling, keep, markHeld, ranNear, siteOf } from "./pagesecrets.ts"

// (its reader, kdbxweb, loads at the first login: a Mac whose agents never log in never loads it)
const keepass = () => import("./keepass.ts")

/** This Mac's: the file and its password, encrypted with the Keychain's key (safeStorage). Never the vault's. */
const CONFIG = () => path.join(app.getPath("userData"), "agent-logins.json")
type Config = { file: string; key: string }
function config(): Config | null {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG(), "utf8")) as Partial<Config>
    return typeof c.file === "string" && typeof c.key === "string" ? { file: c.file, key: c.key } : null
  } catch { return null }
}

const SETUP = "the user sets it up in the desktop app on this Mac (an Agents container's menu, Passwords for agents)"
/** The file, opened now (KeeShare may have just written it). Its errors say what's wrong, never a value. */
async function database(): Promise<Database> {
  const c = config()
  if (!c) throw new Error(`no passwords for agents on this Mac: ${SETUP}`)
  let data: Buffer
  try { data = fs.readFileSync(c.file) } catch { throw new Error(`the agents' passwords file isn't there (${path.basename(c.file)}): ${SETUP}`) }
  let password: string
  try { password = safeStorage.decryptString(Buffer.from(c.key, "base64")) } catch { throw new Error(`this Mac's Keychain didn't give the file's password: ${SETUP}`) }
  const { openDatabase } = await keepass()
  try { return await openDatabase(data, password) } catch (e) { throw new Error(`the agents' passwords file doesn't open (${(e as Error).message}): ${SETUP}`) }
}

// ---------- approvals: an entry without the agent-free tag needs the user's yes, asked through the Inbox by the server ----------

/** A yes lasts this long, for that entry and that agent. */
const APPROVAL_MS = 15 * 60_000
/** An ask waits this long for the user's answer. */
const ASK_MS = 10 * 60_000
const approvals = new Map<string, number>()
/** Asks waiting, by entry and agent: the grant the server comes back with, the Inbox's answer beside it. */
const pending = new Map<string, { grant: string; until: number }>()

// ---------- the app's: setting it up ----------

handle("logins:status", async () => {
  const c = config()
  if (!c) return null
  try {
    const db = await database()
    return { file: c.file, entries: db.entries.length, free: db.entries.filter((e) => e.free).length }
  } catch (e) { return { file: c.file, error: (e as Error).message } }
})
handle("logins:choose", async (win) => {
  const r = await dialog.showOpenDialog(win, { title: "Passwords for agents", buttonLabel: "Choose", properties: ["openFile"], filters: [{ name: "KeePass", extensions: ["kdbx"] }] })
  return r.canceled ? null : r.filePaths[0] ?? null
})
// (the password comes from the app's own page, never the server: it's opened once to check it, then kept encrypted;
// what's wrong is answered, for the page to say)
handle("logins:set", async (_win, file, password) => {
  if (typeof file !== "string" || !path.isAbsolute(file) || typeof password !== "string" || !password) throw new Error("give a KeePass file and its password")
  if (!safeStorage.isEncryptionAvailable()) return { error: "this Mac's Keychain can't keep its password" }
  let data: Buffer
  try { data = fs.readFileSync(file) } catch { return { error: "the file can't be read" } }
  let db: Database
  try { db = await (await keepass()).openDatabase(data, password) } catch (e) { return { error: (e as Error).message } }
  const tmp = `${CONFIG()}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ file, key: safeStorage.encryptString(password).toString("base64") }), { mode: 0o600 })
  fs.renameSync(tmp, CONFIG())
  approvals.clear()
  pending.clear()
  return { file, entries: db.entries.length, free: db.entries.filter((e) => e.free).length }
})
handle("logins:forget", () => {
  fs.rmSync(CONFIG(), { force: true })
  approvals.clear()
  pending.clear()
})

// ---------- the page's login form, read over the DevTools protocol ----------

type DomNode = { backendNodeId: number; nodeName: string; attributes?: string[]; documentURL?: string; children?: DomNode[]
  contentDocument?: DomNode; shadowRoots?: DomNode[]; templateContent?: DomNode }
type Field = { input: Input; frame: string }

/** Every input of the page and its frames in this process, with the address of the document it's in. */
async function fieldsOf(p: EnginePage): Promise<Field[]> {
  const { root } = await cdp<{ root: DomNode }>(p.wc, "DOM.getDocument", { depth: -1, pierce: true })
  const out: Field[] = []
  const walk = (n: DomNode, frame: string, form: number) => {
    const name = n.nodeName.toUpperCase()
    if (name === "#DOCUMENT") frame = n.documentURL || frame
    if (name === "FORM") form = n.backendNodeId
    if (name === "INPUT") {
      const a: Record<string, string> = {}
      for (let i = 0; i + 1 < (n.attributes ?? []).length; i += 2) a[n.attributes![i].toLowerCase()] = n.attributes![i + 1]
      out.push({ frame, input: { id: n.backendNodeId, type: (a.type ?? "").toLowerCase(), hint: [a.name, a.id, a["aria-label"], a.placeholder].filter(Boolean).join(" "),
        autocomplete: (a.autocomplete ?? "").toLowerCase(), form, visible: false, disabled: "disabled" in a || "readonly" in a,
        maxLength: /^\d+$/.test(a.maxlength ?? "") ? Number(a.maxlength) : -1, inputMode: a.inputmode } })
    }
    for (const c of [...(n.shadowRoots ?? []), ...(n.children ?? []), ...(n.contentDocument ? [n.contentDocument] : [])]) walk(c, frame, name === "#DOCUMENT" ? 0 : form)
  }
  walk(root, p.wc.getURL(), 0)
  // (shown: it has a box on the page; hidden ones are decoys or another step's)
  await Promise.all(out.map(async (f) => {
    if (f.input.type === "hidden") return
    const box = await cdp<{ model: { width: number; height: number } }>(p.wc, "DOM.getBoxModel", { backendNodeId: f.input.id }).catch(() => null)
    f.input.visible = !!box && box.model.width > 0 && box.model.height > 0
  }))
  return out
}

/** Focus a field, and say whether it has the focus now (a page may move it elsewhere as it gets it). */
async function focus(p: EnginePage, id: number) {
  await cdp(p.wc, "DOM.scrollIntoViewIfNeeded", { backendNodeId: id }).catch(() => {})
  await cdp(p.wc, "DOM.focus", { backendNodeId: id })
  const { nodes } = await cdp<{ nodes: { properties?: { name: string; value: { value?: unknown } }[] }[] }>(p.wc, "Accessibility.getPartialAXTree", { backendNodeId: id, fetchRelatives: false })
  const focused = nodes[0]?.properties?.find((x) => x.name === "focused")?.value?.value
  return focused === true || focused === "true"
}

// ---------- the call ----------

type Opts = { entry?: unknown; submit?: unknown }
type Decided = { grant?: unknown; answer?: unknown }
const shown = (e: Entry) => ({ title: e.title, username: e.username })
const named = (e: Entry) => (e.username ? `${e.title} (${e.username})` : e.title)

async function login(p: EnginePage, o: Opts, who: ReturnType<typeof byOf>, decided: Decided | null) {
  const url = p.wc.getURL(), host = new URL(url).host
  const log = (result: string, e?: Entry, approved?: string) => void record(p, who, { action: "login", value: e ? named(e) : "", site: host, result, ...(approved ? { approved } : {}) })
  const db = await database()
  const all = (await keepass()).entriesFor(db, url)
  if (!all.length) {
    log("no entry")
    throw new Error(`no entry for ${host} in the agents' passwords: the user adds one to the Agents group, or signs in themselves (browser ask)`)
  }
  const want = String(o.entry ?? "").trim().toLowerCase()
  const picked = want ? all.filter((e) => e.title.toLowerCase() === want || e.username.toLowerCase() === want) : all
  if (!picked.length) throw new Error(`no entry for ${host} is titled or named "${String(o.entry)}": ${all.map(named).join(", ")}`)
  if (picked.length > 1) return { status: "choose", tab: p.id, site: host, entries: picked.map(shown) }
  const e = picked[0]
  if (e.expired) {
    log("expired", e)
    throw new Error(`${named(e)} has expired in the agents' passwords: the user renews it`)
  }

  const key = `${e.id}\n${who.session || who.name || "agent"}`
  let approved = e.free ? "free (agent-free tag)" : (approvals.get(key) ?? 0) > Date.now() ? "the user's yes, given earlier" : ""
  if (!approved) {
    const waiting = pending.get(key)
    const live = waiting && waiting.until > Date.now() ? waiting : null
    if (decided && live && decided.grant === live.grant) {
      pending.delete(key)
      if (decided.answer !== "approve") {
        log("denied by the user", e)
        throw new Error(`the user said no to logging in to ${host} as ${e.username || e.title}: don't try again`)
      }
      approvals.set(key, Date.now() + APPROVAL_MS)
      approved = "the user, in the Inbox"
    } else {
      const grant = live?.grant ?? crypto.randomBytes(16).toString("hex")
      pending.set(key, { grant, until: Date.now() + ASK_MS })
      if (!live) log("asked the user", e)
      const ask = crypto.createHash("sha256").update(key).digest("hex").slice(0, 24)
      return { status: "approval", tab: p.id, site: host, entry: shown(e), grant, ask }
    }
  }
  try {
    return await fill(p, e, db, o, who, approved)
  } catch (err) {
    log(`failed: ${(err as Error).message}`, e, approved)
    throw err
  }
}

async function fill(p: EnginePage, e: Entry, db: Database, o: Opts, who: ReturnType<typeof byOf>, approved: string) {
  const { matchesSite, totp } = await keepass()
  const url = p.wc.getURL(), host = new URL(url).host, doc = docOf(p.wc)
  const fields = await fieldsOf(p)
  const form = loginForm(fields.map((f) => f.input))
  const s = db.secrets(e.id)
  if (!s) throw new Error(`${named(e)} is gone from the agents' passwords`)
  const frameOf = (i: Input) => fields.find((f) => f.input === i)!.frame
  type Put = { input: Input; value: string; what: string }
  let puts: Put[]
  /** What's filled that agents never read, and how long it's worth hiding (a code's good for a minute or two). */
  let secret: { value: string; ms?: number } | null = null
  if (form.kind === "password") {
    puts = [...(form.username && s.username ? [{ input: form.username, value: s.username, what: "username" }] : []),
      { input: form.password, value: s.password, what: "password" }]
    secret = { value: s.password }
  } else if (form.kind === "username") {
    if (!s.username) throw new Error(`the page asks for a username, and ${e.title} has none`)
    puts = [{ input: form.username, value: s.username, what: "username" }]
  } else if (form.kind === "otp") {
    if (s.otp === "steam") throw new Error(`${e.title}'s one-time code is Steam's, which the app can't fill`)
    if (!s.otp) throw new Error(`the page asks for a one-time code, and ${e.title} has none`)
    const code = totp(s.otp)
    puts = form.otp.length > 1 ? form.otp.map((input, i) => ({ input, value: code[i] ?? "", what: "one-time code" }))
      : [{ input: form.otp[0], value: code, what: "one-time code" }]
    secret = { value: code, ms: 10 * 60_000 }
  } else throw new Error("no login form on this page (a username, a password or a one-time code to fill): open its sign-in page")
  // Every field in a document of the entry's own site, a frame's too.
  const away = puts.find((x) => !e.urls.some((u) => matchesSite(u, frameOf(x.input))))
  if (away) throw new Error(`the form is in a frame of ${new URL(frameOf(away.input)).host}, which ${e.title} isn't for`)

  // From here till it's filled: no script of an agent's in the site's pages (checked, then held, with no wait between)
  const sites = new Set([siteOf(url), ...puts.map((x) => siteOf(frameOf(x.input)))])
  if ([...sites].some((site) => ranNear(p, site))) {
    throw new Error("a script of yours (browser evaluate) ran in this site's pages since they loaded, and could read what's filled: load this one again (browser go <tab> reload), then log in")
  }
  filling.add(p.id)
  const did = new Set<string>()
  try {
    if (secret) {
      keep(secret.value, secret.ms)
      for (const site of sites) markHeld(p, site)
    }
    acting(p, who, `logging in to ${host}`)
    for (const x of puts) {
      if (docOf(p.wc) !== doc || !e.urls.some((u) => matchesSite(u, p.wc.getURL()))) throw new Error("the page changed while the app was filling it: nothing more was filled")
      if (!await focus(p, x.input.id)) throw new Error("the page moved the focus away from its field: nothing more was filled")
      if (x.input.maxLength !== 1) { await press(p, process.platform === "darwin" ? "Meta+a" : "Control+a"); await press(p, "Backspace") }
      if (docOf(p.wc) !== doc) throw new Error("the page changed while the app was filling it: nothing more was filled")
      await cdp(p.wc, "Input.insertText", { text: x.value })
      did.add(x.what)
    }
    if (o.submit === true) await press(p, "Enter")
  } finally { filling.delete(p.id) }
  const r = await settle(p, url)
  const filled = [...did]
  void record(p, who, { action: "login", value: named(e), site: host, result: `filled the ${filled.join(" and ")}${o.submit === true ? ", submitted" : ""}`, approved })
  return { status: "filled", ...r, site: host, entry: shown(e), filled, submitted: o.submit === true, approved }
}

// (the server's call: it asks the user through the Inbox for an entry that needs it, then comes back with the answer)
serve("agent:login", (_win, tab, opts, by, decided) => login(pageFor(tab, "act"), (opts && typeof opts === "object" ? opts : {}) as Opts, byOf(by),
  decided && typeof decided === "object" ? decided as Decided : null))
