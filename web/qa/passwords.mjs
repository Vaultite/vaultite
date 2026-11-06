// Your passwords (electron/browser/passwords.ts), end to end in the desktop app on a throwaway vault, against a made-up
// main KeePass file written here with an Agents group KeePassXC exports (KeeShare) to a made-up agents.kdbx: set up,
// locked till unlocked, edits saved into the file (its old copy kept) and the export rewritten, so an agent logs in with
// what changed at once and its use is listed; then an agent's `vau secret` answered from the passwords, or kept there.
// WRITES: the throwaway vault only.
//   node web/qa/passwords.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-passwords-"))
const { Credentials, Kdbx, ProtectedValue } = await import("kdbxweb")
const { loadKdbx, openDatabase } = await import("../../electron/browser/keepass.ts")

// ---------- a made-up site, and a made-up main file whose Agents group is exported ----------
const page = (title, body) => `<!doctype html><title>${title}</title>${body}`
const site = http.createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.end(page("Sign in", `<form method="post" action="/session"><input name="username" autocomplete="username"><input name="password" type="password"><button>Sign in</button></form>`))
})
await new Promise((ok) => site.listen(0, "127.0.0.1", ok))
const SITE = `http://127.0.0.1:${site.address().port}`
const MAIN_PW = "made-up main password", SHARE_PW = "made-up share password", BANK = "Bank-pw-made-up-1"
const MAIN = path.join(TMP, "Main.kdbx"), SHARED = path.join(TMP, "agents.kdbx")
{
  const db = Kdbx.create(new Credentials(ProtectedValue.fromString(MAIN_PW)), "Main")
  const agents = db.createGroup(db.getDefaultGroup(), "Agents")
  const b64 = (s) => Buffer.from(s).toString("base64")
  const ref = `<?xml version="1.0"?><KeeShare><Type><Export/></Type><Group>${Buffer.from(agents.uuid.bytes).toString("base64")}</Group><Path>${b64("agents.kdbx")}</Path><Password>${b64(SHARE_PW)}</Password><KeepGroups>True</KeepGroups></KeeShare>`
  agents.customData = new Map([["KeeShare/Reference", { value: b64(ref) }]])
  const add = (group, title, user, pw, url) => {
    const e = db.createEntry(group)
    e.fields.set("Title", title); e.fields.set("UserName", user); e.fields.set("Password", ProtectedValue.fromString(pw)); e.fields.set("URL", url)
  }
  add(db.getDefaultGroup(), "Bank", "alice", BANK, "https://bank.example.com")
  add(agents, "Lighthouse", "alice", "Lighthouse-pw-1", SITE)
  fs.writeFileSync(MAIN, Buffer.from(await db.save()))
}

