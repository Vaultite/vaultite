// The file menus (tree, tab, phone …) and what they do: their groups (Archive with Pin; Open local graph, Open version
// history and the other less used items in More ▸; split rows: Open to the right in Open in new tab ▸, other kinds of
// new file in New note ▸, Change icon in Rename ▸), Duplicate (a copy next to it, a note with its own id), Copy path
// (a click copies from the vault folder; its submenu by hover, chevron and the keyboard: from the vault folder, from the
// system root, a [[link]]), Reveal in Finder
// listed on this machine, Delete to the trash at once with Undo in a toast (no browser dialog anywhere), Delete permanently
// and Empty trash through the app's confirm dialog (Escape cancels, the button and Enter confirm), and File history:
// the version history view, a version compared and restored. Phones at 390px: the … menu, the history view, the toast
// above the phone's bar, the dialog. WRITES a "Qa menu" folder and Notes/Qa dup*.md, empties the trash: throwaway only.
//   node web/qa/filemenu.mjs <base url> <vault path> [out dir]
import { existsSync, readFileSync } from "node:fs"
import { REVEAL, SHOTS, apiAt, qa, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
// As the app: these are the user's files (a note an agent makes through the API gets `origin: ai`: Provenance).
const api = apiAt(B, { "X-Vaultite-Client": "app/qa" })
const has = (p) => existsSync(`${VAULT}/${p}`)
const read = (p) => readFileSync(`${VAULT}/${p}`, "utf8")

// A fresh "Qa menu" folder, a note to duplicate, history kept on every change.
for (const p of ["Qa menu", "Notes/Qa dup.md", "Notes/Qa dup 1.md"]) await fetch(`${B}api/file?path=${encodeURIComponent(p)}`, { method: "DELETE" })
const filesBefore = await api("GET", "config/files")
const pagesBefore = await api("GET", "config/pages")
await api("PUT", "config/files", { ...filesBefore, showHidden: true, autoReveal: false })
await api("POST", "file", { path: ".vaultite/plugins/history/data.json", text: '{"interval_min": 0, "keep_days": 7}\n' })
await api("PUT", "file", { path: ".vaultite/plugins/history/data.json", text: '{"interval_min": 0, "keep_days": 7}\n' })
// Provenance's `origin` on new notes would change the texts checked here.
for (const m of ["POST", "PUT"]) await api(m, "file", { path: ".vaultite/plugins/provenance/data.json", text: '{"label_agents": false, "label_user": false}\n' })
await api("POST", "folder", { path: "Qa menu" })
await api("POST", "file", { path: "Qa menu/Alpha.md", text: "Alpha text.\n" })
await api("POST", "notes", { ext_id: "note-qa-dup", title: "Qa dup", body: "A note to duplicate.", source: "claude" })
await api("POST", "file", { path: "Qa menu/Hist.md", text: "First line\nSecond line\n" })
await api("PUT", "file", { path: "Qa menu/Hist.md", text: "First line\nSecond line changed\nThird line\n", base: "First line\nSecond line\n" })
await api("PUT", "file", { path: "Qa menu/Hist.md", text: "Rewritten by a bad edit\n", base: "First line\nSecond line changed\nThird line\n" })
const vaultPath = (await api("GET", "vault")).path
// Earlier runs' versions of Hist.md are kept too (history outlives a delete): count from here.
const histBefore = (await api("GET", "history?path=Qa%20menu/Hist.md")).versions.length

const origin = new URL(B).origin

// ---------- desktop ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin })
  await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
  const page = watch(await ctx.newPage(), { console: true })
  const browserDialogs = []
  page.on("dialog", (d) => { browserDialogs.push(d.message()); d.dismiss() })
  const shot = (name) => page.screenshot({ path: `${OUT}filemenu-${name}.png` })
  const clip = () => page.evaluate(() => navigator.clipboard.readText())
  const row = (p) => page.locator(`aside [role=tree] div[data-tree-path="${p}"]`).first()
  const menu = page.locator("[role=menu]").first()
  const items = () => menu.locator(":scope > button").allInnerTexts()
  const openFolder = async (p) => {
    if ((await row(p).evaluate((el) => el.closest("li").getAttribute("aria-expanded"))) !== "true") { await row(p).locator("button").first().click(); await wait(200) }
  }
  await page.goto(B); await wait(1500)
  await openFolder("Qa menu")

  // The tree's menu.
  await row("Qa menu/Alpha.md").click({ button: "right" }); await wait(200)
  const tree = await items()
  for (const want of ["Open in new tab", "Duplicate", "Move file to…", "Copy path", REVEAL, "More", "Rename", "Delete"]) {
    check(`tree menu: ${want}`, tree.includes(want), tree)
  }
  check("tree menu: Open to the right, Change icon and the other kinds are in submenus", !["Open to the right", "Change icon", "New"].some((x) => tree.includes(x)), tree)
  // Its groups (a line between each): open; new (other kinds in New note ▸); change; Archive and Pin (the plugins'
  // "navigate" section); the path then More ▸ (the plugins' "more"); delete.
  const groups = await menu.evaluate((m) => {
    const out = [[]]
    for (const el of m.children) {
      if (el.getAttribute("role") === "separator") out.push([])
      else if (el.tagName === "BUTTON") out[out.length - 1].push(el.innerText.trim())
    }
    return out
  })
  const groupOf = (label) => groups.find((g) => g.includes(label))?.join("|")
  check("tree menu: open, new, change, keep, more, delete groups", groups[0]?.join("|") === "Open in new tab" &&
    groups[1]?.join("|") === "New note|New folder" && groups[2]?.join("|") === "Rename|Move file to…|Duplicate" &&
    groupOf("Pin") === "Archive|Pin" && groupOf("More") === `Copy path|${REVEAL}|More` && groups.at(-1)?.join("|") === "Delete", groups)
  // Split rows: hovering opens the rest, the row's own choice first.
  for (const [row_, want] of [["Open in new tab", "Open in new tab|Open to the right"], ["Rename", "Rename|Change icon"]]) {
    await menu.locator(":scope > button", { hasText: new RegExp(`^${row_}$`) }).hover(); await wait(300)
    const got = await page.locator("[role=menu]").nth(1).locator("button").allInnerTexts()
    check(`${row_} ▸: ${want}`, got.join("|") === want, got)
  }
  check("tree menu: the less used items aren't at the top level", !["Open local graph", "Open version history", "Start presentation", "Export to PDF", "Record audio"].some((x) => tree.includes(x)), tree)
  await menu.locator(":scope > button", { hasText: /^More$/ }).hover(); await wait(300)
  const more = await page.locator("[role=menu]").nth(1).locator("button").allInnerTexts()
  check("More ▸: local graph, history, presentation, PDF, recording", ["Open local graph", "Open version history", "Start presentation", "Export to PDF", "Record audio"].every((x) => more.includes(x)), more)
  await shot("tree-menu-more")
  await page.keyboard.press("Escape"); await wait(100)
  if (await page.locator("[role=menu]").count()) { await page.keyboard.press("Escape"); await wait(100) }
  await row("Qa menu/Alpha.md").click({ button: "right" }); await wait(200)
  check("tree menu: no other New items at the top level", !tree.some((x) => /^New (canvas|database|base)$/.test(x)), tree)
  await shot("tree-menu")
  await menu.locator(":scope > button", { hasText: /^New note$/ }).hover(); await wait(300)
  const kinds = await page.locator("[role=menu]").nth(1).locator("button").allInnerTexts()
  check("New note ▸: a note, then the other kinds of file, by what they make", kinds[0] === "Note" && ["Canvas", "Database", "Base"].every((k) => kinds.includes(k)), kinds)
  await shot("tree-menu-new")
  await page.keyboard.press("Escape"); await wait(100)
  if (await page.locator("[role=menu]").count()) { await page.keyboard.press("Escape"); await wait(100) }
  await row("Qa menu/Alpha.md").click({ button: "right" }); await wait(200)
  // Copy path: hover opens the submenu beside it.
  await menu.locator("button", { hasText: "Copy path" }).hover(); await wait(300)
  const sub = page.locator("[role=menu]").nth(1)
  check("hover opens the submenu", await sub.isVisible())
  const subItems = await sub.locator("button").allInnerTexts()
  check("submenu: vault folder, system root, link", subItems.join("|") === "From vault folder|From system root|Copy link", subItems)
  const [mb, sb] = [await menu.boundingBox(), await sub.boundingBox()]
  check("the submenu sits beside the menu, on screen", sb.x >= mb.x + mb.width - 8 && sb.x + sb.width <= 1440 && sb.y + sb.height <= 900, [mb, sb])
  await shot("submenu")
  await sub.locator("button", { hasText: "From vault folder" }).click(); await wait(300)
  check("copy path from the vault folder", await clip() === "Qa menu/Alpha.md", await clip())
  check("a toast says it's copied", (await page.locator("[data-sonner-toast]").allInnerTexts()).some((t) => t.includes("Copied the path")))
  check("the menu closed", !(await page.locator("[role=menu]").count()))
  // A click on Copy path itself copies from the vault folder.
  await page.evaluate(() => navigator.clipboard.writeText(""))
  await row("Qa menu/Alpha.md").click({ button: "right" }); await wait(200)
  await menu.locator(":scope > button", { hasText: "Copy path" }).click(); await wait(300)
  check("clicking Copy path copies from the vault folder, the menu closed", await clip() === "Qa menu/Alpha.md" && !(await page.locator("[role=menu]").count()), await clip())
  // The keyboard: ↓ to Copy path, → opens it, ↓ Enter picks; ← goes back.
  await row("Qa menu/Alpha.md").click({ button: "right" }); await wait(200)
  const idx = (await menu.locator(":scope > button:not(:disabled)").allInnerTexts()).indexOf("Copy path")
  for (let i = 0; i < idx; i++) await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowRight"); await wait(150)
  check("→ opens the submenu, its first item focused", await page.evaluate(() => document.activeElement?.textContent) === "From vault folder")
  await page.keyboard.press("ArrowLeft"); await wait(100)
  check("← closes it, Copy path focused again", await page.locator("[role=menu]").count() === 1 && (await page.evaluate(() => document.activeElement?.textContent)).includes("Copy path"))
  await page.keyboard.press("ArrowRight"); await wait(150)
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await wait(300)
  check("copy path from the system root", await clip() === `${vaultPath}/Qa menu/Alpha.md`, await clip())
  // Copy link: the shortest [[link]] that finds it.
  await openFolder("Notes")
  await row("Notes/Qa dup.md").click({ button: "right" }); await wait(200)
  await menu.locator(":scope > button", { hasText: "Copy path" }).locator("[data-menu-more]").click(); await wait(200)
  await page.locator("[role=menu]").nth(1).locator("button", { hasText: "Copy link" }).click(); await wait(300)
  check("copy link", await clip() === "[[Qa dup]]", await clip())
  // Folders get Copy path too.
  await row("Qa menu").click({ button: "right" }); await wait(200)
  check("a folder's menu has Copy path", (await items()).includes("Copy path"), await items())
  await page.keyboard.press("Escape"); await wait(100)

  // Duplicate: a copy next to it, opened ready to rename, with its own id.
  await row("Notes/Qa dup.md").click({ button: "right" }); await wait(200)
  await menu.locator("button", { hasText: "Duplicate" }).click(); await wait(1200)
  check("duplicate makes 'Qa dup 1'", has("Notes/Qa dup 1.md"))
  check("the copy opens in a tab", (await page.locator("[data-tab-bar] [role=tab][aria-selected=true]").innerText()).trim() === "Qa dup 1")
  check("its name is ready to type", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")) === "File name")
  const idOf = (t) => /\nid: (.+)\n/.exec(t)?.[1]
  check("the copy has its own id", idOf(read("Notes/Qa dup 1.md")) && idOf(read("Notes/Qa dup 1.md")) !== "note-qa-dup" && idOf(read("Notes/Qa dup.md")) === "note-qa-dup",
    [idOf(read("Notes/Qa dup.md")), idOf(read("Notes/Qa dup 1.md"))])
  await page.keyboard.press("Escape")

  // Delete: to the trash at once, Undo in a toast.
  await row("Qa menu/Alpha.md").click({ button: "right" }); await wait(200)
  await menu.locator("button", { hasText: /^Delete$/ }).click(); await wait(800)
  check("delete: gone at once, no browser dialog", !has("Qa menu/Alpha.md") && !browserDialogs.length, browserDialogs)
  const t = page.locator("[data-sonner-toast]", { hasText: "Moved Alpha to trash" })
  check("delete: a toast with Undo", await t.isVisible() && await t.locator("[data-button]", { hasText: "Undo" }).isVisible())
  const tb = await t.boundingBox()
  check("the toast is at the bottom", tb.y > 900 - 120, tb)
  await shot("toast")
  await t.locator("[data-button]", { hasText: "Undo" }).click(); await wait(1000)
  check("undo puts it back where it was", has("Qa menu/Alpha.md") && read("Qa menu/Alpha.md") === "Alpha text.\n")

  // Delete permanently (in the trash): the app's dialog. Escape cancels, the button confirms.
  await row("Qa menu/Alpha.md").click({ button: "right" }); await wait(200)
  await menu.locator("button", { hasText: /^Delete$/ }).click(); await wait(800)
  await openFolder(".trash"); await openFolder(".trash/Qa menu")
  const trashed = page.locator('aside [role=tree] div[data-tree-path^=".trash/Qa menu/Alpha"]').first()
  const trashedPath = await trashed.getAttribute("data-tree-path")
  await trashed.click({ button: "right" }); await wait(200)
  await menu.locator("button", { hasText: "Delete permanently" }).click(); await wait(300)
  const dlg = page.locator("dialog[data-confirm]")
  check("delete permanently asks in the app's dialog", await dlg.isVisible() && (await dlg.innerText()).includes("Delete \"Alpha") && !browserDialogs.length)
  check("the confirm button has the focus", await page.evaluate(() => document.activeElement?.hasAttribute("data-confirm-ok")))
  await shot("dialog")
  await page.keyboard.press("Escape"); await wait(300)
  check("Escape cancels: still there", !(await dlg.count()) && has(trashedPath))
  await trashed.click({ button: "right" }); await wait(200)
  await menu.locator("button", { hasText: "Delete permanently" }).click(); await wait(300)
  await dlg.locator("button", { hasText: "Cancel" }).click(); await wait(300)
  check("Cancel cancels", has(trashedPath))
  await trashed.click({ button: "right" }); await wait(200)
  await menu.locator("button", { hasText: "Delete permanently" }).click(); await wait(300)
  await dlg.locator("button[data-confirm-ok]").click(); await wait(800)
  check("Delete deletes it for good", !has(trashedPath))
  // Empty trash: Enter confirms.
  await row(".trash").click({ button: "right" }); await wait(200)
  await menu.locator("button", { hasText: "Empty trash" }).click(); await wait(300)
  check("empty trash asks", await dlg.isVisible() && (await dlg.innerText()).includes("Empty the trash?"))
  await page.keyboard.press("Enter"); await wait(900)
  check("Enter confirms: the trash is empty", !(await api("GET", "files")).others.some((f) => f.path.startsWith(".trash/")))

  // File history: the tab's menu opens it; a version compared and restored.
  await row("Qa menu/Hist.md").click(); await wait(800)
  const tab = page.locator("[data-tab-bar] [role=tab][aria-selected=true]").first()
  await tab.click({ button: "right" }); await wait(200)
  const tabItems = await items()
  for (const want of ["Duplicate", "Copy path", "More", "Delete"]) check(`tab menu: ${want}`, tabItems.includes(want), tabItems)
  await menu.locator(":scope > button", { hasText: /^More$/ }).hover(); await wait(300)
  await page.locator("[role=menu]").nth(1).locator("button", { hasText: "Open version history" }).click(); await wait(1200)
  const view = page.locator("[data-history]:visible")
  check("the history view opens in a tab", await view.isVisible() && (await page.locator("[data-tab-bar] [role=tab][aria-selected=true]").innerText()).trim() === "Hist history")
  const opts = view.locator("[role=option]")
  check("two earlier versions", histBefore >= 2 && await opts.count() === histBefore, [histBefore, await opts.count()])
  await opts.nth(1).click(); await wait(500)
  const adds = await view.locator("[data-diff=add]").allInnerTexts(), dels = await view.locator("[data-diff=del]").allInnerTexts()
  check("the diff: the version's lines added, the file's removed", adds.some((l) => l.includes("First line")) && dels.some((l) => l.includes("Rewritten by a bad edit")), [adds, dels])
  await shot("history")
  await view.locator("button", { hasText: "Restore" }).click(); await wait(1000)
  check("restore writes the version back", read("Qa menu/Hist.md") === "First line\nSecond line\n", read("Qa menu/Hist.md"))
  check("restore offers Undo", await page.locator("[data-sonner-toast]", { hasText: "Restored" }).locator("[data-button]", { hasText: "Undo" }).isVisible())
  await wait(800)
  check("the restore is in the history too", await opts.count() === histBefore + 1, await opts.count())
  check("no browser dialogs at all", !browserDialogs.length, browserDialogs)
  await ctx.close()
}

// ---------- phone ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 })
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin })
  const m = watch(await ctx.newPage())
  const browserDialogs = []
  m.on("dialog", (d) => { browserDialogs.push(d.message()); d.dismiss() })
  const shot = (name) => m.screenshot({ path: `${OUT}filemenu-phone-${name}.png` })
  await m.goto(`${B}#view/files`); await wait(1500)
  const mrow = (p) => m.locator(`[role=tree]:visible div[data-tree-path="${p}"]`).first()
  if ((await m.locator('[role=tree]:visible li:has(div[data-tree-path="Qa menu"]):not(:has(li div[data-tree-path="Qa menu"]))').first().getAttribute("aria-expanded")) !== "true") { await mrow("Qa menu").locator("button").first().click(); await wait(200) }
  await mrow("Qa menu/Hist.md").locator('button[aria-label^="More for"]').tap(); await wait(250)
  const pm = await m.locator("[role=menu] > button").allInnerTexts()
  check("phone …: duplicate, copy path, more, delete", ["Duplicate", "Copy path", "More", "Delete"].every((x) => pm.includes(x)), pm)
  check("phone …: no Open to the right", !pm.includes("Open to the right"), pm)
  await shot("menu")
  // Taps, as on a phone: a click is a mouse, which hovers whatever item the menu puts under the … it clicked.
  // A split row: its chevron opens the submenu (the label copies).
  await m.locator("[role=menu] button", { hasText: "Copy path" }).locator("[data-menu-more]").tap(); await wait(250)
  // Phones open a submenu in place of the menu, with a Back row first.
  const sub = await m.locator("[role=menu] button").allInnerTexts()
  check("phone: tapping Copy path's chevron opens its submenu in place", await m.locator("[role=menu]").count() === 1 && sub.includes("From vault folder") && !sub.includes("Delete"), sub)
  const b = await m.locator("[role=menu]").first().boundingBox()
  check("phone: the submenu stays on screen", b.x >= 0 && b.x + b.width <= 390, b)
  await shot("submenu")
  await m.locator("[role=menu] button", { hasText: "From vault folder" }).tap(); await wait(300)
  await mrow("Qa menu/Hist.md").locator('button[aria-label^="More for"]').tap(); await wait(250)
  await m.locator("[role=menu] > button", { hasText: /^More$/ }).tap(); await wait(250)
  await m.locator("[role=menu] button", { hasText: "Open version history" }).tap(); await wait(1200)
  check("phone: the history view", await m.locator("[data-history]:visible").isVisible() && await m.locator("[data-history]:visible [role=option]").count() >= 3)
  const wide = await m.evaluate(() => document.documentElement.scrollWidth)
  check("phone: no sideways scroll", wide <= 390, wide)
  await shot("history")
  // Delete: the toast sits above the bar.
  await m.goto(`${B}#view/files`); await wait(1200)
  await mrow("Qa menu/Hist.md").locator('button[aria-label^="More for"]').click(); await wait(250)
  await m.locator("[role=menu] button", { hasText: /^Delete$/ }).click(); await wait(800)
  const toastBox = await m.locator("[data-sonner-toast]").last().boundingBox()
  const barBox = await m.locator("[data-phone-bar]").boundingBox()
  check("phone: the toast is above the bar", toastBox && barBox && toastBox.y + toastBox.height <= barBox.y, [toastBox, barBox])
  await shot("toast")
  await m.locator("[data-sonner-toast] [data-button]", { hasText: "Undo" }).last().tap(); await wait(1000)
  check("phone: undo", has("Qa menu/Hist.md"))
  // The dialog at 390px: Close all tabs.
  await m.locator("button[aria-label*=tab i]").last().tap().catch(() => {}); await wait(800)
  const closeAll = m.locator("dialog button", { hasText: "Close all" })
  if (await closeAll.count()) {
    await closeAll.tap(); await wait(400)
    const d = m.locator("dialog[data-confirm]")
    const box = await d.boundingBox()
    check("phone: the confirm dialog fits", await d.isVisible() && box.x >= 0 && box.x + box.width <= 390, box)
    await shot("dialog")
    await d.locator("button", { hasText: "Cancel" }).tap(); await wait(300)
    check("phone: cancel keeps the tabs", !(await d.count()))
  } else console.log("skip phone dialog: no tab switcher with several tabs")
  check("phone: no browser dialogs", !browserDialogs.length, browserDialogs)
  await ctx.close()
}

// Clean up.
for (const p of ["Qa menu", "Notes/Qa dup.md", "Notes/Qa dup 1.md"]) await fetch(`${B}api/file?path=${encodeURIComponent(p)}`, { method: "DELETE" })
await api("PUT", "config/files", filesBefore)
await api("PUT", "config/pages", { pinned: pagesBefore.pinned ?? [] })
await done()
