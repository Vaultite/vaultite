// Agents' logins (`vau browser login`): the app fills a username, password or one-time code from the agents' KeePass file
// (set up on this Mac); agents hear only what happened, and what's filled is hidden from them after (pagesecrets.ts).
import { app, dialog, safeStorage, systemPreferences } from "electron"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { AppWindow } from "../appwindow.ts"
import { acting, byOf, pageFor, press, record, serve, settle, taskOf } from "./agent.ts"
import { allPages, cdp, handle, tell, type EnginePage } from "./engine.ts"
import type { Database, Entry } from "./keepass.ts"
import { loginForm, type Input } from "./loginform.ts"
import { docOf, filling, keep, markFilled, markHeld, ranNear, siteOf } from "./pagesecrets.ts"
import { register, verify, type Asserted, type Created, type Passkey } from "./presence.ts"

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

// ---------- approvals: an entry without the agent-free tag needs the user's yes, given with their passkey ----------
// Checked here, by the app that fills (the server passes the page's answer on): only the user's passkey signs a yes.

/** A yes lasts this long, for that entry and that agent. */
const APPROVAL_MS = 15 * 60_000
/** An ask, and a link to add a passkey, wait this long. */
const ASK_MS = 10 * 60_000
/** Yeses, by entry and agent: till when, and which passkey said it. */
const approvals = new Map<string, { until: number; by: string }>()
/** Logins waiting on the user, by their grant (the approval page's address has it): the challenge it last gave the page,
 *  good for one answer. */
type Grant = { key: string; tab: number; site: string; entry: Entry; agent: string; task: string; until: number; challenge: Buffer | null
  state: "waiting" | "approved" | "denied"; waiters: Set<() => void> }
const grants = new Map<string, Grant>()
const b64u = (b: Buffer) => b.toString("base64url")

function decide(g: Grant, state: "approved" | "denied", by = "") {
  g.state = state
  const p = allPages().find((x) => x.id === g.tab)
  if (p) void record(p, { name: g.agent }, { action: "login", value: named(g.entry), site: g.site, result: state === "approved" ? `approved with ${by}` : "denied on the approval page" })
  for (const done of [...g.waiters]) done()
}
function grantFor(id: unknown) {
  const g = grants.get(String(id))
  if (!g || g.until < Date.now()) throw new Error("this approval has expired: the agent asks again")
  return g
}

// ---------- the user's passkeys, this Mac's: encrypted with the Keychain's key, so only the app adds one ----------

const PASSKEYS = () => path.join(app.getPath("userData"), "agent-approvals.bin")
function passkeys(): Passkey[] {
  try {
    const list = JSON.parse(safeStorage.decryptString(fs.readFileSync(PASSKEYS()))) as unknown
    return Array.isArray(list) ? list as Passkey[] : []
  } catch { return [] }
}
function savePasskeys(list: Passkey[]) {
  const tmp = `${PASSKEYS()}.${process.pid}.tmp`
  fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(list)), { mode: 0o600 })
  fs.renameSync(tmp, PASSKEYS())
  for (const w of AppWindow.getAllWindows()) tell(w, { type: "engine:logins:passkeys" })
}

/** Links to add a passkey (the app's, shown as a QR code): a challenge each, used once. */
const additions = new Map<string, { challenge: Buffer; user: Buffer; until: number }>()
function additionFor(token: unknown) {
  const a = additions.get(String(token))
  if (!a || a.until < Date.now()) throw new Error("this link to add a passkey has expired: start again in the app (Passwords for agents)")
  return a
}
/** The user, at this Mac: Touch ID. A passkey added without it could be an agent's own (computer use clicks the app). */
async function here(reason: string) {
  if (!app.isPackaged && process.env.VAULTITE_TEST_TOUCHID === "yes") return true // (QA: no finger in a test)
  if (process.platform !== "darwin" || !systemPreferences.canPromptTouchID()) {
    throw new Error("this Mac can't ask for Touch ID now (its lid closed?), which confirms a new passkey")
  }
  return systemPreferences.promptTouchID(reason).then(() => true, () => false)
}

handle("logins:passkeys", () => passkeys().map((k) => ({ id: k.id, name: k.name, site: k.rpId, added: k.added })))
handle("logins:passkey-start", () => {
  const token = b64u(crypto.randomBytes(16))
  additions.set(token, { challenge: crypto.randomBytes(32), user: crypto.randomBytes(16), until: Date.now() + ASK_MS })
  return { token }
})
handle("logins:passkey-remove", (_win, id) => savePasskeys(passkeys().filter((k) => k.id !== String(id))))

