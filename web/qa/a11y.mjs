// Accessibility that only gets better: axe-core's WCAG A/AA and best-practice rules over the app's surfaces (desktop
// light and dark, an open palette, menu and sheet, the phone), each rule's failing elements held to a11y.json's limit
// (a rule not there: none); and the keyboard: Tab never lands on what can't be seen, and isn't trapped. --ratchet
// lowers a limit a win beat (commit it). Reads only, but opens tabs: throwaway server.
//   node web/qa/a11y.mjs <base url> [--ratchet]
import fs from "node:fs"
import { createRequire } from "node:module"
import { openPalette, qa, until, wait } from "./lib/qa.mjs"
import { pageHash, subjects } from "./subjects.mjs"
const { args: [B0], browser, check, watch, done } = await qa(import.meta.url)
const B = B0.endsWith("/") ? B0 : `${B0}/`
const RATCHET = process.argv.includes("--ratchet")
const LIMITS = new URL("./a11y.json", import.meta.url)
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8")
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]
const enc = encodeURIComponent, NOTE = "Notes/How this vault works.md"
const v = await subjects(B)
const person = v.people?.[0] ?? v.linked?.person
const page$ = async (name) => { try { return `#${await pageHash(B, name)}` } catch { return null } }

/** rule -> failing elements, summed over every surface; and where each was seen first (a selector, for the report). */
const now = {}, where = {}
async function audit(page, surface) {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ content: AXE })
  // (what's still fading in reads as low contrast: measured once its animations end, endless ones aside)
  await page.evaluate(() => Promise.race([new Promise((r) => setTimeout(r, 1500)), Promise.all(document.getAnimations()
    .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity).map((a) => a.finished.catch(() => {})))]))
  const found = await page.evaluate(async (tags) => (await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] }))
    .violations.map((r) => ({ id: r.id, n: r.nodes.length, at: r.nodes[0]?.target.join(" ") })), TAGS)
  for (const r of found) { now[r.id] = (now[r.id] ?? 0) + r.n; where[r.id] ??= `${surface}: ${r.at}` }
}
async function go(page, hash) { await page.goto("about:blank"); await page.goto(`${B}${hash}`); await wait(1800) }

// ---------- desktop, light and dark ----------
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })
  const page = watch(await ctx.newPage())
  const surfaces = [["start", ""], ["files", "#view/files"], ["search", "#view/search"], ["settings", "#settings"], ["plugins", "#plugins"],
    ["get", "#get"], ["agents", "#agents"], ["errors", "#errors"], ["today", await page$("Today")], ["people", await page$("People")]]
  for (const [name, hash] of surfaces) if (hash !== null) { await go(page, hash); await audit(page, `${scheme} ${name}`) }
  if (scheme === "light") {
    // Over the page: the palette, a file's menu, a person's sheet.
    await go(page, "")
    await openPalette(page); await until(() => page.locator("[role=option]").count(), 3000)
    await audit(page, "palette"); await page.keyboard.press("Escape"); await wait(300)
    const row = page.locator("aside [role=treeitem]").first()
    if (await row.count()) {
      await row.click({ button: "right" }); await until(() => page.locator("[role=menu]").count(), 2000)
      await audit(page, "file menu"); await page.keyboard.press("Escape"); await wait(300)
    }
    if (person) { await go(page, `#file/${enc(`${person.id}.md`)}`); await audit(page, "person") }

    // The keyboard: Tab round the whole window from a note, back to where it began, every stop seen; in the note's
    // editor Tab indents, and Escape then Tab goes on.
    await go(page, `#file/${enc(NOTE)}`)
    await page.mouse.click(720, 3)
    const stops = [], hidden = [], places = new Set()
    let round = false, editor = false, leftEditor = null
    for (let i = 0; i < 200 && !round; i++) {
      if (editor) await page.keyboard.press("Escape")
      await page.keyboard.press("Tab")
      // (once what focus reveals has faded in: a bar shown by :focus-within starts at opacity 0)
      const s = await page.evaluate(async () => {
        await Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished.catch(() => {})))
        const e = document.activeElement
        if (!e || e === document.body) return null
        const r = e.getBoundingClientRect(), cs = getComputedStyle(e)
        const seen = r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
          && ![...function* () { for (let p = e; p; p = p.parentElement) yield p }()].some((p) => getComputedStyle(p).opacity === "0")
        // (by the element itself: two buttons may share a name)
        const met = window.__stops ??= new WeakSet(), again = met.has(e)
        met.add(e)
        return { key: `${e.tagName.toLowerCase()} ${e.getAttribute("aria-label") ?? e.textContent?.trim().slice(0, 40) ?? ""}`, seen, again,
          editor: !!e.closest(".cm-content"), where: e.closest("aside") ? "sidebar" : e.closest("main") ? "page" : "other" }
      })
      // (past the window's last stop the browser's own comes, then its first again)
      if (!s) continue
      if (editor) leftEditor = !s.editor
      if (s.again) { round = !(editor && s.editor); break }
      editor = s.editor
      stops.push(s.key); places.add(s.where)
      if (!s.seen) hidden.push(s.key)
    }
    now["keyboard-unseen-stop"] = hidden.length
    if (hidden.length) where["keyboard-unseen-stop"] = `note: ${hidden.slice(0, 3).join(" | ")}`
    check("keyboard: Tab goes round the window and back (no trap)", round && stops.length > 10, stops.slice(-5))
    check("keyboard: on its way, the sidebar and the page", places.has("sidebar") && places.has("page"), [...places])
    check("keyboard: Escape then Tab leaves a note's editor", leftEditor === true, leftEditor)
  }
  await ctx.close()
}

// ---------- the phone ----------
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const P = watch(await phone.newPage(), { label: "phone" })
for (const [name, hash] of [["start", ""], ["settings", "#settings"], ["today", await page$("Today")], ["person", person ? `#file/${enc(`${person.id}.md`)}` : null]]) {
  if (hash !== null) { await go(P, hash); await audit(P, `phone ${name}`) }
}
await phone.close()

// ---------- the limits ----------
const limits = JSON.parse(fs.readFileSync(LIMITS, "utf8"))
const rules = [...new Set([...Object.keys(limits), ...Object.keys(now)])].sort()
console.table(Object.fromEntries(rules.map((k) => [k, { now: now[k] ?? 0, limit: limits[k] ?? 0, first: where[k] ?? "" }])))
for (const k of rules) check(`${k}: ${limits[k] ?? 0} or fewer`, (now[k] ?? 0) <= (limits[k] ?? 0), { now: now[k] ?? 0, first: where[k] })
if (RATCHET) {
  const next = Object.fromEntries(Object.entries(limits).map(([k, l]) => [k, Math.min(l, now[k] ?? 0)]).filter(([, l]) => l > 0))
  if (JSON.stringify(next) !== JSON.stringify(limits)) { fs.writeFileSync(LIMITS, `${JSON.stringify(next, null, 2)}\n`); console.log("lowered: a11y.json") }
}
await done()
