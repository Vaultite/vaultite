// Editor benchmark: huge notes in live preview (opening, typing, Enter, scrolling, heap, switching), CPU ms from CDP
// medians over runs; several base URLs alternate runs. WRITES a "Qa editor perf" folder: throwaway server only.
//   node web/qa/editorperf.mjs <base url> [<another base url>...] [--runs 3] [--only name,name] [--out result.json] [--split]
//                              [--profile open|type|enter|arrow|scroll]: the step's top functions by self time
import fs from "node:fs"
import { launch, wait } from "./lib/qa.mjs"

const args = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt }
const BASES = args.filter((a) => /^https?:/.test(a)).map((b) => b.replace(/\/?$/, "/"))
if (!BASES.length) { console.error("usage: node web/qa/editorperf.mjs <base url> [...]"); process.exit(2) }
const RUNS = Number(opt("runs", "3")), ONLY = opt("only", ""), OUT = opt("out", ""), PROFILE = opt("profile", ""), SPLIT = args.includes("--split")
const DIR = "Qa editor perf"

// ---------- notes ----------
const words = "the quick brown fox jumps over a lazy dog while Alice Park reads notes about Lighthouse in spring".split(" ")
const sentence = (i, n = 14) => Array.from({ length: n }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(" ")
function mixed(lines) {
  const out = []
  for (let i = 0; out.length < lines; i++) {
    const s = i % 40
    if (s === 0) out.push(`## Section ${i}`, "")
    else if (s === 5) out.push(`- [ ] task ${i} with **bold** and [[Linked ${i % 50}]]`, `- [x] done ${i} with \`code\``, `  - nested *item* ${i}`, "")
    else if (s === 12) out.push("```js", `const a${i} = ${i}`, `function f${i}() { return a${i} * 2 }`, "```", "")
    else if (s === 20) out.push(`> [!note] Callout ${i}`, `> ${sentence(i)}`, "")
    else if (s === 28) out.push(`| a | b | c |`, `| - | - | - |`, `| ${i} | x | y |`, `| ${i + 1} | z | w |`, "")
    else out.push(`${sentence(i)} with a [link](https://example.com/${i}), *emphasis* and ==highlight== #tag${i % 9}.`, "")
  }
  return out.slice(0, lines).join("\n") + "\n"
}
const NOTES = {
  prose20k: () => mixed(20000),
  prose100k: () => mixed(100000),
  longlines: () => Array.from({ length: 1000 }, (_, i) => Array.from({ length: 40 }, (_, k) => sentence(i + k, 6)).join(" **and** ")).join("\n\n") + "\n",
  table5k: () => ["| id | name | value | note |", "| -- | ---- | ----- | ---- |", ...Array.from({ length: 5000 }, (_, i) => `| ${i} | name ${i} | ${i * 3} | ${sentence(i, 5)} |`)].join("\n") + "\n\nAfter the table.\n",
  blocks: () => Array.from({ length: 1500 }, (_, i) => i % 3 === 0 ? `\`\`\`python\nx = ${i}\nprint(x)\n\`\`\`\n` : i % 3 === 1 ? `![[pic${i % 20}.png]]\n` : `$$\nx^${i}\n$$\n`).join("\n") + "\n",
}
const names = Object.keys(NOTES).filter((n) => !ONLY || ONLY.split(",").includes(n))

async function write(base, path, text) {
  const r = await fetch(`${base}api/file`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, text, base: null }) })
  if (!r.ok) throw new Error(`write ${path}: ${r.status}`)
}
for (const base of BASES) {
  await fetch(`${base}api/ops/settings.set`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "editor", values: { defaultView: "editing", editingMode: "live" } }) })
  for (const n of names) await write(base, `${DIR}/${n}.md`, NOTES[n]())
}

