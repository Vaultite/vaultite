// Agents' logins (`vau browser login`): the app fills a username, password or one-time code from the agents' KeePass file
// (set up on this computer); agents hear only what happened, and what's filled is hidden from them after (pagesecrets.ts).
import { app, dialog, safeStorage, systemPreferences } from "electron"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { acting, pageFor, record, serve, settle, taskOf } from "./agent.ts"
import { BY, type By } from "./agentwire.ts"
import { allPages, handle, tellAll, type EnginePage } from "./engine.ts"
import type { Database, Entry } from "./keepass.ts"
import { fillLogin } from "./fill.ts"
import { ASSERTED, CREATED, PASSKEY, register, verify, type Passkey } from "./presence.ts"
import { z } from "zod"
import { messageOf } from "./errors.ts"

// (its reader, kdbx/, loads at the first login: a Mac whose agents never log in never loads it)
const keepass = () => import("./keepass.ts")

const HERE = process.platform === "darwin" ? "this Mac" : "this computer"
/** What keeps a secret with the system's key (safeStorage): a Mac's Keychain, Linux's keyring (a Secret Service). */
const KEYRING = process.platform === "darwin" ? "this Mac's Keychain" : "this computer's keyring"
/** With no keyring (a Linux without a Secret Service), secrets are held only till the app quits: never on disk, where
 *  agents running as the user could read them. */
const keyring = () => safeStorage.isEncryptionAvailable()

/** This computer's: the file and its password, encrypted with the keyring's key (no `key`: held in memory). Never the
 *  vault's. */
const CONFIG = () => path.join(app.getPath("userData"), "agent-logins.json")
type Config = { file: string; key: string | null }
const CONFIG_FILE = z.object({ file: z.string(), key: z.string().optional().catch(undefined) })
let held: { file: string; password: string } | null = null
function config(): Config | null {
  try {
    const c = CONFIG_FILE.safeParse(JSON.parse(fs.readFileSync(CONFIG(), "utf8")))
    return c.success ? { file: c.data.file, key: c.data.key ?? null } : null
  } catch { return null }
}

