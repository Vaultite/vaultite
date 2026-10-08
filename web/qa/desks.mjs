// Workspaces as desks (plugins/core/workspaces, web/src/core/scope.ts): always a current workspace, each with its own
// pinned pages (copied from pages.json at its first change), blank new tabs, open folders and recent files, the
// Terminals panel split by workspace, the window telling the server its workspace (`vau panels`, `vau pin`), and panel
// heights. With QA_TERMINAL_IDLE_MS (the server started with the same VAULTITE_TERMINAL_IDLE_MS), also that a shell
// another workspace shows outlives the idle timeout. Runs shells and WRITES the plugin's data.json, sidebars.json,
// pages.json and plugins.json: throwaway server only.
//   node web/qa/desks.mjs <base url> <vault path> [out dir]
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { apiAt, qa, until, wait } from "./lib/qa.mjs"
import { clearWorkspaces, workspaces } from "./lib/wsfiles.mjs"
const { args: [B, VAULT, OUT = "/tmp/desks-shots/"], browser, check, watch, noErrors, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const file = (p) => path.join(VAULT, p)
const json = (p) => { try { return JSON.parse(readFileSync(file(p), "utf8")) } catch { return null } }
const data = () => workspaces(VAULT)
// The files it works with, its own (written at the start, removed at the end).
const PAGE = "Qa page.md", TOP = "Qa top.md", JOURNAL = "Notes/Qa journal.md", CHECKLIST = "Notes/Qa checklist.md"
const OWN = { [PAGE]: "# Qa page\n", [TOP]: "# Qa top\n", [JOURNAL]: "A note to open first.\n", [CHECKLIST]: "- [ ] A note to pin.\n" }
const pagesBefore = readFileSync(file(".vaultite/pages.json"), "utf8")
const pluginsBefore = existsSync(file(".vaultite/plugins.json")) ? readFileSync(file(".vaultite/plugins.json"), "utf8") : "{}\n"
const vau = (...args) => execFileSync(path.resolve("bin/vau"), args, { env: { ...process.env, VAULTITE_URL: B.replace(/\/$/, ""), VAULTITE_VAULT: VAULT }, encoding: "utf8" })
const api = apiAt(B)

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })

const LIST = "[data-workspace-list]"
const SWITCHER = "aside [data-workspace-switcher]"
const lit = () => page.$eval(SWITCHER, (e) => e.getAttribute("data-workspace-switcher")).catch(() => null)
const pick = async (n) => {
  if (!(await page.$(LIST))) await page.click(SWITCHER)
  await page.waitForSelector(LIST)
  await page.locator(`${LIST} [data-workspace='${n}']`).click()
  await until(async () => (await lit()) === String(n), 6000)
}
const tabs = () => page.$$eval("section[aria-label=Pane] [role=tab]", (els) => els.map((t) => t.innerText.trim()))
const menuItem = (name) => page.locator("[role=menuitemcheckbox], [role=menuitem]", { hasText: typeof name === "string" ? new RegExp(`^${name}$`) : name }).first()
const treeRow = (p) => page.locator(`aside [data-tree-path="${p}"]`).first()
const pins = () => page.$$eval("aside [data-pin]", (els) => els.map((e) => e.getAttribute("data-pin")))

