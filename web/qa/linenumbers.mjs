// Line numbers (appearance.json `lineNumbers`) on every editor that has them: a note in live preview and source mode,
// and a code file, at desktop width, a narrow window and a phone. Each number is drawn, on its line's first row's baseline,
// and clear of the text and of the folding chevrons. WRITES the vault (a "Qa numbers" folder, appearance): throwaway
// server only.
//   node web/qa/linenumbers.mjs <base url> <vault path> [out dir]
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { SHOTS, apiAt, qa } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = `${SHOTS}linenumbers/`], browser, check, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const DIR = "Qa numbers"
rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
mkdirSync(`${VAULT}/${DIR}`, { recursive: true })
const lines = ["---", "origin: ai", "tags: [a, b]", "---", "", "# Heading one", "", "Some text long enough to wrap on a phone, and then some more words to be sure it wraps.", "",
  "## Heading two", "### Heading three", "#### Heading four", "##### Heading five", "###### Heading six", "",
  "- **Bold** item", "  - nested", "1. first", "2. second", "- [ ] a task", "- [x] done task", "",
  "> A quote that is also long enough to wrap onto a second row on a phone screen.", "", "> [!note] A callout", "> Its body.", "",
  "```js", "const a = 1", "```", "", "| a | b |", "| - | - |", "| 1 | 2 |", "", "Text with `code`, ==highlight== and a [[Link]].", "", "---", "",
  ...Array.from({ length: 100 }, (_, i) => `Line ${i}`)]
writeFileSync(`${VAULT}/${DIR}/Numbers.md`, lines.join("\n") + "\n")
writeFileSync(`${VAULT}/${DIR}/sample.py`, Array.from({ length: 120 }, (_, i) => `x${i} = ${i}`).join("\n") + "\n")
const api = apiAt(B)
const saved = await api("GET", "config/appearance")
await api("PUT", "config/appearance", { ...saved, lineNumbers: true })


/** Each drawn number's box (its text's) and baseline, its line's first row's baseline, the text's left edge and the
 *  chevrons' boxes. A baseline: a text's top plus where a 0-high inline box sits in its font (a probe). */
const measure = () => {
  const ed = document.querySelector(".vau-editor:is(.has-numbers, .is-code)")
  if (!ed) return null
  const content = ed.querySelector(".cm-content").getBoundingClientRect()
  const view = ed.querySelector(".cm-editor")
  const probe = (cs) => {
    const d = document.createElement("div"); d.style.cssText = `position:absolute;top:0;left:0;font:${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily};line-height:normal;visibility:hidden`
    d.innerHTML = '<span>Hg</span><span style="display:inline-block;width:1px;height:0"></span>'
    document.body.append(d); const [t, m] = d.children; const b = m.getBoundingClientRect().bottom - t.getBoundingClientRect().top; d.remove(); return b
  }
  const baselineOf = (root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n; (n = w.nextNode());) {
      if (!n.textContent.trim()) continue
      const r = document.createRange(); r.setStart(n, 0); r.setEnd(n, 1); const b = r.getBoundingClientRect()
      if (b.width && b.height) return { top: b.top, base: b.top + probe(getComputedStyle(n.parentElement)) }
    }
    return null
  }
  const rows = [...ed.querySelector(".cm-content").children].map((l) => ({ top: l.getBoundingClientRect().top, text: l.textContent.slice(0, 30), b: baselineOf(l) }))
  const nums = [...ed.querySelectorAll(".cm-lineNumbers .cm-gutterElement")].filter((e) => e.textContent && e.offsetHeight).map((e) => {
    const r = document.createRange(); r.selectNodeContents(e); const b = r.getBoundingClientRect()
    const top = e.getBoundingClientRect().top - (parseFloat(e.style.translate.split(" ")[1] ?? "") || 0)
    const row = rows.find((x) => Math.abs(x.top - top) < 1.5)
    return { n: e.textContent, left: b.left, right: b.right, top: b.top, h: b.height, base: b.top + probe(getComputedStyle(e)), line: row?.text, lineBase: row?.b?.base }
  })
  const folds = [...ed.querySelectorAll(".cm-vau-fold-gutter .cm-gutterElement")].filter((e) => e.offsetHeight).map((e) => e.getBoundingClientRect())
  const clip = view.getBoundingClientRect()
  return { contentLeft: content.left, viewLeft: clip.left, lineTops: rows.map((r) => r.top), nums, folds: folds.map((f) => ({ left: f.left, right: f.right })), visible: getComputedStyle(ed.querySelector(".cm-gutters") ?? ed).display !== "none" }
}