// ---------- in the page ----------
// (the open note's EditorView, from its content element)
const VIEW = `window.__qaView = () => { const el = document.querySelector(".file-view .cm-content"); return el && (el.cmView?.view ?? el.cmTile?.view ?? null) }`
const viewOf = () => window.__qaView()
const cpu = async (cdp) => {
  const { metrics } = await cdp.send("Performance.getMetrics")
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]))
  return { task: m.TaskDuration * 1000, script: m.ScriptDuration * 1000, layout: (m.LayoutDuration + m.RecalcStyleDuration) * 1000, heap: m.JSHeapUsedSize / 2 ** 20 }
}
// A step's CPU profile, its functions by self time.
async function profiled(cdp, step, fn) {
  if (PROFILE !== step) return fn()
  await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 100 }); await cdp.send("Profiler.start")
  await fn()
  const { profile } = await cdp.send("Profiler.stop")
  const dt = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n])), parent = new Map()
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
  profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000))
  const key = (n) => { const f = n.callFrame; return `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber + 1}` }
  // Self time per function, and inclusive (each function once per stack).
  const self = new Map(), total = new Map(), via = new Map()
  for (const [id, ms] of dt) {
    const k = key(byId.get(id)); self.set(k, (self.get(k) ?? 0) + ms)
    const seen = new Set(), chain = []
    for (let x = id; x !== undefined; x = parent.get(x)) { const kk = key(byId.get(x)); chain.push(kk); if (!seen.has(kk)) { seen.add(kk); total.set(kk, (total.get(kk) ?? 0) + ms) } }
    const c = chain.slice(1, 5).join(" < "); const m = via.get(k) ?? new Map(); m.set(c, (m.get(c) ?? 0) + ms); via.set(k, m)
  }
  const top = (m, n) => [...m].filter(([k]) => !/^\((program|idle|root)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, n)
  console.log(`\nprofile ${step}, self:`)
  for (const [k, v] of top(self, 12)) {
    console.log(`${v.toFixed(1).padStart(8)} ms  ${k}`)
    for (const [c, ms] of [...via.get(k)].sort((a, b) => b[1] - a[1]).slice(0, 2)) console.log(`            ${ms.toFixed(1)} < ${c}`)
  }
  console.log(`\nprofile ${step}, total:`)
  for (const [k, v] of top(total, 30)) console.log(`${v.toFixed(1).padStart(8)} ms  ${k}`)
}
const idle = async (page, ms = 600, max = 30000) => {
  // Until no frame takes long for `ms`: the parser's background work is done.
  await page.evaluate(([ms, max]) => new Promise((done) => {
    const start = performance.now(); let last = performance.now(), quiet = performance.now()
    const tick = (t) => { if (t - last > 50) quiet = t; last = t; if (t - quiet > ms || t - start > max) done(); else requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  }), [ms, max])
}

async function measure(base, name) {
  const browser = await launch({ args: ["--js-flags=--expose-gc"] })
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await ctx.addInitScript(VIEW)
    const page = await ctx.newPage()
    const cdp = await ctx.newCDPSession(page)
    await cdp.send("Performance.enable")
    const errs = []
    page.on("pageerror", (e) => errs.push(String(e)))
    await page.goto(base); await page.waitForSelector("#main-scroll", { timeout: 30000 }); await wait(1500); await idle(page)
    const r = {}
    // (--split: also its script and style+layout parts)
    const put = (k, a, b, n = 1) => { r[k] = (b.task - a.task) / n; if (SPLIT) { r[`${k}Js`] = (b.script - a.script) / n; r[`${k}Layout`] = (b.layout - a.layout) / n } }
    let a = await cpu(cdp), t0 = Date.now()
    await profiled(cdp, "open", async () => {
      await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, `${DIR}/${name}.md`)
      await page.waitForFunction(viewOf, null, { timeout: 60000, polling: 50 })
      r.shownMs = Date.now() - t0
      await idle(page)
    })
    let b = await cpu(cdp)
    put("openCpu", a, b)
    await page.evaluate(() => window.gc?.()); r.heapMB = (await cpu(cdp)).heap

    // Typing in the middle: a sentence, then Enter ten times.
    await page.evaluate(() => {
      const v = window.__qaView(); const d = v.state.doc, l = d.line(Math.floor(d.lines / 2))
      v.focus(); v.dispatch({ selection: { anchor: l.to }, scrollIntoView: true })
    })
    await idle(page, 400)
    const text = " and some more words typed"
    a = await cpu(cdp)
    await profiled(cdp, "type", async () => { for (const ch of text) await page.keyboard.type(ch); await idle(page, 300) })
    b = await cpu(cdp); put("typeCpuPerKey", a, b, text.length)
    a = b
    await profiled(cdp, "enter", async () => { for (let i = 0; i < 10; i++) await page.keyboard.press("Enter"); await idle(page, 300) })
    b = await cpu(cdp); put("enterCpuPerKey", a, b, 10)
    a = b
    for (let i = 0; i < 10; i++) await page.keyboard.press("Backspace")
    await idle(page, 300)
    b = await cpu(cdp); put("backspaceCpuPerKey", a, b, 10)
    // A cursor move with arrows (no change): decorations picked again.
    a = b
    await profiled(cdp, "arrow", async () => { for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowUp"); await idle(page, 300) })
    b = await cpu(cdp); put("arrowCpuPerKey", a, b, 10)

    // Scrolling: from the top, 40 steps of a screen.
    await page.evaluate(() => { const v = window.__qaView(); v.scrollDOM.closest("[data-pane]")?.scrollTo?.(0, 0); v.scrollDOM.scrollTo(0, 0) })
    await idle(page, 300)
    a = await cpu(cdp)
    await profiled(cdp, "scroll", () => page.evaluate(async () => {
      const v = window.__qaView()
      let s = v.scrollDOM; while (s && s.scrollHeight <= s.clientHeight + 1) s = s.parentElement
      if (!s) return
      for (let i = 0; i < 40; i++) { s.scrollTop += s.clientHeight; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))) }
    }))
    await idle(page, 300)
    b = await cpu(cdp); put("scrollCpuPerStep", a, b, 40)

    // Switching away to another note and back.
    a = await cpu(cdp)
    await page.evaluate(() => { location.hash = `#file/${encodeURIComponent("Start here.md")}` })
    await wait(800); await idle(page, 300)
    await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, `${DIR}/${name}.md`)
    await page.waitForFunction(viewOf, null, { timeout: 60000, polling: 50 }); await idle(page)
    b = await cpu(cdp); put("switchCpu", a, b)
    if (errs.length) r.errors = errs.slice(0, 3)
    return r
  } finally { await browser.close() }
}

const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
const results = {}
for (let run = 0; run < RUNS; run++) for (const name of names) for (const base of BASES) {
  const r = await measure(base, name)
  ;((results[base] ??= {})[name] ??= []).push(r)
  if (r.errors) console.error(base, name, r.errors)
}
const summary = {}
for (const base of BASES) for (const name of names) {
  const rs = results[base][name], keys = Object.keys(rs[0]).filter((k) => typeof rs[0][k] === "number")
  ;(summary[name] ??= {})[base] = Object.fromEntries(keys.map((k) => [k, Math.round(med(rs.map((r) => r[k])) * 10) / 10]))
}
for (const name of names) {
  console.log(`\n${name}`)
  console.table(summary[name])
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(summary, null, 2))
