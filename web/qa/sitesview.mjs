// The Sites tab on made-up sites and accounts (the desktop app's web:sites answered by the script): who's signed in
// leads each container, with the sites always opened there; the rest and the trackers fold away behind one line; a login
// that covers other sites (Google's, YouTube) is one row, and signing out of it signs out of both; the filter keeps only
// what matches; the address bar's container menu names who's signed in to the page's site in each container.
// WRITES: the throwaway vault only.
//   node web/qa/sitesview.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-sitesview-"))
fs.mkdirSync(path.join(VAULT, ".vaultite/plugins/web-viewer"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite/plugins/web-viewer/data.json"), JSON.stringify({ containers: [
  { id: "personal", name: "Personal", color: "blue", sites: ["youtube.com"] },
  { id: "work", name: "Work", color: "orange", sites: ["linear.app"] },
] }))
const H = 3600_000, now = Date.now()
const visited = ["nytimes.com", "wikipedia.org", "stackoverflow.com", "amazon.com", "notion.so", "vercel.com"]
const FIX = {
  "c-personal": [
    { site: "google.com", account: "alice.park@example.com", more: ["studio@example.com"], with: ["youtube.com"], last: now - H },
    { site: "github.com", account: "alicepark", last: now - 3 * H },
    ...visited.map((site, i) => ({ site, last: now - (i + 2) * 5 * H })),
    { site: "doubleclick.net", other: true }, { site: "criteo.com", other: true },
  ],
  "c-work": [{ site: "github.com", account: "alice-lighthouse", last: now - 2 * H }, { site: "zoom.us", last: now - 9 * H }],
}

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
// (the sites each set of logins answers, and what Sign out asks to forget)
await app.evaluate(({ BaseWindow, ipcMain }, fix) => {
  const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 860 }); w.focus()
  globalThis.forgot = []
  ipcMain.removeHandler("web:sites")
  ipcMain.handle("web:sites", (_e, prof) => (fix[prof] ?? []).filter((s) => !globalThis.forgot.includes(`${prof} ${s.site}`)))
  ipcMain.removeHandler("web:forget")
  ipcMain.handle("web:forget", (_e, prof, site) => { globalThis.forgot.push(`${prof} ${site}`) })
}, FIX)
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
await ui({ action: "command", id: "web:sites-tab" })
const personal = win.locator("[data-web-logins-section=personal]")
await until(async () => (await personal.locator("[data-web-site]").count()) > 0, 15000)

const rows = () => personal.locator("[data-web-site]:visible").evaluateAll((els) => els.map((e) => e.getAttribute("data-web-site")))
check("accounts lead, then the site always opened there (in Google's row: YouTube)", JSON.stringify((await rows()).slice(0, 2)) === JSON.stringify(["google.com", "github.com"]), await rows())
const google = personal.locator("[data-web-site='google.com']")
check("… one row for Google and YouTube, with the account and how many more", /google\.com, youtube\.com/.test(await google.innerText()) && /alice\.park@example\.com/.test(await google.innerText())
  && (await google.locator("[data-web-more-accounts='1']").count()) === 1, await google.innerText())
check("… and its always-open pin (YouTube's)", (await google.locator("[data-web-always]").count()) === 1)
check("the rest fold behind one line: 6 more sites, 2 trackers", (await personal.locator("[data-web-more='6']").count()) === 1 && (await rows()).length === 2
  && (await personal.locator("[data-web-trackers]").count()) === 0, await personal.innerText())
await personal.locator("[data-web-more]").click()
check("… unfolded: the latest visited first, then the trackers' line", await until(async () => (await rows()).length === 8, 3000)
  && (await rows())[2] === "nytimes.com" && (await personal.locator("[data-web-trackers='2']").count()) === 1, await rows())
const work = win.locator("[data-web-logins-section=work]")
check("a container with a few sites shows them all, its always-open site with them", await until(async () => (await work.locator("[data-web-site]").count()) === 3, 5000)
  && (await work.locator("[data-web-more]").count()) === 0 && (await work.locator("[data-web-site='linear.app'] [data-web-always]").count()) === 1, await work.innerText())
check("the heading counts accounts and sites", /1 account · 1 site/.test(await work.locator("[data-web-logins-heading]").innerText()), await work.locator("[data-web-logins-heading]").innerText())

await win.locator("[data-web-sites-view] input[type=search]").fill("alice-light")
check("filter: only the containers with a match, only what matches", await until(async () => (await personal.count()) === 0 && (await work.locator("[data-web-site]").count()) === 1, 3000),
  await win.locator("[data-web-sites-view]").innerText())
await win.locator("[data-web-sites-view] input[type=search]").fill("")

// Sign out of Google's row: both sites.
await google.hover()
await google.locator("[data-row-more]").click()
await win.locator("[role=menuitem]", { hasText: /^Sign out/ }).click()
const dialog = win.locator("dialog[open]")
check("Sign out names both sites", await until(async () => /google\.com and youtube\.com/.test(await dialog.innerText().catch(() => "")), 5000), await dialog.innerText().catch(() => ""))
await dialog.locator("button", { hasText: "Sign out" }).click()
const forgot = () => app.evaluate(() => globalThis.forgot)
check("… it signs out of both, and the row goes", await until(async () => (await forgot()).length === 2 && (await google.count()) === 0, 5000), await forgot())

// The container menu, on a page of github.com in Work: who's signed in there in each container.
await ui({ action: "open", path: "view:web/@work/https://github.com/", newTab: true })
const chip = win.locator("[data-web-page] [data-web-container='work']:visible")
await until(async () => (await chip.count()) === 1, 15000)
await chip.hover()
await wait(800)
await chip.click()
const items = () => win.locator("[role^=menuitem]").evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ""))
check("the container menu names each container's account for the site", await until(async () => {
  const it = await items()
  return it.some((t) => t.startsWith("Personal") && t.includes("alicepark")) && it.some((t) => t.startsWith("Work") && t.includes("alice-lighthouse"))
}, 5000), await items())
await win.keyboard.press("Escape")

await app.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
