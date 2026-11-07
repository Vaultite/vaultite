// Your own logins in your own pages (electron/browser/userlogins.ts), end to end in the desktop app on a throwaway vault,
// against a made-up site served here and a made-up main .kdbx written here: a sign-in page shows the address bar's key,
// picking its entry unlocks the passwords (their file's password typed) and fills it; agents reading that page never see
// the password; a sign-in the passwords don't have offers to save it (a toast), and saving writes it into the file; a
// new password offers to update the entry; a filled one, a wrong one, or an agent's own sign-in offer nothing.
// WRITES: the throwaway vault only.
//   node web/qa/userlogins.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-userlogins-"))
const { Credentials, Kdbx, ProtectedValue } = await import("../../electron/browser/kdbx/index.ts")
const { openDatabase } = await import("../../electron/browser/keepass.ts")

// ---------- the made-up site: alice's and bob's sign-in (any password for bob, alice's own or her new one) ----------
const SECRET = "Q7-lantern!pw word", NEWER = "Harbor-new-pw-77", BOB = "Bob-made-up-pw-5", MAIN_PW = "made-up main password"
const page = (title, body) => `<!doctype html><title>${title}</title>${body}`
const LOGIN = page("Sign in", `<h1>Sign in</h1><form method="post" action="/session">
<label>Username <input id="user" name="username" autocomplete="username"></label><label>Password <input id="pw" name="password" type="password" autocomplete="current-password"></label>
<button>Sign in</button></form>`)
const site = http.createServer((req, res) => {
  const u = new URL(req.url ?? "/", "http://x")
  let body = ""
  req.on("data", (c) => { body += c })
  req.on("end", () => {
    res.setHeader("Content-Type", "text/html; charset=utf-8")
    if (u.pathname === "/session") {
      const f = new URLSearchParams(body), user = f.get("username"), pw = f.get("password")
      const ok = (user === "alice" && (pw === SECRET || pw === NEWER)) || (user === "bob" && !!pw)
      if (!ok) { res.statusCode = 401; return res.end(LOGIN.replace("<h1>Sign in</h1>", "<h1>Wrong password</h1>")) }
      res.statusCode = 303; res.setHeader("Location", "/home"); return res.end()
    }
    if (u.pathname === "/home") return res.end(page("Home", "<h1>Welcome</h1>"))
    res.end(LOGIN)
  })
})
await new Promise((ok) => site.listen(0, "127.0.0.1", ok))
const SITE = `http://127.0.0.1:${site.address().port}`

const MAIN = path.join(TMP, "Main.kdbx")
{
  const db = Kdbx.create(new Credentials(ProtectedValue.fromString(MAIN_PW)), "Main")
  const e = db.createEntry(db.getDefaultGroup())
  e.fields.set("Title", "Lighthouse"); e.fields.set("UserName", "alice"); e.fields.set("Password", ProtectedValue.fromString(SECRET)); e.fields.set("URL", SITE)
  fs.writeFileSync(MAIN, Buffer.from(await db.save()))
}
const entries = async () => { const db = await openDatabase(fs.readFileSync(MAIN), MAIN_PW); return db.entries.map((e) => ({ ...e, password: db.secrets(e.id)?.password })) }