// (the server's, from the pages the phone opens: each checked here, whoever calls)
serve("agent:passkey-options", (_win, token) => {
  const a = additionFor(token)
  return { challenge: b64u(a.challenge), user: b64u(a.user), exclude: passkeys().map((k) => k.id) }
})
serve("agent:passkey-add", async (_win, token, given, name) => {
  const a = additionFor(token)
  additions.delete(String(token))
  const pk = register((given && typeof given === "object" ? given : {}) as Created, a.challenge, String(name ?? "").trim() || "A passkey")
  if (!await here(`add a passkey (${pk.name}) to approve agents' logins`)) throw new Error("not added: Touch ID on this Mac confirms a new passkey")
  savePasskeys([...passkeys().filter((k) => k.id !== pk.id), pk])
  return { name: pk.name, site: pk.rpId }
})
serve("agent:login-options", (_win, id) => {
  const g = grantFor(id)
  const shown = { site: g.site, entry: { title: g.entry.title, username: g.entry.username }, agent: g.agent, task: g.task, state: g.state }
  if (g.state !== "waiting") return shown
  const keys = passkeys()
  if (!keys.length) throw new Error("no passkey is set up to approve agents' logins")
  g.challenge = crypto.randomBytes(32)
  return { ...shown, challenge: b64u(g.challenge), allow: keys.map((k) => k.id) }
})
serve("agent:login-answer", (_win, id, given) => {
  const g = grantFor(id)
  if (g.state !== "waiting") throw new Error(`it was ${g.state} already`)
  const a = (given && typeof given === "object" ? given : {}) as Asserted & { deny?: unknown }
  if (a.deny === true) { decide(g, "denied"); return { state: g.state } }
  // (one answer per challenge: a replayed one finds none)
  const challenge = g.challenge
  g.challenge = null
  if (!challenge) throw new Error("load the approval page again")
  const keys = passkeys()
  const { passkey, counter } = verify(a, keys, challenge)
  if (counter !== passkey.counter) savePasskeys(keys.map((k) => (k.id === passkey.id ? { ...k, counter } : k)))
  approvals.set(g.key, { until: Date.now() + APPROVAL_MS, by: `the user's passkey (${passkey.name})` })
  decide(g, "approved", `the user's passkey (${passkey.name})`)
  return { state: g.state }
})
// (till the user answered, at most a minute: the op then says it's waiting)
serve("agent:login-wait", async (_win, id, ms) => {
  const g = grants.get(String(id))
  if (!g || g.until < Date.now()) return "gone"
  if (g.state === "waiting") {
    await new Promise<void>((done) => {
      const end = () => { clearTimeout(timer); g.waiters.delete(end); done() }
      const timer = setTimeout(end, Math.min(60_000, Math.max(0, Number(ms) || 0)))
      g.waiters.add(end)
    })
  }
  return g.state
})

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
  grants.clear()
  return { file, entries: db.entries.length, free: db.entries.filter((e) => e.free).length }
})
handle("logins:forget", () => {
  fs.rmSync(CONFIG(), { force: true })
  approvals.clear()
  grants.clear()
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
const shown = (e: Entry) => ({ title: e.title, username: e.username })
const named = (e: Entry) => (e.username ? `${e.title} (${e.username})` : e.title)

async function login(p: EnginePage, o: Opts, who: ReturnType<typeof byOf>) {
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
  const ask = crypto.createHash("sha256").update(key).digest("hex").slice(0, 24)
  const yes = approvals.get(key)
  const approved = e.free ? "free (agent-free tag)" : yes && yes.until > Date.now() ? yes.by : ""
  if (!approved) {
    let id = [...grants].find(([, g]) => g.key === key && g.state === "waiting" && g.until > Date.now())?.[0]
    if (!id) {
      id = b64u(crypto.randomBytes(16))
      grants.set(id, { key, tab: p.id, site: host, entry: e, agent: who.name || "An agent", task: who.task || taskOf(p.id), until: Date.now() + ASK_MS, challenge: null, state: "waiting", waiters: new Set() })
      log("asked the user", e)
    }
    const keys = passkeys()
    return { status: "approval", tab: p.id, site: host, entry: shown(e), grant: id, ask, approve: keys.length ? `${keys.at(-1)!.origin}/api/web-viewer/approve?grant=${id}` : null }
  }
  try {
    return { ...await fill(p, e, db, o, who, approved), ...(e.free ? {} : { ask }) }
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
      if (x.what !== "username") markFilled(p, x.input.id)
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

// (the server's call: for an entry that needs the user's yes, it tells them (the Inbox) and waits (agent:login-wait))
serve("agent:login", (_win, tab, opts, by) => login(pageFor(tab, "act"), (opts && typeof opts === "object" ? opts : {}) as Opts, byOf(by)))