async function surface(name, { w, file, mode, size }) {
  const mobile = w < 768 && w !== 600
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: "dark" })
  await ctx.addInitScript(([m, size]) => {
    localStorage.setItem("vaultite.fileMode", m); localStorage.setItem("vaultite.editMode", m)
    // A note text size (a CSS zoom on the note): this device's pref.
    if (size) { const p = JSON.parse(localStorage.getItem("vaultite.prefs") ?? "{}"); localStorage.setItem("vaultite.prefs", JSON.stringify({ ...p, device: { ...p.device, "textSize:note": size } })) }
  }, [mode, size])
  const page = await ctx.newPage()
  // A phone (a narrow window too) opens a file in a sheet over a page.
  await page.goto(`${B}#${w < 768 ? "view/files/" : ""}file/${encodeURIComponent(`${DIR}/${file}`)}`)
  await page.waitForSelector(".vau-editor:is(.has-numbers, .is-code) .cm-lineNumbers .cm-gutterElement", { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(800)
  // A pointer over the text shows a chevron (desktop), so it's measured too.
  if (!mobile) await page.locator(".cm-line", { hasText: "A heading" }).first().hover().catch(() => {})
  const m = await page.evaluate(measure)
  await page.screenshot({ path: `${OUT}${name}.png` })
  check(`${name}: numbers drawn`, m && m.visible && m.nums.length > 5, m && { visible: m.visible, n: m.nums.length })
  if (m?.nums.length) {
    const over = m.nums.filter((x) => x.right > m.contentLeft - 4)
    check(`${name}: numbers clear of the text (a gap of 4px)`, !over.length, { contentLeft: m.contentLeft, over: over.slice(0, 3) })
    const cut = m.nums.filter((x) => x.left < m.viewLeft - 30)
    check(`${name}: numbers inside the page`, !cut.length, cut.slice(0, 3))
    const drift = m.nums.filter((x) => x.lineBase !== undefined && Math.abs(x.base - x.lineBase) > 1).map((x) => ({ n: x.n, line: x.line, off: +(x.base - x.lineBase).toFixed(1) }))
    check(`${name}: each number on its line's baseline`, !drift.length, drift)
    // Typing (each keystroke measures them again) moves a number at most once: when its line moves.
    if (!mobile && file.endsWith(".md")) {
      await page.evaluate(() => {
        window.__moved = new Map()
        const els = () => [...document.querySelectorAll(".vau-editor .cm-lineNumbers .cm-gutterElement")].filter((e) => e.textContent)
        let last = new Map(els().map((e) => [e.textContent, e.style.translate]))
        const tick = () => {
          for (const e of els()) {
            const was = last.get(e.textContent)
            if (was !== undefined && was !== e.style.translate) window.__moved.set(e.textContent, [...(window.__moved.get(e.textContent) ?? []), `${was} -> ${e.style.translate}`])
          }
          last = new Map(els().map((e) => [e.textContent, e.style.translate]))
          if (!window.__stop) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      await page.locator(".cm-line", { hasText: "Some text long enough" }).first().click(); await page.keyboard.press("End")
      for (const ch of " and more words, typed one by one until the line wraps onto a few more rows below it".split("")) { await page.keyboard.type(ch); await page.waitForTimeout(25) }
      await page.waitForTimeout(300)
    }
    const moved = await page.evaluate(() => { window.__stop = true; return [...(window.__moved ?? new Map())].filter(([, m]) => m.length > 1).map(([n, m]) => `${n}: ${m.join(", ")}`) })
    check(`${name}: numbers hold still`, !moved.length, moved.slice(0, 3))
    const hit = m.folds.filter((f) => m.nums.some((x) => x.right > f.left + 0.5 && x.left < f.right - 0.5) || f.right > m.contentLeft + 0.5)
    check(`${name}: chevrons clear of numbers and text`, !hit.length, hit.slice(0, 3))
  }
  await ctx.close()
}

for (const [w, tag] of [[1200, "desktop"], [600, "narrow"], [390, "phone"]]) {
  await surface(`${tag}-live`, { w, file: "Numbers.md", mode: "live" })
  await surface(`${tag}-source`, { w, file: "Numbers.md", mode: "source" })
  await surface(`${tag}-code`, { w, file: "sample.py", mode: "live" })
}
await surface("desktop-live-110", { w: 1200, file: "Numbers.md", mode: "live", size: 110 })
await browser.close()
await api("PUT", "config/appearance", saved)
rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
await done()
