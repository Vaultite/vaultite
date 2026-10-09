// How steady the page stays: does a tab come back exactly where it was left, does a change of view (reading, live
// preview, source) keep what was on screen, and how much does a page move while it loads. Measured, not eyeballed: a
// probe in the page samples the pane's scroller every frame and records every layout shift (with the elements that
// moved), so each step reports where the reader's anchor (the text at the top of the pane) ended up, how many times
// the scroller moved by itself, and the shifts' score (CLS: 0 is perfectly steady).
//   node web/qa/stability.mjs <base url> [--json out.json] [--file Dashboards/Design.md] [--note "Notes/..."] [--verbose]
// --phone: the same on a phone (390x844, touch; the window scrolls), without the tab steps.
// Read-only (it opens tabs, which a workspace keeps: throwaway server, or a vault where that doesn't matter).
// Steps, on a dashboard (Design.md, two columns of blocks) and on a long note:
//   load        the file opened in a fresh page: shifts while its blocks come in
//   tab         scrolled to 1/3, 2/3 and the end, another tab opened and drawn, back to the first tab: where it lands
//   view        reading -> live preview -> reading, from a place in the middle: the anchor's text should stay at the top
//   reloaded    the page reloaded, from 60%: back where it was
// An anchor is the first line of text under the top of the scroller (its text and offset); "drift" is how far that text
// is from where it was, once things settle (2 s), and "moves" how many frames the scroller changed by itself.
import { writeFileSync } from "node:fs"
import { qa, wait } from "./lib/qa.mjs"
const { browser } = await qa(import.meta.url)

const args = process.argv.slice(2)
const B = args.find((a) => /^https?:/.test(a))
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const FILE = opt("--file", "Dashboards/Design.md")
const NOTE = opt("--note", null)
const OUT = opt("--json", null)
const OTHER = opt("--other", "Notes/Lisbon trip.md")
const VERBOSE = args.includes("--verbose")
/** A phone (390x844, touch): the window scrolls, no tab bar (the tab steps are left out). */
const PHONE = args.includes("--phone")
/** Only some steps: --steps tab,same,view,reload (all when left out). */
const STEPS = (opt("--steps", "load,tab,same,view,reload")).split(",")
if (!B) { console.error("usage: node web/qa/stability.mjs <base url/> [--json out.json] [--file path] [--note path] [--verbose]"); process.exit(2) }
const base = B.endsWith("/") ? B : `${B}/`
const hash = (p) => `#file/${encodeURIComponent(p)}`