const SETUP = `the user sets it up in the desktop app on ${HERE} (an Agents container's menu, Passwords for agents)`
/** The file, opened now (KeeShare may have just written it). Its errors say what's wrong, never a value. */
async function database(): Promise<Database> {
  const c = config()
  if (!c) throw new Error(`no passwords for agents on ${HERE}: ${SETUP}`)
  let data: Buffer
  try { data = fs.readFileSync(c.file) } catch { throw new Error(`the agents' passwords file isn't there (${path.basename(c.file)}): ${SETUP}`) }
  let password: string
  if (c.key === null) {
    if (held?.file !== c.file) throw new Error(`the agents' passwords file is locked since the app started (${HERE} has no keyring to keep its password): the user types it again in Passwords for agents`)
    password = held.password
  } else {
    try { password = safeStorage.decryptString(Buffer.from(c.key, "base64")) } catch { throw new Error(`${KEYRING} didn't give the file's password: ${SETUP}`) }
  }
  const { openDatabase } = await keepass()
  try { return await openDatabase(data, password) } catch (e) { throw new Error(`the agents' passwords file doesn't open (${messageOf(e)}): ${SETUP}`) }
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

// ---------- the user's passkeys, this computer's: encrypted with the keyring's key, so only the app adds one ----------

const PASSKEYS = () => path.join(app.getPath("userData"), "agent-approvals.bin")
let heldPasskeys: Passkey[] = []
function passkeys(): Passkey[] {
  if (!keyring()) return heldPasskeys
  try {
    return z.array(PASSKEY).catch([]).parse(JSON.parse(safeStorage.decryptString(fs.readFileSync(PASSKEYS()))))
  } catch { return [] }
}
function savePasskeys(list: Passkey[]) {
  if (!keyring()) { heldPasskeys = list; return tellAll({ type: "engine:logins:passkeys" }) }
  const tmp = `${PASSKEYS()}.${process.pid}.tmp`
  fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(list)), { mode: 0o600 })
  fs.renameSync(tmp, PASSKEYS())
  tellAll({ type: "engine:logins:passkeys" })
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
  if (process.platform !== "darwin") throw new Error("Touch ID confirms a new passkey, and only a Mac has it: here agents log in only with entries tagged agent-free")
  if (!systemPreferences.canPromptTouchID()) {
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
  const created = CREATED.safeParse(given)
  if (!created.success) throw new Error("not a passkey's registration")
  const pk = register(created.data, a.challenge, String(name ?? "").trim() || "A passkey")
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
const DENIED = z.object({ deny: z.literal(true) })
serve("agent:login-answer", (_win, id, given) => {
  const g = grantFor(id)
  if (g.state !== "waiting") throw new Error(`it was ${g.state} already`)
  if (DENIED.safeParse(given).success) { decide(g, "denied"); return { state: g.state } }
  // (one answer per challenge: a replayed one finds none)
  const challenge = g.challenge
  g.challenge = null
  if (!challenge) throw new Error("load the approval page again")
  const asserted = ASSERTED.safeParse(given)
  if (!asserted.success) throw new Error("not a passkey's answer")
  const keys = passkeys()
  const { passkey, counter } = verify(asserted.data, keys, challenge)
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
  const kept = c.key === null ? { held: true } : {}
  if (c.key === null && held?.file !== c.file) return { file: c.file, ...kept, locked: true, error: "locked since the app started: type its password again" }
  try {
    const db = await database()
    return { file: c.file, ...kept, entries: db.entries.length, free: db.entries.filter((e) => e.free).length }
  } catch (e) { return { file: c.file, ...kept, error: messageOf(e) } }
})
handle("logins:choose", async (win) => {
  const r = await dialog.showOpenDialog(win, { title: "Passwords for agents", buttonLabel: "Choose", properties: ["openFile"], filters: [{ name: "KeePass", extensions: ["kdbx"] }] })
  return r.canceled ? null : r.filePaths[0] ?? null
})
// (the password comes from the app's own page, never the server: it's opened once to check it, then kept encrypted;
// what's wrong is answered, for the page to say)
handle("logins:set", async (_win, file, password) => {
  if (typeof file !== "string" || !path.isAbsolute(file) || typeof password !== "string" || !password) throw new Error("give a KeePass file and its password")
  let data: Buffer
  try { data = fs.readFileSync(file) } catch { return { error: "the file can't be read" } }
  let db: Database
  try { db = await (await keepass()).openDatabase(data, password) } catch (e) { return { error: messageOf(e) } }
  const kept = keyring()
  const tmp = `${CONFIG()}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ file, key: kept ? safeStorage.encryptString(password).toString("base64") : null }), { mode: 0o600 })
  fs.renameSync(tmp, CONFIG())
  held = kept ? null : { file, password }
  approvals.clear()
  grants.clear()
  return { file, ...(kept ? {} : { held: true }), entries: db.entries.length, free: db.entries.filter((e) => e.free).length }
})
handle("logins:forget", () => {
  fs.rmSync(CONFIG(), { force: true })
  held = null
  approvals.clear()
  grants.clear()
})

// ---------- the call ----------

const OPTS = z.object({ entry: z.unknown().optional(), submit: z.unknown().optional() }).catch({})
type Opts = z.infer<typeof OPTS>
const shown = (e: Entry) => ({ id: e.id, title: e.title, username: e.username })
const named = (e: Entry) => (e.username ? `${e.title} (${e.username})` : e.title)

async function login(p: EnginePage, o: Opts, who: By) {
  const url = p.wc.getURL(), host = new URL(url).host
  const log = (result: string, e?: Entry, approved?: string) => void record(p, who, { action: "login", value: e ? named(e) : "", site: host, result, ...(approved ? { approved } : {}) })
  const db = await database()
  const { entriesFor, nearlyFor } = await keepass()
  const all = entriesFor(db, url)
  if (!all.length) {
    log("no entry")
    const near = nearlyFor(db, url)
    if (near.length) {
      const here = new URL(url).hostname
      throw new Error(`no login for ${here}: ${near.map((x) => `${named(x.entry)} is for ${x.url}`).join(", ")}. The user adds ${here} to its addresses in KeePassXC (or *.${near[0].domain}, for every subdomain), or signs in themselves (browser ask)`)
    }
    throw new Error(`no login for ${host} in the agents' passwords: the user adds one to the Agents group, or signs in themselves (browser ask)`)
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
    log(`failed: ${messageOf(err)}`, e, approved)
    throw err
  }
}

async function fill(p: EnginePage, e: Entry, db: Database, o: Opts, who: By, approved: string) {
  const url = p.wc.getURL(), host = new URL(url).host
  const s = db.secrets(e.id)
  if (!s) throw new Error(`${named(e)} is gone from the agents' passwords`)
  const filled = await fillLogin(p, e, s, { submit: o.submit === true, started: () => acting(p, who, `logging in to ${host}`) })
  const r = await settle(p, url)
  void record(p, who, { action: "login", value: named(e), site: host, result: `filled the ${filled.join(" and ")}${o.submit === true ? ", submitted" : ""}`, approved })
  return { status: "filled", ...r, site: host, entry: shown(e), filled, submitted: o.submit === true, approved }
}

// (the server's call: for an entry that needs the user's yes, it tells them (the Inbox) and waits (agent:login-wait))
serve("agent:login", (_win, tab, opts, by) => login(pageFor(tab, "act", BY.parse(by)), OPTS.parse(opts), BY.parse(by)))
