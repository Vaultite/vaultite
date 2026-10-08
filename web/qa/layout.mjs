// Phone layout check: every tab and some detail sheets at 390px and 320px (light/dark). Fails (exit 1) on horizontal
// overflow, buttons on top of one another and page errors; lists text cut short by .truncate (shown, as designed:
// only for a look) and writes screenshots and the whole report (layout.json) to web/qa/shots/. Throwaway server only:
//   node web/qa/layout.mjs <base url>
// Ids are looked up from the server (subjects.mjs: nothing is named here): a note that links to another note and to a
// person, opened as files; that person's file and a few more people (those with a timeline first); the latest
// workout and study logs; a routine and a day it was ticked. "people-map" is People with the Map view selected (the
// List/Map choice lives in localStorage).
import { writeFileSync } from "node:fs"
import { SHOTS, WEBGL, qa } from "./lib/qa.mjs"
import { subjects } from "./subjects.mjs"
const { args: [B], browser } = await qa(import.meta.url, { chrome: { args: WEBGL } })
const enc = encodeURIComponent
const v = await subjects(B), state = v.state
const linked = v.need(v.linked, "a note that links to another note and to a person")
const file = (id) => `file/${enc(`${id}.md`)}`
// (null: the vault has no such log, and the page over it is left out, not asked for as "file/.md")
const log = (area) => { const id = state.logs.find((l) => l.area === area)?.id; return id ? file(id) : null }
// A page's address, and a sheet's or file's over it; null (left out) when the vault has no such page (its plugin off).
const pageFile = (name) => v.tree.files.find((f) => f.type === "dashboard" && f.path.split("/").pop() === `${name}.md`)?.path
const at = (name, sheet = "") => { const p = pageFile(name); return p && sheet !== null ? `file/${enc(p)}${sheet && `/${sheet}`}` : null }
// [name (for the report and screenshots: one with a / is a sheet or a file in a tab), address]
const people = [...new Set([linked.person, ...v.timeline, ...v.people])].slice(0, 4).map((p) => [`person/${enc(p.id)}`, at("People", file(p.id))])
const check = state.checks[0], routine = enc(check?.routine ?? state.routines[0]?.id ?? "")
const day = check?.date ?? new Date().toISOString().slice(0, 10)
const same = (...rs) => rs.map((r) => [r, r])
const all = [["today", at("Today")], ["health", at("Health")], ["learning", at("Learning")], ["people", at("People")], ["people-map", at("People")],
  ...same("view/files", `view/files/${file(linked.idea.id)}`, `view/files/${file(linked.note.id)}`),
  people[0], ["projects", at("Projects")], ...people.slice(1, 3),
  ["health/workout", at("Health", log("workouts"))], ["learning/study", at("Learning", log("study"))],
  [`today/routine/${routine}`, at("Today", `routine/${routine}`)], [`today/routine/${routine}/${day}`, at("Today", `routine/${routine}/${day}`)],
  ["learning/book", at("Learning", state.books[0] ? file(state.books[0].id) : null)], ...people.slice(3),
  ...same("plugins", `plugins/plugin/today`, "settings", "settings/plugin-settings/page-preview", "settings/plugin-settings/pages", "settings/plugin-settings/search",
    "bundles", "bundles/bundle/life-os", "bundles/bundle-save")]