// The probe, installed before the app's code runs: every layout shift (with its sources), and on demand a per-frame
// record of the focused pane's scroller.
const PROBE = () => {
  const w = window
  w.__stab = { shifts: [], frames: [], recording: false }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        w.__stab.shifts.push({ t: e.startTime, value: e.value, input: e.hadRecentInput,
          sources: (e.sources ?? []).slice(0, 3).map((s) => {
            const n = s.node, el = n && (n.nodeType === 1 ? n : n.parentElement)
            const tag = el ? `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 2).join(".") : ""}` : "?"
            return { tag, dy: Math.round(s.currentRect.y - s.previousRect.y), dh: Math.round(s.currentRect.height - s.previousRect.height),
              text: (el?.textContent ?? "").trim().slice(0, 40) }
          }) })
      }
    }).observe({ type: "layout-shift", buffered: true })
  } catch { /* not Chromium */ }
  // The pane's scroller on a computer; on a phone the window scrolls (#main-scroll is only its content).
  const box = () => {
    const m = document.getElementById("main-scroll")
    return m && /auto|scroll/.test(getComputedStyle(m).overflowY) ? m : document.scrollingElement
  }
  w.__box = box
  // An anchor is a leaf of text (a paragraph, a list item, a heading, a table cell, an editor's line) under the pane's
  // sticky bar, found again by its text: the same in reading and in live preview.
  const LEAF = "p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, summary, .cm-line"
  const SKIP = "[class*=maplibregl], nav, .sticky, button, svg, [aria-hidden=true]"
  const textOf = (el) => (el.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 50)
  /** The first leaf of text under the top of the scroller: its text and how far below the top it is. */
  w.__anchor = () => {
    const b = box(); if (!b) return null
    const r = b === document.scrollingElement ? { top: 0, left: 0, width: innerWidth } : b.getBoundingClientRect()
    // (the first leaf with text found once on the page; short texts like a card's title repeat)
    for (const min of [20, 8]) {
      for (let dy = 64; dy < 600; dy += 10) {
        for (const fx of [0.3, 0.5, 0.7, 0.15, 0.85]) {
          const el = document.elementFromPoint(r.left + r.width * fx, r.top + dy)?.closest(LEAF)
          if (!el || !b.contains(el) || el.closest(SKIP)) continue
          const text = textOf(el)
          if (text.length < min) continue
          if (min > 8 && [...b.querySelectorAll(LEAF)].filter((x) => textOf(x).startsWith(text)).length > 1) continue
          // (on a dashboard, by its card too: the card's line is stable, the text in a live card may not be)
          const card = el.closest("[data-line]")
          return { text, top: Math.round(el.getBoundingClientRect().top - r.top), line: card?.dataset.line, cardTop: card ? Math.round(card.getBoundingClientRect().top - r.top) : undefined }
        }
      }
    }
    return null
  }
  /** Where that anchor's text is now (null: not on the page), relative to the scroller's top: the nearest match. */
  w.__find = (text, near = 0, line, cardTop) => {
    const b = box(); if (!b) return null
    const top = b === document.scrollingElement ? 0 : b.getBoundingClientRect().top
    const card = line !== undefined ? b.querySelector(`[data-line="${line}"]`) : null
    if (card) return Math.round(card.getBoundingClientRect().top - top) + (near - cardTop)
    let best = null
    for (const el of b.querySelectorAll(LEAF)) {
      if (el.closest(SKIP) || !textOf(el).startsWith(text)) continue
      const rect = el.getBoundingClientRect()
      if (!rect.height) continue
      const y = Math.round(rect.top - top)
      if (best === null || Math.abs(y - near) < Math.abs(best - near)) best = y
    }
    return best
  }
  w.__record = (on) => {
    w.__stab.recording = on
    if (!on) return
    w.__stab.frames = []
    const tick = () => {
      if (!w.__stab.recording) return
      const b = box()
      w.__stab.frames.push({ t: performance.now(), y: b ? Math.round(b.scrollTop) : -1, h: b ? b.scrollHeight : -1 })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
}

const results = []
const report = (r) => {
  results.push(r)
  const f = (n) => (n === null || n === undefined ? "  -  " : String(n).padStart(5))
  console.log(`${r.step.padEnd(34)} drift ${f(r.drift)}px  moves ${f(r.moves)}  settle ${f(r.settleMs)}ms  cls ${r.cls.toFixed(3)}${r.note ? `  ${r.note}` : ""}`)
  if (VERBOSE && r.shifts?.length) for (const s of r.shifts.slice(0, 6)) console.log(`      shift ${s.value.toFixed(3)} ${s.sources.map((x) => `${x.tag} dy${x.dy} dh${x.dh} "${x.text}"`).join(" | ")}`)
}

/** Run `act`, then watch for `ms`: the scroller's moves, the shifts, and where the anchor's text ended up. */
async function measure(page, step, anchor, act, ms = 2000) {
  await page.evaluate(() => { window.__stab.shifts = []; window.__record(true) })
  const t0 = await page.evaluate(() => performance.now())
  await act()
  await wait(ms)
  const out = await page.evaluate((a) => { window.__record(false); return { frames: window.__stab.frames, shifts: window.__stab.shifts, at: a ? window.__find(a.text, a.top, a.line, a.cardTop) : null } }, anchor)
  // Moves: frames where the scroller's position changed without the harness asking.
  let moves = 0, last = null, lastMove = t0
  for (const fr of out.frames) { if (last !== null && fr.y !== last) { moves++; lastMove = fr.t } last = fr.y }
  const cls = out.shifts.filter((s) => !s.input).reduce((a, s) => a + s.value, 0)
  const drift = anchor && out.at !== null ? out.at - anchor.top : null
  const ys = out.frames.length ? `y ${out.frames[0].y}->${out.frames[out.frames.length - 1].y}` : ""
  report({ step, drift, moves, settleMs: Math.round(lastMove - t0), cls, note: (anchor && out.at === null ? `anchor "${anchor.text.slice(0, 30)}" not on the page ` : "") + (VERBOSE ? `${ys} "${anchor?.text.slice(0, 24) ?? ""}"@${anchor?.top ?? ""}` : ""), shifts: out.shifts, anchor })
}

const scrollTo = (page, frac) => page.evaluate((f) => {
  const b = window.__box(); b.scrollTop = Math.round((b.scrollHeight - b.clientHeight) * f); return b.scrollTop
}, frac)
const anchorNow = (page) => page.evaluate(() => window.__anchor())

const tabLoc = (page, name) => page.locator("section[aria-label=Pane] [data-tab-id]", { has: page.locator("[role=tab]", { hasText: name }) }).first()
const activeTab = (page) => page.evaluate(() => document.querySelector("section[aria-label=Pane] [role=tab][aria-selected=true]")?.innerText.trim())
const nameOf = (p) => p.split("/").pop().replace(/\.md$/, "")

async function suite(file, label) {
  // A fresh desk: workspaces are the server's (shared by every page), so the last suite's tabs would still be open.
  await fetch(`${base}api/workspaces/1`, { method: "DELETE" }).catch(() => {})
  const ctx = await browser.newContext(PHONE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : { viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(PROBE)
  const page = await ctx.newPage()
  page.on("pageerror", (e) => console.log(`page error: ${e.message}`))
  // Load: a fresh page on the file, in reading view.
  await page.addInitScript(() => { try { localStorage.setItem("vaultite.fileMode", "read"); localStorage.removeItem("vaultite.tabModes") } catch {} })
  await page.goto(`${base}${hash(file)}`)
  await page.waitForSelector("#main-scroll article, #main-scroll main, article.file-view")
  if (STEPS.includes("load")) await measure(page, `${label}: load`, null, async () => {}, 2500)
  else await wait(2500)
  const full = await page.evaluate(() => { const b = window.__box(); return b.scrollHeight - b.clientHeight })
  // Tabs: away and back, from several places.
  for (const frac of STEPS.includes("tab") && !PHONE ? [0.33, 0.66, 1] : []) {
    await scrollTo(page, frac); await wait(400)
    const a = await anchorNow(page)
    await page.locator("section[aria-label=Pane] button[aria-label='New tab']").first().click(); await wait(300)
    await page.evaluate((h) => { location.hash = h }, hash(OTHER)); await wait(800)
    await measure(page, `${label}: tab back at ${Math.round(frac * 100)}%`, a, async () => {
        await tabLoc(page, nameOf(file)).locator("[role=tab]").click()
    })
    if (await activeTab(page) !== nameOf(file)) console.log(`  (the active tab is ${await activeTab(page)}, not ${nameOf(file)})`)
    // Close the other tab, so the next round starts the same way.
    await tabLoc(page, nameOf(OTHER)).locator("[data-tab-close]").click({ force: true }).catch(() => {})
    await wait(300)
  }
  // The same file again in the same tab: away to another file and back (a pinned page, a link).
  if (STEPS.includes("same")) {
    await scrollTo(page, 0.5); await wait(400)
    const a = await anchorNow(page)
    await page.evaluate((h) => { location.hash = h }, hash(OTHER)); await wait(800)
    await measure(page, `${label}: same tab, away and back`, a, () => page.evaluate((h) => { location.hash = h }, hash(file)))
  }
  // Views: reading -> live preview -> source -> reading, from the middle.
  if (STEPS.includes("view")) await scrollTo(page, 0.5), await wait(500)
  for (const [to, keys] of STEPS.includes("view") ? [["live preview", "ControlOrMeta+e"], ["reading", "ControlOrMeta+e"]] : []) {
    const a = await anchorNow(page)
    await measure(page, `${label}: to ${to}`, a, () => page.keyboard.press(keys))
  }
  // The app reloaded: the place comes back (by its line, for a note).
  if (STEPS.includes("reload")) {
    await scrollTo(page, 0.6); await wait(600)
    const a = await anchorNow(page)
    await page.reload()
    await page.waitForSelector("article.file-view")
    await measure(page, `${label}: reloaded`, a, async () => {}, 2500)
  }
  await ctx.close()
  return full
}

const h = await suite(FILE, FILE.split("/").pop().replace(/\.md$/, ""))
if (VERBOSE) console.log(`(${FILE}: ${h}px to scroll)`)
if (NOTE) await suite(NOTE, NOTE.split("/").pop().replace(/\.md$/, ""))
await browser.close()
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2))
