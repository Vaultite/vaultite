// The Sites tab on made-up sites and accounts (the desktop app's web:sites answered by the script): who's signed in
// leads each container (a card in its colour), with the sites always opened there, a site whose login can't be named
// saying "Signed in"; the rest and the trackers fold away behind one line; a login
// that covers other sites (Google's, YouTube) is one row, and signing out of it signs out of both; the filter keeps only
// what matches; a container dragged by its heading moves everywhere it's listed; the address bar's container menu
// names who's signed in to the page's site in each container (typing gmail.com: Google's login), filling in as the
// listing answers. A login moves to another container from its menu
// (asking before it replaces one there) or dragged onto that container's card (⌥: copied), Undo takes it back, one
// whose login won't move stays; a container's sites reorder by dragging; deleting a container moves its logins first.
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
  "c-work": [{ site: "github.com", signed: true, account: "alice-lighthouse", last: now - 2 * H }, { site: "x.com", signed: true, last: now - 4 * H }, { site: "zoom.us", last: now - 9 * H }],
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
  // (`slow`: how long a listing takes to answer, as Google's account list can)
  globalThis.fix = fix; globalThis.slow = 0
  ipcMain.handle("web:sites", async (_e, prof) => {
    await new Promise((r) => setTimeout(r, globalThis.slow))
    return (fix[prof] ?? []).filter((s) => !globalThis.forgot.includes(`${prof} ${s.site}`))
  })
  ipcMain.removeHandler("web:forget")
  ipcMain.handle("web:forget", (_e, prof, site) => { globalThis.forgot.push(`${prof} ${site}`) })
  // (a move takes the row there, a copy leaves it here too; zoom.us keeps its login outside cookies: it won't move)
  globalThis.moves = []
  ipcMain.removeHandler("web:move")
  ipcMain.handle("web:move", (_e, from, to, sites, copy) => {
    globalThis.moves.push([from, to, sites.join(), copy])
    if (sites.includes("zoom.us")) return { ok: false }
    const row = (fix[from] ?? []).find((s) => s.site === sites[0])
    fix[to] = [...(fix[to] ?? []).filter((s) => s.site !== sites[0]), { ...row }]
    if (!copy) fix[from] = fix[from].filter((s) => s.site !== sites[0])
    return { ok: true }
  })
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
check("a container with a few sites shows them all, its always-open site with them", await until(async () => (await work.locator("[data-web-site]").count()) === 4, 5000)
  && (await work.locator("[data-web-more]").count()) === 0 && (await work.locator("[data-web-site='linear.app'] [data-web-always]").count()) === 1, await work.innerText())
check("its always-open site leads, then the accounts A to Z, one whose name it can't have saying so", JSON.stringify(await work.locator("[data-web-site]").evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute("data-web-site")))) === JSON.stringify(["linear.app", "github.com", "x.com"])
  && /Signed in/.test(await work.locator("[data-web-site='x.com']").innerText()), await work.innerText())
const card = await work.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, border: getComputedStyle(e).borderTopWidth }))
check("each container is a card in its colour", card.bg !== "rgba(0, 0, 0, 0)" && parseFloat(card.border) > 0, card)
const head = work.locator("[data-web-logins-heading]")
check("the heading counts accounts only", /2 accounts/.test(await head.innerText()) && !/site/.test(await head.innerText()), await head.innerText())
await head.hover()
check("… and keeps it on hover, its options beside it", await until(async () => /2 accounts/.test(await head.innerText()) && await head.locator("button").isVisible(), 3000), await head.innerText())

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

// Drag Work's heading above Personal's: the containers' order changes everywhere (their menus too).
const order = () => win.locator("[data-web-logins-section][data-slide]").evaluateAll((els) => els.map((e) => e.getAttribute("data-slide")))
const from = await head.locator("[data-web-logins-name]").boundingBox(), to = await personal.boundingBox()
await win.mouse.move(from.x + 10, from.y + from.height / 2)
await win.mouse.down()
await win.mouse.move(from.x + 14, from.y - 20, { steps: 4 })
await win.mouse.move(to.x + 40, to.y + 10, { steps: 12 })
check("dragging a container's heading, the others make way", await until(async () => (await win.locator("[data-web-logins-list][data-drop-preview]").count()) === 1, 3000))
await win.mouse.up()
const saved = () => JSON.parse(fs.readFileSync(path.join(VAULT, ".vaultite/plugins/web-viewer/data.json"), "utf8")).containers.map((c) => c.id)
check("… dropped above Personal: Work comes first, kept in the vault's settings", await until(async () => JSON.stringify(await order()) === '["work","personal"]' && saved()[0] === "work", 5000), [await order(), saved()])

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
check("… in the order they were dragged to", (await items()).findIndex((t) => t.startsWith("Work")) < (await items()).findIndex((t) => t.startsWith("Personal")), await items())
await win.keyboard.press("Escape")

// Typing gmail.com, the chip clicked at once while the listing is slow: Google's login names it (gmail.com is only
// Google's door), and a login the listing brings in after the menu opened shows in it as it answers.
await app.evaluate(() => { globalThis.slow = 1200; globalThis.fix["c-work"].push({ site: "google.com", account: "alice@lighthouse.dev" }) })
await win.locator("[data-web-page] [data-web-address]:visible").click()
await win.keyboard.press("Meta+a")
await win.keyboard.type("gmail.com")
await win.locator("[data-web-page] [data-web-container]:visible").click()
const first = await items()
check("typing gmail.com, the menu opens at once, before the slow listing answers", first.some((t) => t === "Work") && first.some((t) => /Always open gmail\.com/.test(t)), first)
check("… and names Work's Google account (gmail.com is Google's) as soon as it answers", await until(async () => (await items()).some((t) => t.startsWith("Work") && t.includes("alice@lighthouse.dev")), 5000), await items())
await win.keyboard.press("Escape")
await app.evaluate(() => { globalThis.slow = 0; globalThis.fix["c-work"] = globalThis.fix["c-work"].filter((s) => s.site !== "google.com") })
await win.locator("[data-web-page] [data-web-address]:visible").click()
await win.keyboard.press("Escape")
// (listed again without it)
await win.locator("[data-web-page] [data-web-container]:visible").hover()
await wait(500)
await ui({ action: "command", id: "web:sites-tab" })
await until(async () => (await work.isVisible()), 5000)