const routes = all.filter(([r, hash]) => hash || console.log(`skip ${r} (no such page in this vault)`))
const report = []
for (const width of [390, 320]) {
  for (const scheme of ["light", "dark"]) {
    if (width === 320 && scheme === "dark") continue
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme })
    const page = await ctx.newPage()
    const errs = []
    page.on("pageerror", (e) => errs.push(String(e)))
    page.on("console", (m) => m.type() === "error" && errs.push(m.text()))
    for (const [r, hash] of routes) {
      const map = r === "people-map"
      await page.goto(`${B}#${hash}`)
      await page.evaluate((v) => { try { localStorage.setItem("people.view", v) } catch {} }, map ? "map" : "list")
      if (map) await page.reload()
      await page.waitForTimeout(map ? 3000 : 1200)
      const info = await page.evaluate((w) => {
        const over = []
        // Content of a sideways scroller (the Notes filter chips) may sit past the edge; the scroller itself may not.
        const scroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return true; return false }
        for (const el of document.querySelectorAll("body *")) {
          const b = el.getBoundingClientRect()
          if (scroller(el)) continue
          if (b.width && (b.right > w + 1 || b.left < -1) && getComputedStyle(el).position !== "fixed") {
            over.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} [${Math.round(b.left)},${Math.round(b.right)}] "${(el.textContent || "").trim().slice(0, 30)}"`)
          }
        }
        // Seen at all: not hidden, nor inside something transparent (a sheet's title, shown once the content scrolls).
        const seen = (e) => {
          if (!e.getClientRects().length) return false
          for (let p = e; p; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.visibility === "hidden" || Number(cs.opacity) === 0) return false }
          return true
        }
        // text cut short by truncation (as designed: listed, not failed)
        const clipped = [...document.querySelectorAll(".truncate")].filter((e) => e.scrollWidth > e.clientWidth + 1 && seen(e)).map((e) => e.textContent.trim().slice(0, 50))
        // Buttons that can't be tapped: one whose middle is under another control (a sheet's header actions over a
        // line's label). Content under the fixed bars (phone bar, header) is how scrolling works, a control drawn on top
        // of a bigger one by design (a row's More button) leaves the row's middle free, and with a sheet open only the
        // sheet counts. Checked as loaded (scrolled to the top), where nothing should be covered.
        const CONTROL = "button, a[href], [role=button]"
        const root = document.querySelector("dialog[open]") ?? document.body
        // (the sheet itself is fixed: only what's pinned inside it counts)
        const pinned = (e) => { for (let p = e; p && p !== root; p = p.parentElement) if (/fixed|sticky/.test(getComputedStyle(p).position)) return true; return false }
        const hidden = (e, x, y) => {
          for (let p = e.parentElement; p && p !== root; p = p.parentElement) {
            if (getComputedStyle(p).overflowY === "visible") continue
            const r = p.getBoundingClientRect()
            if (y < r.top || y > r.bottom || x < r.left || x > r.right) return true
          }
          return false
        }
        const name = (e) => e.getAttribute("aria-label") || e.textContent.trim().slice(0, 30) || e.tagName.toLowerCase()
        const overlap = []
        for (const e of root.querySelectorAll(CONTROL)) {
          if (!seen(e) || scroller(e) || pinned(e)) continue
          const b = e.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2
          if (b.width < 4 || b.height < 4 || x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue
          // Scrolled out of its scroller's sight (under the sheet's bottom bar, past the end of what it shows).
          if (hidden(e, x, y)) continue
          const hit = document.elementFromPoint(x, y)
          if (!hit || e.contains(hit) || hit.contains(e)) continue
          const over = hit.closest(CONTROL)
          if (over && !pinned(over) && !over.contains(e)) overlap.push(`"${name(over)}" over "${name(e)}"`)
        }
        return { sw: document.documentElement.scrollWidth, over: over.slice(0, 8), overlap: overlap.slice(0, 8), clipped: clipped.slice(0, 10) }
      }, width)
      const name = `${width}-${scheme}-${r.replace(/\//g, "_")}`
      if (scheme === "light" || !r.includes("/")) await page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: !r.includes("/") })
      report.push({ name, ...info })
    }
    report.push({ name: `${width}-${scheme} errors`, errs })
    await ctx.close()
  }
}
await browser.close()
writeFileSync(`${SHOTS}layout.json`, JSON.stringify(report, null, 1))
let fails = 0
for (const x of report) {
  const width = Number(x.name.split("-")[0])
  const bad = [
    x.errs?.length && `page errors: ${x.errs.slice(0, 3).join(" | ")}`,
    (x.sw > width || x.over?.length) && `overflows ${width}px (${x.sw}): ${x.over.slice(0, 3).join("; ")}`,
    x.overlap?.length && `buttons over one another: ${x.overlap.slice(0, 3).join("; ")}`,
  ].filter(Boolean)
  for (const b of bad) { fails++; console.log(`FAIL ${x.name}: ${b}`) }
  if (!bad.length && !x.errs) console.log(`ok   ${x.name}${x.clipped?.length ? `  (cut short: ${x.clipped.slice(0, 3).join(" | ")})` : ""}`)
}
console.log(`\n${fails ? `${fails} failed` : "all passed"}`)
process.exit(fails ? 1 : 0)