const plugins = path.join(VAULT, ".vaultite/plugins.json")
const on = fs.existsSync(plugins) ? JSON.parse(fs.readFileSync(plugins, "utf8")) : { enabled: [], disabled: [] }
fs.writeFileSync(plugins, JSON.stringify({ ...on, enabled: [...new Set([...(on.enabled ?? []), "web-viewer", "inbox"])], disabled: (on.disabled ?? []).filter((x) => x !== "inbox") }))
const USER_DATA = path.join(TMP, "userData")
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: USER_DATA, VAULTITE_LOCAL: path.join(TMP, "local"), VAULTITE_TEST_TOUCHID: "yes" },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
const engine = (name, ...args) => win.evaluate(([n, a]) => window.vaultite.web.engine(n, ...a), [name, args]).catch((e) => ({ thrown: String(e.message ?? e) }))
const agentOp = async (id, params) => {
  const r = await fetch(`${origin}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "cli", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params ?? {}) })
  const j = await r.json().catch(() => ({}))
  return r.ok ? (j.result ?? j) : { error: j.error ?? r.status }
}
await wait(2000)

// ---------- set up, locked, unlocked ----------
check("not set up yet", (await engine("passwords:status")) === null)
const wrong = await engine("passwords:set", MAIN, "not it")
check("a wrong password is said plainly, nothing set", /doesn't open it/.test(wrong?.error ?? "") && (await engine("passwords:status")) === null, wrong)
const set = await engine("passwords:set", MAIN, MAIN_PW)
check("set up: unlocked at once", set?.file === MAIN && set.locked === false, set)
const conf = fs.readFileSync(path.join(USER_DATA, "passwords.json"), "utf8")
check("its password is never kept as is", !conf.includes(MAIN_PW), conf.slice(0, 60))
await engine("passwords:lock")
const locked = await engine("passwords:list")
check("locked: the list refuses", /locked/.test(locked?.thrown ?? ""), locked)
check("a wrong password doesn't unlock", !!(await engine("passwords:unlock", "nope"))?.error)
check("the right one unlocks", (await engine("passwords:unlock", MAIN_PW))?.ok === true)
await engine("passwords:lock")
check("Touch ID unlocks (a test's stand-in)", (await engine("passwords:unlock"))?.ok === true)

// ---------- edits reach the file and agents' export ----------
const list = await engine("passwords:list")
const light = list?.entries?.find((e) => e.title === "Lighthouse"), bank = list?.entries?.find((e) => e.title === "Bank")
check("the list: every entry, which are for agents, no secret", light?.shared === true && bank?.shared === false && !JSON.stringify(list).includes(BANK), list?.entries?.map((e) => e.title))
const full = await engine("passwords:get", bank?.id)
check("an entry's password, shown on asking", full?.password === BANK, full?.title)
const saved = await engine("passwords:save", { id: light?.id, group: light?.group, title: "Lighthouse", username: "alice", password: "Lighthouse-pw-2", urls: [SITE], tags: ["agent-free"], notes: "" })
check("an edit saves", typeof saved?.id === "string", saved)
const reopened = await openDatabase(fs.readFileSync(MAIN), MAIN_PW)
check("… into the file itself", reopened.secrets(light?.id)?.password === "Lighthouse-pw-2")
const backups = fs.readdirSync(path.join(USER_DATA, "passwords-backups"))
const old = await openDatabase(fs.readFileSync(path.join(USER_DATA, "passwords-backups", backups[0])), MAIN_PW)
check("… its old copy kept", backups.length === 1 && old.secrets(light?.id)?.password === "Lighthouse-pw-1", backups)
const shared = await openDatabase(fs.readFileSync(SHARED), SHARE_PW)
check("… and the Agents export written as KeePassXC would: the same ids, the new password, tagged free, no Bank", shared.entries.length === 1 && shared.entries[0].id === light?.id
  && shared.entries[0].free && shared.secrets(light?.id)?.password === "Lighthouse-pw-2", shared.entries.map((e) => e.title))
const added = await engine("passwords:save", { title: "Harbor", username: "bob", password: "Harbor-pw-1", urls: ["https://harbor.example.org"], tags: [], notes: "a note" })
check("a new entry saves", (await loadKdbx(fs.readFileSync(MAIN), MAIN_PW)).getDefaultGroup().entries.some((e) => e.uuid.id === added?.id))
await engine("passwords:delete", added?.id)
const binned = await engine("passwords:list")
check("deleting moves it to the recycle bin", binned?.groups?.find((g) => g.id === binned.entries.find((e) => e.id === added?.id)?.group)?.bin === true)

// ---------- agents log in from the export, and their use is listed ----------
await engine("logins:set", SHARED, SHARE_PW)
const tab = (await agentOp("web-viewer.open", { url: `${SITE}/login` }))?.tab
const login = await agentOp("web-viewer.login", { tab })
check("an agent logs in with the edit at once (tagged free in Passwords, no ask)", login?.status === "filled" && /free/.test(login.approved ?? ""), login)
const uses = await fetch(`${origin}/api/web-viewer/login-uses`).then((r) => r.json())
check("its use is listed: which entry, which agent, where", uses?.uses?.[0]?.entry?.id === light?.id && uses.uses[0].status === "filled" && !!uses.uses[0].agent, uses?.uses?.[0])

// ---------- an agent's vau secret, answered from the passwords, or kept there ----------
const asked = agentOp("secret.ask", { prompt: "Bank password for the statement", timeout: 60 })
await win.waitForSelector("[data-secret-pick]", { timeout: 15000 })
await win.click("[data-secret-pick]")
await win.fill("[data-secret-picking] input", "bank")
await win.click("[data-secret-entry='Bank']")
await win.click("[data-confirm-ok]")
check("vau secret: given from the passwords (after the user's finger)", (await asked)?.value === BANK)
const asked2 = agentOp("secret.ask", { prompt: "Made-up API key", timeout: 60 })
await win.waitForSelector("[data-secret-keep]", { timeout: 15000 })
await win.fill("[data-confirm] input[type=password]", "key-made-up-123")
await win.check("[data-secret-keep]")
await win.click("[data-confirm-ok]")
check("vau secret: what's typed reaches the agent", (await asked2)?.value === "key-made-up-123")
const kept = await until(async () => { const l = await engine("passwords:list"); return l?.entries?.find((e) => e.title === "Made-up API key") }, 10000)
const keptGroup = (await engine("passwords:list"))?.groups?.find((g) => g.id === kept?.group)
check("… and kept in the passwords, in Secrets", keptGroup?.name === "Secrets" && (await engine("passwords:get", kept?.id))?.password === "key-made-up-123", keptGroup)

await app.close()
console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
site.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