const data = () => JSON.parse(fs.readFileSync(path.join(VAULT, ".vaultite/plugins/web-viewer/data.json"), "utf8"))
const moves = () => app.evaluate(() => globalThis.moves.map((m) => m.join(" ")))
const top = (sec) => sec.locator("[data-web-sites-top] > [data-slide]").evaluateAll((els) => els.map((e) => e.getAttribute("data-slide")))
/** Drag a row by the mouse onto `to` (⌥ held on the way: `alt`); `over` runs while it's held there. */
async function dragRow(row, to, { alt = false, dy = 0, over } = {}) {
  const a = await row.boundingBox(), b = await to.boundingBox()
  await win.mouse.move(a.x + 30, a.y + a.height / 2)
  await win.mouse.down()
  await win.mouse.move(a.x + 34, a.y + a.height / 2 + 6, { steps: 3 })
  if (alt) await win.keyboard.down("Alt")
  await win.mouse.move(b.x + 40, b.y + (dy || b.height / 2), { steps: 12 })
  await over?.()
  await win.mouse.up()
  if (alt) await win.keyboard.up("Alt")
}

// Reorder: x.com dragged above Work's first row stays there, kept per set of logins.
await dragRow(work.locator("[data-slide='x.com']"), work.locator("[data-slide='linear.app']"), { dy: 3 })
check("a site dragged above another in its card stays there, kept in the settings", await until(async () => JSON.stringify(await top(work)) === '["x.com","linear.app","github.com"]'
  && JSON.stringify(data().siteOrder?.["c-work"]) === '["x.com","linear.app","github.com"]', 5000), [await top(work), data().siteOrder])

// Move from the menu: Personal's GitHub to Work, which has another GitHub account: it asks first.
const pGithub = personal.locator("[data-web-site='github.com']")
await pGithub.hover()
await pGithub.locator("[data-row-more]").click()
await win.locator("[role=menuitem]", { hasText: /^Move to/ }).click()
await win.locator("[role=menuitem]", { hasText: /^Work/ }).click()
check("moving onto another account there asks before replacing it", await until(async () => /Replace alice-lighthouse in Work/.test(await dialog.innerText().catch(() => "")), 5000), await dialog.innerText().catch(() => ""))
await dialog.locator("button", { hasText: "Replace" }).click()
check("… it moves: gone from Personal, Work signed in as alicepark", await until(async () => (await moves()).includes("c-personal c-work github.com false")
  && (await pGithub.count()) === 0 && /alicepark/.test(await work.locator("[data-web-site='github.com']").innerText().catch(() => "")), 8000), [await moves(), await work.innerText()])
const toast = win.locator("[data-sonner-toast]", { hasText: "Moved github.com to Work" })
check("… a toast says so, with Undo", await until(async () => (await toast.count()) === 1, 3000))
await toast.getByRole("button", { name: "Undo" }).click()
check("Undo moves it back", await until(async () => (await moves()).includes("c-work c-personal github.com false") && (await pGithub.count()) === 1, 8000), await moves())

// Drag with ⌥ onto Personal's card: copied, the card saying so while held over it.
let said = ""
await dragRow(work.locator("[data-slide='x.com']"), personal, { alt: true, over: async () => {
  await until(async () => (said = await personal.getAttribute("data-web-logins-taking") ?? "") === "copy", 3000)
} })
check("held over another card with ⌥, it says it copies there", said === "copy", said)
check("… dropped: copied, still in Work, now in Personal too", await until(async () => (await moves()).includes("c-work c-personal x.com true")
  && (await personal.locator("[data-web-site='x.com']").count()) === 1 && (await work.locator("[data-web-site='x.com']").count()) === 1, 8000), await moves())

// A site keeping its login outside cookies doesn't move: it stays, and says why.
await dragRow(work.locator("[data-slide='zoom.us']"), personal)
check("a login that won't move stays where it was, saying so", await until(async () => (await moves()).includes("c-work c-personal zoom.us false")
  && (await win.locator("[data-sonner-toast]", { hasText: "didn't stay signed in" }).count()) === 1, 8000)
  && await until(async () => (await work.locator("[data-web-site='zoom.us']:visible").count()) === 1, 5000), await moves())

// Deleting Work, signed in to x.com: its logins move first, then it goes.
await head.hover()
await head.locator("button").last().click()
await win.locator("[role=menuitem]", { hasText: /^Delete Work/ }).click()
const pick = win.locator("[role=option]", { hasText: "Move it to Personal" })
check("deleting a container signed in somewhere offers to move its logins", await until(async () => (await pick.count()) === 1, 5000))
await pick.click()
check("… one already there asks before replacing it", await until(async () => /Replace/.test(await dialog.innerText().catch(() => "")), 5000))
await dialog.locator("button", { hasText: "Replace" }).click()
check("… moved, then the container's gone", await until(async () => (await moves()).includes("c-work c-personal x.com false") && !data().containers.some((c) => c.id === "work")
  && (await work.count()) === 0, 8000), [await moves(), data().containers])

await app.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