// ---------- the app ----------
const plugins = path.join(VAULT, ".vaultite/plugins.json")
const on = fs.existsSync(plugins) ? JSON.parse(fs.readFileSync(plugins, "utf8")) : { enabled: [], disabled: [] }
fs.writeFileSync(plugins, JSON.stringify({ ...on, enabled: [...new Set([...(on.enabled ?? []), "web-viewer"])] }))
const USER_DATA = path.join(TMP, "userData"), LOCAL_DIR = path.join(TMP, "local")
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: USER_DATA, VAULTITE_LOCAL: LOCAL_DIR, VAULTITE_TEST_TOUCHID: "yes" },
})
let output = ""
app.process().stdout?.on("data", (d) => { output += d })
app.process().stderr?.on("data", (d) => { output += d })
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BaseWindow }) => { BaseWindow.getAllWindows()[0].setBounds({ x: 40, y: 40, width: 1400, height: 860 }) })
const engine = (name, ...args) => win.evaluate(([n, a]) => window.vaultite.web.engine(n, ...a), [name, args]).catch((e) => ({ thrown: String(e.message ?? e) }))
const op = async (id, params) => {
  const r = await fetch(`${origin}/api/ops/web-viewer.${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "mcp", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params ?? {}) })
  const j = await r.json().catch(() => ({}))
  return r.ok ? (j.result ?? j) : { error: j.error ?? r.status, status: r.status }
}
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
// (agents may act in Work: they read the user's tab there, and open pages of their own)
await fetch(`${origin}/api/config/plugin/web-viewer`, { method: "PATCH", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ containers: [{ id: "agents", name: "Agents", color: "purple", agents: "act" }, { id: "work", name: "Work", color: "orange", agents: "act" }] }) })
// (what the engine offers, heard as the window hears it)
await win.evaluate(() => { window.__offers = []; window.vaultite.web.on((m) => { if (m.type === "engine:passwords:offer") window.__offers.push(m) }) })
const offers = () => win.evaluate(() => window.__offers)
await wait(2000)

/** In the page (as the QA, not an agent): its JS, and real keys. */
const inPage = (expr) => app.evaluate(({ webContents }, [site, expr]) => {
  const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(site) && !w.getURL().startsWith("devtools"))
  return wc ? wc.executeJavaScript(expr) : null
}, [SITE, expr])
const enter = () => app.evaluate(({ webContents }, site) => {
  const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(site))
  for (const type of ["keyDown", "char", "keyUp"]) wc?.sendInputEvent({ type, keyCode: type === "char" ? "\r" : "Enter" })
}, SITE)
/** Type a sign-in in the page and send it with Enter, as a person does, once the page shows (Chromium drops keys sent
 *  before a page's first paint, as a person couldn't type there yet); it lands on `to`. */
const signIn = async (user, pw, to) => {
  await until(() => inPage(`performance.getEntriesByName("first-contentful-paint").length > 0`), 10000)
  await inPage(`user.value = ${JSON.stringify(user)}; pw.value = ${JSON.stringify(pw)}; pw.focus(); 1`)
  await enter()
  check(`(${user}'s sign-in sent)`, await until(async () => (await inPage("location.pathname")) === to, 10000), await inPage("location.pathname"))
}

// ---------- set up, then locked ----------
check("set up: your passwords file", (await engine("passwords:set", MAIN, MAIN_PW))?.file === MAIN)
await engine("passwords:lock")
check("… locked", (await engine("passwords:status"))?.locked === true)

// ---------- the key, and filling ----------
await ui({ action: "open", path: `view:web/@work/${SITE}/login`, newTab: true })
const key = await until(async () => (await win.locator("[data-web-login]").count()) > 0, 20000)
check("a sign-in page with an entry for its site: the address bar shows the key (the file locked)", !!key)
const id = (await win.evaluate(() => window.vaultite.web.list()))?.find((p) => p.url.startsWith(`${SITE}/login`))?.id
await win.click("[data-web-login]")
const item = win.locator("[role=menuitem]", { hasText: "Lighthouse" }).first()
check("its list: the site's entry, with its username", await item.isVisible().catch(() => false) && /alice/.test(await item.innerText()), await item.innerText().catch(() => ""))
await item.click()
await win.waitForSelector("[data-confirm] input[type=password]", { timeout: 10000 })
check("locked: picking it asks to unlock first", true)
await win.fill("[data-confirm] input[type=password]", MAIN_PW)
await win.click("[data-confirm-ok]")
const filled = await until(async () => { const v = await inPage("[user.value, pw.value]"); return v?.[1] ? v : null }, 15000)
check("… unlocked, it fills the username and password", filled?.[0] === "alice" && filled?.[1] === SECRET, filled && [filled[0], filled[1] === SECRET])
check("… and the passwords are unlocked", (await engine("passwords:status"))?.locked === false)

// ---------- agents reading the page see nothing of it ----------
const has = (x) => JSON.stringify(x ?? null).includes(SECRET) || JSON.stringify(x ?? null).includes(encodeURIComponent(SECRET))
const snap = await op("snapshot", { tab: id })
check("an agent's snapshot of your page: the username, never the password", !snap.error && /alice/.test(snap.snapshot ?? "") && !has(snap), snap.error ?? snap.snapshot)
check("… nor its read", !has(await op("read", { tab: id })))
const ev = await op("evaluate", { tab: id, expression: "pw.value" })
check("… its scripts are off in the page", !!ev.error && !has(ev), ev)
const shot = await op("screenshot", { tab: id })
check("… and no screenshot shows it", !has(shot), shot.error ?? "a picture")

// ---------- signing in: a filled one offers nothing; a new one offers to save ----------
await enter()
await until(async () => (await inPage("location.pathname")) === "/home", 10000)
await wait(3000)
check("signed in with what the app filled: no offer", (await offers()).length === 0, await offers())

await inPage(`location.href = "/login"; 1`)
await until(async () => (await inPage("location.pathname")) === "/login" && (await inPage("typeof pw")) === "object", 10000)
await signIn("carol", "a wrong one", "/session")
await wait(3500)
check("a wrong password (the sign-in page again): no offer", (await offers()).length === 0, await offers())

await signIn("bob", BOB, "/home")
const offer = await until(async () => (await offers())[0], 10000)
check("a sign-in your passwords don't have: offered as new, with the site and username, no password", offer?.kind === "new" && offer.username === "bob" && offer.site === "127.0.0.1"
  && !JSON.stringify(offer).includes(BOB), offer)
const toast = win.locator("[data-sonner-toast]", { hasText: "Save your login" }).first()
check("… a toast asks, without the password", await toast.isVisible().catch(() => false) && !(await toast.innerText()).includes(BOB), await toast.innerText().catch(() => ""))
await toast.locator("[data-button]").click()
const bob = await until(async () => (await entries()).find((e) => e.username === "bob"), 10000)
check("… Save adds it to the file: titled after the site, its address, its password", bob?.password === BOB && bob.title === "127.0.0.1" && bob.urls.includes(SITE), bob && { ...bob, password: bob.password === BOB })
const again = await engine("passwords:save-offer", offer?.offer)
check("… an offer is good once", !!again?.thrown, again)

// ---------- a new password for alice: offered as an update ----------
await inPage(`location.href = "/login"; 1`)
await until(async () => (await inPage("location.pathname")) === "/login" && (await inPage("typeof pw")) === "object", 10000)
await signIn("alice", NEWER, "/home")
const update = await until(async () => (await offers()).find((o) => o.username === "alice"), 10000)
check("alice's new password: offered as an update", update?.kind === "update", update)
await win.locator("[data-sonner-toast]", { hasText: "Update your password" }).first().locator("[data-button]").click()
const alice = await until(async () => { const e = (await entries()).find((x) => x.title === "Lighthouse"); return e?.password === NEWER ? e : null }, 10000)
check("… Update password changes the entry's password, no new entry", !!alice && (await entries()).length === 2, (await entries()).map((e) => e.title))

// ---------- an agent's own page: never offered ----------
const before = (await offers()).length
const mine = await op("open", { url: `${SITE}/login`, container: "work" })
const s2 = await op("snapshot", { tab: mine.tab })
const ref = (name) => new RegExp(`textbox "${name}" \\[ref=(e\\d+)\\]`).exec(s2.snapshot ?? "")?.[1]
await op("act", { tab: mine.tab, action: "fill", fields: [{ ref: ref("Username"), value: "bob" }, { ref: ref("Password"), value: "agent-typed-pw-9" }] })
await op("act", { tab: mine.tab, action: "press", ref: ref("Password"), key: "Enter" })
await wait(4000)
check("an agent signing in in its own page: no offer", (await offers()).length === before, (await offers()).slice(before))
check("… the agent's page shows no key", !(await engine("passwords:forms"))?.includes?.(mine.tab))

// ---------- nothing kept anywhere has a password ----------
const files = (dir) => { try { return fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, String(f))).filter((f) => { try { return fs.statSync(f).isFile() } catch { return false } }) } catch { return [] } }
const leaks = (dir) => files(dir).filter((f) => { const b = fs.readFileSync(f); return [SECRET, NEWER, BOB, MAIN_PW].some((s) => b.includes(s)) })
check("no password in the vault, nor the server's files", !leaks(VAULT).length && !leaks(LOCAL_DIR).length, [...leaks(VAULT), ...leaks(LOCAL_DIR)])
check("no password in the app's or the server's output", ![SECRET, NEWER, BOB, MAIN_PW].some((s) => output.includes(s)), output.slice(-500))

await app.close()
console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
site.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