try {
  clearWorkspaces(VAULT)
  writeFileSync(file(".vaultite/plugins.json"), JSON.stringify({ ...JSON.parse(pluginsBefore), disabled: ["backlinks"] }, null, 2) + "\n")
  writeFileSync(file(".vaultite/sidebars.json"), JSON.stringify({ left: ["search:search", "pages:pages", "terminal:sessions", "files:files"], right: [], collapsed: [] }) + "\n")
  // Its own files, whatever the vault holds: two pinned (at the top level, which the tree shows unfolded), a note to open
  // and one to pin, in Notes. pinNew off: pages that arrive with the plugins turned on above aren't pinned meanwhile.
  for (const [p, text] of Object.entries(OWN)) { mkdirSync(path.dirname(file(p)), { recursive: true }); writeFileSync(file(p), text) }
  writeFileSync(file(".vaultite/pages.json"), JSON.stringify({ pinned: [PAGE, TOP], pinNew: false }, null, 2) + "\n")

  // ---------- there always is a workspace: a new device is on 1, its tabs saved there ----------
  await page.goto(`${B}#file/${encodeURIComponent(JOURNAL)}`)
  await page.waitForSelector(SWITCHER)
  check("a new device is on workspace 1", (await lit()) === "1")
  check("...its tabs saved in workspace 1 without a click", !!(await until(() => JSON.stringify(data()[0]?.layout ?? "").includes("Qa journal"), 6000)), data())
  const ui = await until(async () => { const r = await api("GET", "ui"); return r.workspace === 1 ? r : null }, 6000)
  check("the window tells the server its workspace (GET /api/ui)", ui?.workspace === 1, ui)

  // ---------- pinned pages: each workspace's own list, pages.json's until it changes one ----------
  const VAULT_PINS = JSON.stringify([PAGE, TOP])
  await page.waitForSelector("aside [data-pin]")
  check("the vault's pages show (pages.json: the default)", JSON.stringify(await pins()) === VAULT_PINS, await pins())
  // (Notes is open by default.)
  if (!(await until(async () => (await treeRow(CHECKLIST).count()) > 0, 1500))) await treeRow("Notes").click()
  await until(async () => (await treeRow(CHECKLIST).count()) > 0, 6000)
  await treeRow(CHECKLIST).click({ button: "right" })
  check("a file's menu: just Pin (no 'to this workspace' / 'to every workspace')", (await menuItem("Pin").count()) === 1 && !(await page.locator("[role=menuitem]", { hasText: /workspace/ }).count()))
  await menuItem("Pin").click()
  check("Pin: in this workspace's list, after the vault's pages it showed", !!(await until(async () => JSON.stringify(await pins()) === JSON.stringify([PAGE, TOP, CHECKLIST]), 6000)), await pins())
  check("...its own copy in its file, pages.json untouched", !!(await until(() => data()[0]?.pinned?.join() === [PAGE, TOP, CHECKLIST].join(), 6000)) &&
    JSON.stringify(json(".vaultite/pages.json").pinned) === VAULT_PINS, [data(), json(".vaultite/pages.json")])
  await page.screenshot({ path: `${OUT}1-pins.png`, clip: { x: 0, y: 0, width: 260, height: 300 } })

  await pick(2)
  check("another workspace: the vault's pages (none of its own)", !!(await until(async () => JSON.stringify(await pins()) === VAULT_PINS, 6000)), await pins())
  // The tree's folders are the workspace's own: close Notes here, and 1 still has it open.
  await treeRow("Notes").click()
  check("...closing a folder here", !!(await until(async () => (await treeRow(CHECKLIST).count()) === 0, 6000)))
  await treeRow(TOP).click({ button: "right" })
  await menuItem("Unpin").click()
  check("Unpin there: gone from 2's list only", !!(await until(async () => JSON.stringify(await pins()) === JSON.stringify([PAGE]), 6000)) &&
    !!(await until(() => data()[1]?.pinned?.join() === PAGE, 6000)) && JSON.stringify(json(".vaultite/pages.json").pinned) === VAULT_PINS, [await pins(), data()[1]])
  const cli = vau("pages")
  check("vau pages: the window's workspace's list", /workspace 2/.test(cli) && !/(^|\s)Qa top(\.md)?(\s|$)/m.test(cli), cli)
  await pick(1)
  check("back on 1: its own list", !!(await until(async () => (await pins()).length === 3, 6000)), await pins())
  check("back on 1: its folder still open", !!(await until(async () => (await treeRow(CHECKLIST).count()) > 0, 6000)))
  await treeRow("People").click()
  check("...a folder opened here is kept in the workspace (files:open)", !!(await until(() => ["Notes", "People"].every((f) => data()[0]?.state?.["files:open"]?.includes(f)), 6000)), data()[0]?.state)

  // Reordered by dragging: the top-level page below the checklist.
  await page.locator("aside [data-panel='files:files'] [data-panel-handle]").first().click({ position: { x: 12, y: 10 } })
  await wait(600)
  const src = await page.locator(`aside [data-pin="${TOP}"]`).boundingBox()
  const dst = await page.locator(`aside [data-pin="${CHECKLIST}"]`).boundingBox()
  await page.mouse.move(src.x + 40, src.y + src.height / 2)
  await page.mouse.down()
  await page.mouse.move(src.x + 40, src.y + src.height / 2 + 8, { steps: 4 })
  await page.mouse.move(dst.x + 40, dst.y + dst.height - 3, { steps: 8 })
  await wait(200)
  await page.mouse.up()
  check("dragged within the list: reordered in this workspace's", !!(await until(() => data()[0]?.pinned?.join() === [PAGE, CHECKLIST, TOP].join(), 6000)), data()[0])
  await page.locator("aside [data-panel='files:files'] [data-panel-handle]").first().click({ position: { x: 12, y: 10 } })
  await wait(1000)

  // A file dragged from the tree doesn't move the tree under it.
  await until(async () => (await treeRow(JOURNAL).count()) > 0, 6000)
  const row0 = await treeRow(JOURNAL).boundingBox()
  await page.mouse.move(row0.x + 30, row0.y + row0.height / 2)
  await page.mouse.down()
  await page.mouse.move(row0.x + 30, row0.y + row0.height / 2 + 12, { steps: 4 })
  await wait(200)
  const row1 = await treeRow(JOURNAL).boundingBox()
  await page.keyboard.press("Escape")
  await page.mouse.up()
  check("a tree drag: the tree stays put", Math.abs(row1.y - row0.y) < 1, [row0.y, row1.y])

  // ---------- a new tab is blank (no home pages) ----------
  const before = (await tabs()).length
  await page.locator("section[aria-label=Pane] button[aria-label='New tab']").first().click()
  check("a new tab is blank", !!(await until(async () => { const t = await tabs(); return t.length === before + 1 }, 6000)) && !(await tabs()).some((x) => x.includes("Today")), await tabs())

  // ---------- files opened lately, per workspace ----------
  await pick(1)
  await page.goto(`${B}#file/${encodeURIComponent("Notes/2026-09-27 journal.md")}`)
  check("opened files are kept in the workspace (core:recent)", !!(await until(() => data()[0]?.state?.["core:recent"]?.[0] === "Notes/2026-09-27 journal.md", 8000)), data()[0]?.state)
  await wait(1000)
  await page.locator("section[aria-label=Pane] button[aria-label='New tab']").first().click()
  check("a blank new tab lists them: Recently opened here", !!(await until(() => page.getByText("Recently opened here").count(), 6000)))
  await page.screenshot({ path: `${OUT}2-newtab.png` })

  // ---------- terminals: this workspace's first, then the others' ----------
  const t1 = `qadesk${Date.now().toString(36)}a`, t2 = `qadesk${Date.now().toString(36)}b`
  await page.goto(`${B}#view/${encodeURIComponent(`terminal/${t1}`)}`)
  await until(() => page.$(`aside [data-session="${t1}"]`), 6000)
  await pick(2)
  await page.goto(`${B}#view/${encodeURIComponent(`terminal/${t2}`)}`)
  await until(() => page.$(`aside [data-session="${t2}"]`), 6000)
  await until(() => JSON.stringify(data()[1]?.layout ?? "").includes(t2), 6000)
  await pick(1)
  check("Terminals: this workspace's first, another's under Other workspaces", !!(await until(async () => {
    const order = await page.$$eval("aside [data-panel='terminal:sessions'] [data-session], aside [data-panel='terminal:sessions'] [data-terminals-elsewhere]", (els) => els.map((e) => e.getAttribute("data-session") ?? "|"))
    const i1 = order.indexOf(t1), bar = order.indexOf("|"), i2 = order.indexOf(t2)
    return i1 >= 0 && bar > i1 && i2 > bar
  }, 6000)))
  const where = await page.getAttribute(`aside [data-session="${t2}"]`, "data-where")
  // (Files folded for the picture: room for the whole panel.)
  await page.locator("aside [data-panel='files:files'] [data-panel-handle]").first().click().catch(() => {})
  await wait(400)
  check("...with the workspace it's in", where === "Workspace 2", where)
  await page.screenshot({ path: `${OUT}3-terminals.png`, clip: { x: 0, y: 0, width: 260, height: 500 } })
  // A plain shell another workspace shows isn't idle, however long nobody looks (the server asks Workspaces: tabs:open);
  // one no workspace shows any more (its workspace deleted) ends after the idle time at its prompt.
  const IDLE = Number(process.env.QA_TERMINAL_IDLE_MS)
  let t3 = ""
  if (IDLE > 0) {
    t3 = `qadesk${Date.now().toString(36)}c`
    await pick(3)
    await page.goto(`${B}#view/${encodeURIComponent(`terminal/${t3}`)}`)
    await until(() => page.$(`aside [data-session="${t3}"]`), 6000)
    await until(() => JSON.stringify(data()[2]?.layout ?? "").includes(t3), 6000)
    await pick(1)
    await api("DELETE", "workspaces/3")
    await wait(IDLE * 2 + 1500)
    check("a plain shell another workspace shows outlives the idle time", !!(await page.$(`aside [data-session="${t2}"][data-where]`)))
    check("...one no workspace shows ends after it", !!(await until(async () => !(await page.$(`aside [data-session="${t3}"]`)), IDLE + 4000)))
  } else console.log("skip idle check (set QA_TERMINAL_IDLE_MS and start the server with VAULTITE_TERMINAL_IDLE_MS)")

  // ---------- vau panels changes the window's workspace ----------
  const out = vau("panels", "hide", "search")
  check("vau panels: says which workspace", /Workspace 1/.test(out), out)
  check("...hides it in this workspace's panels, sidebars.json untouched", !!(await until(async () => !(await page.$("aside [data-panel='search:search']")), 6000)) &&
    json(".vaultite/sidebars.json").left.includes("search:search") && !data()[0]?.sidebars?.left?.includes("search:search"), [data()[0]?.sidebars, json(".vaultite/sidebars.json")])
  await page.locator(SWITCHER).click({ button: "right" })
  check("the menu: Use these panels for new workspaces, no Reset", (await menuItem("Use these panels for new workspaces").count()) > 0 && !(await menuItem(/Reset/).count()))
  await page.keyboard.press("Escape")
  await api("PUT", "workspaces/1", { sidebars: null })
  await until(async () => !!(await page.$("aside [data-panel='search:search']")), 6000)

  // ---------- heights in proportion to the sidebar ----------
  // (Pinned with many pages and the tree's folders open, so the panels don't all fit: a panel is never drawn taller than
  // what it draws, and with room to spare one drawn shorter takes it back, components/panelLayout.ts.)
  const pinsBefore = await fetch(new URL("/api/config/pages", B)).then((r) => r.json())
  const many = (await fetch(new URL("/api/state", B)).then((r) => r.json())).files.files.filter((f) => f.path.endsWith(".md")).slice(0, 24).map((f) => f.path)
  await fetch(new URL("/api/config/pages", B), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...pinsBefore, pinned: many }) })
  // (Workspace 1 has a pinned list of its own by now: the same pages there.)
  const ownPinsBefore = data()[0]?.pinned ?? null
  await api("PUT", "workspaces/1", { pinned: many })
  await api("PUT", "workspaces/1", { sidebars: { left: ["search:search", "pages:pages", "terminal:sessions", "files:files"], right: [], collapsed: [], heights: { "pages:pages": 160 }, heightsAt: 400 } })
  await page.waitForSelector("aside [data-panel='files:files'] [data-panel-handle]")
  if (await page.$("aside [aria-label='Expand all']")) await page.click("aside [aria-label='Expand all']", { force: true })
  let seenTall = null
  const tall = await until(async () => {
    const r = seenTall = await page.evaluate(() => {
      const box = document.querySelector("[data-sidebar-body=left]"), el = document.querySelector("aside [data-panel='pages:pages']")
      return box && el ? { box: box.clientHeight, h: el.getBoundingClientRect().height, sums: [...box.querySelectorAll(":scope > [data-panel]")].map((w) => [w.dataset.panel, Math.round(w.getBoundingClientRect().height), Math.round(w.querySelector("[data-panel-content]").getBoundingClientRect().height)]) } : null
    })
    return r && Math.abs(r.h - 160 * r.box / 400) <= 2 ? r : null
  }, 6000)
  check("a panel's height drawn in proportion to the sidebar's (heightsAt)", !!tall, seenTall)
  await page.setViewportSize({ width: 1280, height: 600 })
  const short = await until(async () => {
    const r = await page.evaluate(() => {
      const box = document.querySelector("[data-sidebar-body=left]"), el = document.querySelector("aside [data-panel='pages:pages']")
      return { box: box.clientHeight, h: el.getBoundingClientRect().height }
    })
    return Math.abs(r.h - 160 * r.box / 400) <= 2 ? r : null
  }, 6000)
  check("...and follows it on a shorter window", !!short && short.h < tall.h, [tall, short])
  await page.setViewportSize({ width: 1280, height: 800 })
  await fetch(new URL("/api/config/pages", B), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pinsBefore) })
  await api("PUT", "workspaces/1", { pinned: ownPinsBefore })

  // ---------- Workspaces' settings: This workspace (its settings sheet, from the command palette) ----------
  await api("PUT", "workspaces/1", { name: "Writing" })
  await wait(800)
  await page.keyboard.press("ControlOrMeta+p"); await wait(300); await page.keyboard.type("workspaces settings"); await wait(300); await page.keyboard.press("Enter")
  const sp = await until(() => page.$("dialog[open] [data-workspace-settings]"), 6000)
  check("Workspaces' settings: This workspace", !!sp && (await page.locator("[data-workspace-settings]").innerText()).includes("This workspace: Writing"),
    sp && await page.locator("[data-workspace-settings]").innerText())
  check("...no home page row", !(await page.$("[data-workspace-home]")) && !(await page.getByText("Home page").count()))
  check("...its pinned pages are its own", !!(await until(async () => (await page.locator("[data-workspace-pins]").innerText()).includes("Its own"), 6000)))
  await page.screenshot({ path: `${OUT}4-settings.png` })
  await page.locator("[data-workspace-pins] button", { hasText: "Use for new workspaces" }).click()
  check("...Use for new workspaces: pages.json gets its list", !!(await until(() => json(".vaultite/pages.json").pinned.join() === data()[0]?.pinned?.join(), 6000)), json(".vaultite/pages.json"))

  // Clean up the shells (this server's tmux socket: vaultite-<port>).
  const port = new URL(B).port
  for (const t of [t1, t2, t3].filter(Boolean)) { try { execFileSync("/opt/homebrew/bin/tmux", ["-L", `vaultite-${port}`, "kill-session", "-t", t], { stdio: "ignore" }) } catch { /* gone */ } }
  noErrors()
} finally {
  writeFileSync(file(".vaultite/pages.json"), pagesBefore)
  writeFileSync(file(".vaultite/plugins.json"), pluginsBefore)
  clearWorkspaces(VAULT)
  for (const p of Object.keys(OWN)) rmSync(file(p), { force: true })
  await browser.close()
}
await done()
