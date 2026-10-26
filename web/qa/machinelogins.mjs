// Another machine's logins in the Sites tab, end to end in the desktop app on a made-up site with a cookie login: the
// app plays "M1" itself (the window's asks for machine m1 are answered by its own server, as M1's would be), so the
// login really is sealed (web:seal), passed on and taken in (remote:take) by the app. "On M1" lists its sets of logins;
// a row dragged onto one of its cards, or Copy to, copies the login there, the box carrying no cookie in the clear; the
// same box twice is refused; another machine's rows only open.
// WRITES: the throwaway vault only.
//   node web/qa/machinelogins.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-machinelogins-"))

// ---------- a made-up site with a cookie login ----------
const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? "/", SITE)
  const who = /(?:^|; )who=([^;]+)/.exec(req.headers.cookie ?? "")?.[1]
  const headers = { "Content-Type": "text/html; charset=utf-8" }
  if (u.pathname === "/login") headers["Set-Cookie"] = `who=${u.searchParams.get("u")}; Path=/; Max-Age=3600`
  res.writeHead(200, headers)
  res.end(`<!doctype html><title>Who</title><p id="who">${u.pathname === "/login" ? "signed in" : `who:${who ?? "nobody"}`}</p>`)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const PORT = server.address().port
const SITE = `http://127.0.0.1:${PORT}`
fs.mkdirSync(path.join(VAULT, ".vaultite/plugins/web-viewer"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite/plugins/web-viewer/data.json"), JSON.stringify({ containers: [{ id: "work", name: "Work", color: "orange" }] }))

// ---------- the app ----------
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 900 }); w.focus() })
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const command = async (id) => { await ui({ action: "command", id }); await wait(700) }
const cookiesIn = (partition) => app.evaluate(async ({ session }, p) => (await session.fromPartition(p).cookies.get({})).map((c) => `${c.name}=${c.value}`), partition)

// "M1" is this app: its list is the server's own (local=1), its key and take go to it with no machine named.
const boxes = []
await win.route(/\/api\/web-viewer\/logins(\/key|\/take)?(\?|$)/, async (route) => {
  const u = new URL(route.request().url())
  if (u.pathname.endsWith("/logins")) {
    const r = await (await fetch(`${origin}/api/web-viewer/logins?local=1&profiles=${encodeURIComponent(u.searchParams.get("profiles") ?? "")}`)).json()
    return route.fulfill({ json: { machines: [{ machine: "m1", label: "M1", sets: r.sets ?? {} }] } })
  }
  if (u.pathname.endsWith("/key")) return route.fulfill({ response: await route.fetch({ url: `${origin}/api/web-viewer/logins/key` }) })
  const body = JSON.parse(route.request().postData() ?? "{}")
  boxes.push(body)
  return route.fulfill({ response: await route.fetch({ postData: JSON.stringify({ ...body, machine: "" }) }) })
})

// ---------- sign in, in the default logins ----------
await ui({ action: "open", path: `view:web/${SITE}/login?u=Alice` })
check("signed in to the made-up site", await until(async () => (await cookiesIn("persist:web")).includes("who=Alice"), 15000), await cookiesIn("persist:web"))

// ---------- the Sites tab: On M1 ----------
await command("web:sites-tab")
const here = (name) => win.locator("[data-web-logins-list] > section", { has: win.locator("[data-web-logins-name]", { hasText: new RegExp(`^${name}$`) }) })
const there = (name) => win.locator("[data-web-machine-logins='m1'] > section", { has: win.locator("[data-web-logins-name]", { hasText: new RegExp(`^${name}$`) }) })
const view = () => win.locator("[data-web-sites-view]").innerText().catch(() => "")
check("On M1: its sets of logins with sites, under its name", await until(async () => (await win.getByText("On M1", { exact: true }).count()) === 1
  && (await there("Default").locator("[data-web-site='127.0.0.1']").count()) === 1 && (await there("Work").count()) === 0, 15000), await view())
const theirs = there("Default").locator("[data-web-site='127.0.0.1']")
await theirs.click({ button: "right" })
const items = await win.locator("[role=menuitem]").allInnerTexts()
check("… its rows only open the site here", items.length === 1 && /^Open 127\.0\.0\.1/.test(items[0]), items)
await win.keyboard.press("Escape")

// ---------- Copy to M1's Work ----------
const mine = here("Default").locator("[data-web-site='127.0.0.1']")
await mine.click({ button: "right" })
await win.locator("[role=menuitem]", { hasText: /^Copy to/ }).hover()
await wait(400)
const copyTo = (await win.locator("[role=menu]").allInnerTexts()).join("\n---\n")
check("Copy to: this Mac's sets, then M1's", /---\nWork\s+M1\s+Default\s+Work$/.test(copyTo), copyTo)
await win.locator("[role=menu]").last().locator("[role=menuitem]", { hasText: /^Work/ }).last().click()
const copied = win.locator("[data-sonner-toast]", { hasText: "Copied 127.0.0.1 to M1 · Work" })
check("… a toast says so", await until(async () => (await copied.count()) === 1, 15000), await win.locator("[data-sonner-toast]").allInnerTexts())
check("… the login is in M1's Work, and still here", await until(async () => (await cookiesIn("persist:web-c-work")).includes("who=Alice")
  && (await cookiesIn("persist:web")).includes("who=Alice"), 10000), [await cookiesIn("persist:web-c-work"), await cookiesIn("persist:web")])
check("… On M1 lists it there", await until(async () => (await there("Work").locator("[data-web-site='127.0.0.1']").count()) === 1, 10000), await view())
check("… what the servers passed on held no cookie", boxes.length === 1 && boxes[0].to === "c-work" && !JSON.stringify(boxes[0]).includes("Alice"), boxes)

const again = await fetch(`${origin}/api/web-viewer/logins/take`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: "c-work", sealed: boxes[0].sealed }) })
check("the same box again is refused", again.status === 409 && /already/.test((await again.json()).error ?? ""), again.status)
const elsewhere = await fetch(`${origin}/api/web-viewer/logins/take`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: "", sealed: boxes[0].sealed }) })
check("a box for one set of logins doesn't open for another", elsewhere.status === 409, elsewhere.status)

// ---------- dragged onto M1's card: copied ----------
await app.evaluate(async ({ session }) => { await session.fromPartition("persist:web-c-work").clearStorageData({ storages: ["cookies"] }) })
await until(async () => (await there("Work").count()) === 0, 40000)
const a = await mine.boundingBox(), b = await there("Default").boundingBox()
await win.mouse.move(a.x + 30, a.y + a.height / 2)
await win.mouse.down()
await win.mouse.move(a.x + 34, a.y + a.height / 2 + 6, { steps: 3 })
await win.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 12 })
check("dragged over M1's card: it says it copies", await until(async () => (await win.locator("[data-web-machine='m1'][data-web-logins-taking='copy']").count()) === 1, 3000))
await win.mouse.up()
check("… dropped: copied there", await until(async () => (await win.locator("[data-sonner-toast]", { hasText: "Copied 127.0.0.1 to M1 · Default" }).count()) === 1, 15000)
  && boxes.length === 2 && boxes[1].to === "", [await win.locator("[data-sonner-toast]").allInnerTexts(), boxes.map((x) => x.to)])

console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
