// Agents logging in with the user's passwords for agents (electron/browser/logins.ts), end to end in the desktop app on
// a throwaway vault, against a made-up site served here and a made-up agents.kdbx written here: the app fills username,
// password and a one-time code (a box per digit too) and the site gets them; an entry needs the user's yes through the
// Inbox unless tagged agent-free; several entries are picked by name; a site with none says so. Then every way an agent
// reads a page tries to get the filled password (snapshot, read, evaluate, run, wait, act's diff, copying, screenshot,
// pdf, tabs, a revealed field, a GET form putting it in the address) and gets nothing; nor do the runs kept on the Mac,
// the vault or the server's files. A script run in a page stops a login there till it loads again.
// WRITES: the throwaway vault only.
//   node web/qa/agentlogins.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"
import { totp, otpOf } from "../../electron/browser/keepass.ts"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-logins-"))

// ---------- a made-up agents.kdbx ----------
const { Credentials, Kdbx, ProtectedValue } = await import("kdbxweb")
const DB_PASSWORD = "made-up database password"
const SECRET = "Q7-lantern!pw word", ADMIN = "Harbor-admin-pw-42", HARBOR = "Harbor-pw-31"
const SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
const db = Kdbx.create(new Credentials(ProtectedValue.fromString(DB_PASSWORD)), "Agents")
const add = (title, user, pw, url, tags = [], more = {}) => {
  const e = db.createEntry(db.getDefaultGroup())
  e.fields.set("Title", title); e.fields.set("UserName", user); e.fields.set("Password", ProtectedValue.fromString(pw)); e.fields.set("URL", url)
  for (const [k, v] of Object.entries(more)) e.fields.set(k, ProtectedValue.fromString(v))
  e.tags = tags
}

// ---------- the made-up site: a sign-in, then a one-time code ----------
const saw = []
const page = (title, body) => `<!doctype html><title>${title}</title>${body}`
const handler = (req, res) => {
  const u = new URL(req.url ?? "/", "http://x")
  let body = ""
  req.on("data", (c) => { body += c })
  req.on("end", () => {
    const form = new URLSearchParams(body)
    res.setHeader("Content-Type", "text/html; charset=utf-8")
    if (u.pathname === "/login") return res.end(page("Sign in", `<h1>Sign in</h1><form method="post" action="/session">
<label>Username <input name="username" autocomplete="username"></label><label>Password <input id="pw" name="password" type="password" autocomplete="current-password"></label>
<button type="button" id="show">Show password</button><button>Sign in</button></form><p id="echo"></p>
<script>show.onclick = () => { pw.type = pw.type === "password" ? "text" : "password"; document.title = "Sign in " + pw.value; echo.textContent = "You typed " + pw.value }</script>`))
    if (u.pathname === "/session") {
      saw.push({ user: form.get("username"), password: form.get("password") })
      if (form.get("password") !== SECRET) { res.statusCode = 401; return res.end(page("Wrong", "<h1>Wrong password</h1>")) }
      res.statusCode = 303; res.setHeader("Location", "/otp"); return res.end()
    }
    if (u.pathname === "/otp") return res.end(page("Code", `<h1>Two-step</h1><form method="post" action="/verify"><label>Code <input name="code" autocomplete="one-time-code" inputmode="numeric"></label><button>Verify</button></form>`))
    if (u.pathname === "/split") return res.end(page("Code", `<h1>Enter the code</h1><form method="post" action="/verify">${[0, 1, 2, 3, 4, 5].map((i) => `<input name="d${i}" maxlength="1" aria-label="Digit ${i + 1}">`).join("")}<button>Verify</button></form>`))
    if (u.pathname === "/verify") {
      const code = form.get("code") ?? [0, 1, 2, 3, 4, 5].map((i) => form.get(`d${i}`) ?? "").join("")
      saw.push({ code })
      return res.end(page("Home", code === totp(otpOf({ otp: `otpauth://totp/x?secret=${SEED}` }), Date.now()) ? "<h1>Welcome alice</h1>" : "<h1>Wrong code</h1>"))
    }
    if (u.pathname === "/login-get") return res.end(page("Sign in", `<form method="get" action="/after"><input name="user" autocomplete="username"><input name="pw" type="password"><button>Go</button></form>`))
    if (u.pathname === "/after") return res.end(page("Signed in", "<h1>Signed in</h1>"))
    if (u.pathname === "/other") return res.end(page("Other", "<h1>Another page</h1>"))
    res.end(page("Lighthouse", "<h1>Lighthouse</h1>"))
  })
}
const listen = async () => { const s = http.createServer(handler); await new Promise((ok) => s.listen(0, "127.0.0.1", ok)); return s }
const site = await listen(), elsewhere = await listen()
const PORT = site.address().port
const SITE = `http://127.0.0.1:${PORT}`, LOCAL = `http://localhost:${PORT}`, NONE = `http://127.0.0.1:${elsewhere.address().port}`

add("Lighthouse", "alice", SECRET, SITE, ["agent-free"], { otp: `otpauth://totp/Lighthouse:alice?secret=${SEED}` })
add("Harbor", "alice@example.com", HARBOR, LOCAL)
add("Harbor admin", "admin", ADMIN, LOCAL)
const DB = path.join(TMP, "agents.kdbx")
fs.writeFileSync(DB, Buffer.from(await db.save()))

// ---------- the app ----------
const plugins = path.join(VAULT, ".vaultite/plugins.json")
const on = fs.existsSync(plugins) ? JSON.parse(fs.readFileSync(plugins, "utf8")) : { enabled: [], disabled: [] }
fs.writeFileSync(plugins, JSON.stringify({ ...on, enabled: [...new Set([...(on.enabled ?? []), "web-viewer", "inbox"])], disabled: (on.disabled ?? []).filter((x) => x !== "inbox") }))
const USER_DATA = path.join(TMP, "userData"), LOCAL_DIR = path.join(TMP, "local")
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: USER_DATA, VAULTITE_LOCAL: LOCAL_DIR },
})
let output = ""
app.process().stdout?.on("data", (d) => { output += d })
app.process().stderr?.on("data", (d) => { output += d })
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1400, height: 860 }) })
/** A browser op, as an agent calls it: its answer, or { error }. */
const op = async (id, params) => {
  const r = await fetch(`${origin}/api/ops/web-viewer.${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "mcp", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params ?? {}) })
  const j = await r.json().catch(() => ({}))
  return r.ok ? (j.result ?? j) : { error: j.error ?? r.status, status: r.status }
}
const engine = (name, ...args) => win.evaluate(([n, a]) => window.vaultite.web.engine(n, ...a), [name, args])
await wait(2000)

// ---------- setting it up (as the container menu's Passwords for agents does) ----------
check("no passwords for agents yet", (await engine("logins:status")) === null)
const early = await op("open", { url: `${SITE}/login` })
const unset = await op("login", { tab: early.tab })
check("a login before it's set up says how", /no passwords for agents on this Mac/.test(String(unset.error)), unset)
const wrongPw = await engine("logins:set", DB, "not it")
check("a wrong password for the file is said, plainly", /password doesn't open it/.test(wrongPw?.error ?? "") && (await engine("logins:status")) === null, wrongPw)
const set = await engine("logins:set", DB, DB_PASSWORD)
check("the file and its password are set: its entries counted", set?.entries === 3 && set?.free === 1, set)
const status = await engine("logins:status")
check("its status: the file, its entries", status?.file === DB && status?.entries === 3, status)
const kept = fs.readFileSync(path.join(USER_DATA, "agent-logins.json"), "utf8")
check("the file's password is kept encrypted, never as is", !kept.includes(DB_PASSWORD) && JSON.parse(kept).file === DB, kept.slice(0, 80))

// ---------- a free entry: username and password, then the one-time code ----------
const t = early.tab
const filled = await op("login", { tab: t })
check("login fills the username and password, answering no value", filled?.status === "filled" && filled.filled?.join() === "username,password" && !JSON.stringify(filled).includes(SECRET), filled)
check("… from the agent-free entry, with no ask", /free/.test(filled?.approved ?? ""), filled?.approved)

// ---------- every way to read the filled password back ----------
const FORMS = [SECRET, encodeURIComponent(SECRET), new URLSearchParams([["pw", SECRET]]).toString().slice(3), SECRET.slice(0, 8)]
/** Whether an answer has the password, or its first characters, in any form. */
const has = (x) => { const s = JSON.stringify(x ?? null); return FORMS.some((f) => s.includes(f) || s.includes(JSON.stringify(f).slice(1, -1))) }
const snap = await op("snapshot", { tab: t })
check("snapshot: the password field shows no value, nor its length", !has(snap) && /textbox "Password" \[ref=e\d+\](: •••)?$/m.test(snap?.snapshot ?? ""), snap?.snapshot)
check("snapshot: the username the app filled shows (not a secret)", /textbox "Username" \[ref=e\d+\]: alice/.test(snap?.snapshot ?? ""), snap?.snapshot)
check("read: nothing of it", !has(await op("read", { tab: t })), null)
const ev = await op("evaluate", { tab: t, expression: "[...document.querySelectorAll('input')].map((i) => i.value)" })
check("evaluate: refused while the page holds it", !!ev.error && /evaluate is off/.test(String(ev.error)) && !has(ev), ev)
const ev2 = await op("evaluate", { tab: t, expression: "document.title" })
check("evaluate: refused for any expression there", !!ev2.error, ev2)
const pwRef = /textbox "Password" \[ref=(e\d+)\]/.exec(snap?.snapshot ?? "")?.[1], showRef = /button "Show password" \[ref=(e\d+)\]/.exec(snap?.snapshot ?? "")?.[1]
const copy = await op("act", { tab: t, action: "press", ref: pwRef, key: "Meta+c" })
check("copying out of the page: refused", /no copying/.test(String(copy.error)), copy)
const cut = await op("act", { tab: t, action: "press", ref: pwRef, key: "Control+x" })
check("… cutting too", /no copying/.test(String(cut.error)), cut)
const shown = await op("act", { tab: t, action: "click", ref: showRef })
check("revealing the field (the page's Show password): act's diff has nothing of it", !shown.error && !has(shown), shown)
check("… nor a snapshot", !has(await op("snapshot", { tab: t })), null)
check("… nor read", !has(await op("read", { tab: t })), null)
const run = await op("run", { tab: t, script: `const s = await snapshot(); const r = await read(); let w = "found"; try { await wait({ text: ${JSON.stringify(SECRET.slice(0, 6))}, timeout: 1 }) } catch (e) { w = e.message }
  return { s, r, w, ref: await ref(${JSON.stringify(SECRET)}) }` })
check("… nor a script's snapshot, read, wait and ref (run)", !run.error && !has(run) && !/^found$/.test(JSON.parse(run.value ?? "{}").w ?? "found") && JSON.parse(run.value ?? "{}").ref === null, run)
const tabs = await op("tabs")
check("… nor the tabs' titles (the page put it in its own)", Array.isArray(tabs) && tabs.some((x) => x.tab === t && /Sign in •••/.test(x.title)) && !has(tabs), tabs)
const shot = await op("screenshot", { tab: t })
check("… a screenshot is refused while the page shows it", /no picture of it now/.test(String(shot.error)), shot)
const pdf = await op("pdf", { tab: t })
check("… a PDF too", /no picture of it now/.test(String(pdf.error)), pdf)
const oracle = await op("wait", { tab: t, text: SECRET.slice(0, 8), timeout: 1 })
check("… wait --text is no oracle for it", !!oracle.error, oracle)
const copy2 = await op("act", { tab: t, action: "press", ref: pwRef, key: "Meta+c" })
check("… copying it, shown, refused", /no copying/.test(String(copy2.error)), copy2)
await op("act", { tab: t, action: "click", ref: showRef })

const sent = await op("act", { tab: t, action: "press", ref: pwRef, key: "Enter" })
check("submitted: the site got the username and password", sent?.url?.endsWith("/otp") && saw.at(-1)?.user === "alice" && saw.at(-1)?.password === SECRET, [sent, saw.length])
const code = await op("login", { tab: t, submit: true })
check("on the page asking for a code: the app fills the one-time code and submits", code?.status === "filled" && code.filled?.join() === "one-time code" && code.submitted
  && /Welcome alice/.test((await op("read", { tab: t }))?.text ?? ""), [code, saw.at(-1)])
check("… the code isn't in what it answered", !JSON.stringify(code).includes(saw.at(-1)?.code ?? "none"), code)
const ok = await op("evaluate", { tab: t, expression: "document.title" })
check("a new page, nothing filled in it: evaluate works again", ok?.value === '"Home"', ok)

const split = await op("navigate", { tab: t, to: `${SITE}/split` })
const splitIn = await op("login", { tab: t, submit: true })
check("a code split in a box per digit: each gets its digit", splitIn?.status === "filled" && /Welcome alice/.test((await op("read", { tab: t }))?.text ?? ""), [split, splitIn, saw.at(-1)])

// ---------- a GET form puts the password in the address: still never seen (in Work, which agents may act in too) ----------
await fetch(`${origin}/api/config/plugin/web-viewer`, { method: "PATCH", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ containers: [{ id: "agents", name: "Agents", color: "purple", agents: "act" }, { id: "work", name: "Work", color: "orange", agents: "act" }] }) })
const w = await until(async () => { const o = await op("open", { url: `${SITE}/login-get`, container: "work" }); return o.tab ? o : null }, 15000)
const got = await op("login", { tab: w?.tab, submit: true })
check("a GET form: filled and sent", got?.status === "filled" && got.url?.includes("/after?"), got)
check("… its address has the password in it, scrubbed in the answer", !has(got) && /pw=•••/.test(got?.url ?? ""), got?.url)
check("… and in tabs, read and wait --url", !has(await op("tabs")) && !has(await op("read", { tab: w?.tab })) && !!(await op("wait", { tab: w?.tab, url: encodeURIComponent(SECRET).slice(0, 10), timeout: 1 })).error, null)
const evGet = await op("evaluate", { tab: w?.tab, expression: "location.href" })
check("… evaluate refused there: its address holds it", /its address has a secret/.test(String(evGet.error)), evGet)

// ---------- a script run in the page first: no login till it loads again ----------
await op("navigate", { tab: t, to: `${SITE}/login` })
const ran = await op("evaluate", { tab: t, expression: "(document.addEventListener('input', (e) => { window.caught = e.target.value }, true), 1)" })
check("an agent's script listening in the sign-in page", ran?.value === "1", ran)
const refused = await op("login", { tab: t })
check("… the app won't fill there till it loads again", /load this one again/.test(String(refused.error)), refused)
const caught = await op("evaluate", { tab: t, expression: "window.caught ?? null" })
check("… so its listener caught nothing", caught?.value === "null", caught)
await op("navigate", { tab: t, to: "reload" })
check("reloaded: the login fills", (await op("login", { tab: t }))?.status === "filled", null)
// (a page restored from Chromium's back/forward cache would bring an agent's listener back: Electron has none)
await op("navigate", { tab: t, to: `${SITE}/other` })
await op("evaluate", { tab: t, expression: "(window.mark = 1)" })
await op("navigate", { tab: t, to: `${SITE}/` })
await op("navigate", { tab: t, to: "back" })
const restored = await op("evaluate", { tab: t, expression: "typeof window.mark" })
check("going back loads the page anew (no back/forward cache): a script's state is gone", restored?.value === '"undefined"', restored)

// ---------- several entries, the user's yes, a no, and a site with none ----------
const h = (await op("open", { url: `${LOCAL}/login`, task: "harbor" })).tab
const many = await op("login", { tab: h })
check("a site with two entries: their titles and usernames, to pick", many?.status === "choose" && many.entries?.map((e) => e.title).sort().join() === "Harbor,Harbor admin" && !has(many) && !JSON.stringify(many).includes(HARBOR), many)
const inbox = () => fetch(`${origin}/api/inbox/events?local=1`).then((r) => r.json()).then((j) => j.events ?? [])
const answer = (id, a) => fetch(`${origin}/api/inbox/events/${encodeURIComponent(id)}/answer`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "X-Vaultite-Client": "app/qa" }, body: JSON.stringify({ answer: a }) })
const asking = op("login", { tab: h, entry: "alice@example.com", task: "harbor" })
const ask = await until(async () => (await inbox()).find((e) => e.source === "browser" && e.kind === "waiting" && /log in to localhost/.test(e.title)), 15000)
check("an entry not tagged agent-free: the user is asked in the Inbox, naming the site and entry, no secret", !!ask && /Harbor \(alice@example.com\)/.test(ask.body) && !JSON.stringify(ask).includes(HARBOR), ask)
const answered = await answer(ask?.id, "approve")
const approved = await asking
check("their yes: it fills", answered.ok && approved?.status === "filled" && /Inbox/.test(approved.approved ?? ""), approved)
check("… and the ask leaves the Inbox", !(await inbox()).some((e) => e.id === ask?.id && !e.answer), null)
await op("navigate", { tab: h, to: "reload" })
const again = await op("login", { tab: h, entry: "Harbor", task: "harbor" })
check("their yes lasts: the same entry fills again without asking", again?.status === "filled", again)
const denying = op("login", { tab: h, entry: "admin", task: "harbor" })
const ask2 = await until(async () => (await inbox()).find((e) => e.source === "browser" && e.kind === "waiting" && /Harbor admin/.test(e.body ?? "") && !e.answer), 15000)
await answer(ask2?.id, "deny")
const denied = await denying
check("their no: refused, nothing filled", /said no/.test(String(denied.error)), denied)
const none = await op("open", { url: `${NONE}/login` })
const noEntry = await op("login", { tab: none.tab })
check("a site with no entry (another port: another site) says so", /no entry for 127\.0\.0\.1:\d+/.test(String(noEntry.error)), noEntry)

// ---------- nothing kept anywhere has it ----------
/** Every file under `dir` (none when it isn't there); one that can't be read (a socket, a dangling link) left out alone. */
const files = (dir) => { try { return fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, String(f))).filter((f) => { try { return fs.statSync(f).isFile() } catch { return false } }) } catch { return [] } }
const leaks = (dir) => files(dir).filter((f) => { const b = fs.readFileSync(f); return [...FORMS.slice(0, 3), HARBOR, ADMIN].some((s) => b.includes(s)) })
const runs = path.join(USER_DATA, "agent-runs")
const steps = files(runs).filter((f) => f.endsWith("steps.jsonl")).map((f) => fs.readFileSync(f, "utf8")).join("")
check("each login is kept with the agent's steps: site, entry, result and who approved", /"action":"login"[^\n]*"site":"127\.0\.0\.1:\d+"[^\n]*"result":"filled the username and password"[^\n]*"approved":"free/.test(steps)
  && /"result":"denied by the user"/.test(steps) && /"approved":"the user, in the Inbox"/.test(steps), steps.split("\n").filter((l) => l.includes("login")).slice(0, 4))
check("no secret in the agents' runs (steps and pictures)", files(runs).length > 2 && !leaks(runs).length, leaks(runs))
const visits = await engine("history:list", { limit: 500 }).catch(() => null)
const hist = files(USER_DATA).filter((f) => /web-history\.sqlite/.test(f))
check("nor the browser's history (the GET form's address isn't kept, nor a title showing it)", JSON.stringify(visits ?? "").includes("/login-get") && !has(visits)
  && hist.length > 0 && !leaks(USER_DATA).some((f) => hist.includes(f)), [hist, JSON.stringify(visits ?? "").slice(0, 300)])
check("no secret in the vault, nor the server's own files", files(VAULT).length > 10 && files(LOCAL_DIR).length > 0 && !leaks(VAULT).length && !leaks(LOCAL_DIR).length, [...leaks(VAULT), ...leaks(LOCAL_DIR)])
check("no secret in the app's or the server's output", ![SECRET, HARBOR, ADMIN, DB_PASSWORD].some((s) => output.includes(s)), output.slice(-500))

console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
site.close()
elsewhere.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
