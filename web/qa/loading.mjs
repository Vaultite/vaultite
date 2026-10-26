// Loading surfaces with the server's answers held back (--delay): how far each view moved once drawn, its CLS and busy
// time; then no shift at all in the shell (sidebars, status bar) after the first load (core/shifts.ts).
//   node web/qa/loading.mjs <base url> [--delay 600] [--views inbox,activity,connections] [--verbose]
// WRITES sidebars.json (put back) and opens tabs, which a workspace keeps: a throwaway server.
import { qa, wait } from "./lib/qa.mjs"
const { args, browser, check, done } = await qa(import.meta.url)

const B = args[0].endsWith("/") ? args[0] : `${args[0]}/`
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const DELAY = Number(opt("--delay", "600"))
const VIEWS = opt("--views", "inbox,activity,connections,machines,errors,search,plugins").split(",")
const VERBOSE = args.includes("--verbose")
/** A visit's shifts above this fail it: a list that came in without its room. */
const MOST = 0.05
/** ...and a second visit that moves more than this (px): its skeleton wasn't the data's size. */
const MOVED = 24

const PROBE = () => {
  const w = window
  w.__load = { shifts: [], busy: 0, heights: [] }
  const named = (n) => n instanceof Element ? `${n.tagName.toLowerCase()}${[...n.attributes].filter((a) => a.name.startsWith("data-")).map((a) => `[${a.name}]`).slice(0, 2).join("")}${typeof n.className === "string" ? n.className.split(/\s+/).filter(Boolean).slice(0, 2).map((c) => `.${c}`).join("") : ""}` : "?"
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (!e.hadRecentInput) w.__load.shifts.push({ t: Math.round(e.startTime), value: e.value, moved: (e.sources ?? []).map((s) => named(s.node)) })
  }).observe({ type: "layout-shift", buffered: true })
  const seen = () => {
    w.__load.busy = Math.max(w.__load.busy, document.querySelectorAll("[data-pane] [aria-busy=true]").length)
    // (the view's page: the shown pane's main, once its view has drawn something under its bar)
    const main = [...document.querySelectorAll("[data-pane]:not([data-kept]) > main")].find((m) => m.getClientRects().length && m.children.length > 1)
    const h = main ? Math.round(main.getBoundingClientRect().height) : null
    if (h !== null && h !== w.__load.heights.at(-1)) w.__load.heights.push(h)
    requestAnimationFrame(seen)
  }
  requestAnimationFrame(seen)
}

// (no service worker: what it answers from its cache would skip the hold)
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: "block" })
await ctx.addInitScript(PROBE)
// (held back: the app's reads, not its code, so what's drawn while waiting is the surfaces' own)
await ctx.route((u) => u.pathname.startsWith("/api/") && !u.pathname.startsWith("/api/live"), async (r) => { await wait(DELAY); await r.continue() })
const page = await ctx.newPage()

const rows = []
for (const view of VIEWS) {
  for (const visit of ["first", "again"]) {
    // (the app's kept answers would draw it at once (core/data.ts): left out, it loads as when they've gone stale)
    if (visit === "again") await page.evaluate(() => localStorage.removeItem("vaultite.live"))
    await page.goto("about:blank")
    await page.goto(`${B}#view/${view}`)
    await wait(DELAY * 3 + 2500)
    const { shifts, busy, heights } = await page.evaluate(() => window.__load)
    const moved = heights.slice(1).reduce((n, h, i) => n + Math.abs(h - heights[i]), 0)
    // (the app's first paint shifts the shell once it's drawn; only what came after it is the view's)
    const after = shifts.filter((s) => s.t > 300)
    const cls = after.reduce((n, s) => n + s.value, 0)
    rows.push({ view, visit, moved, heights: heights.join(" → "), cls: Math.round(cls * 1e4) / 1e4, busy, shifted: [...new Set(after.flatMap((s) => s.moved))].slice(0, 4) })
  }
}
// The shell: what the first load can't know (a note's headings) it learns for the next, so only those count.
const SHELL = ["left sidebar", "right sidebar", "status bar"]
const NOTE = "Notes/How this vault works.md"
const api = (p, init) => fetch(new URL(`/api/${p}`, B), init).then((r) => r.json())
const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const before = await api("config/sidebars")
const sidebars = { left: before.left, right: ["backlinks:links", "outline:outline", "tags:tags"], collapsed: ["tags:tags"], heights: {} }
const putSidebars = async (s) => {
  await api("config/sidebars", json("PUT", s))
  if ((await api("workspaces")).workspaces?.[0]) await api("workspaces/1", json("PUT", { sidebars: s }))
}
await putSidebars(sidebars)
const shell = []
for (const visit of ["first", "again", "kept"]) {
  if (visit === "again") await page.evaluate(() => localStorage.removeItem("vaultite.live"))
  await page.goto("about:blank")
  await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
  await wait(DELAY * 4 + 3000)
  const { shifts, right } = await page.evaluate(() => ({ shifts: window.__vauTrace?.shift ?? [], right: document.querySelectorAll("aside[data-side=right] [data-panel]").length }))
  const moved = shifts.filter((s) => s.regions.some((r) => SHELL.includes(r)))
  shell.push({ visit, right, shifts: moved.length, score: Math.round(moved.reduce((n, s) => n + s.value, 0) * 1e4) / 1e4, moved: [...new Set(moved.flatMap((s) => s.moved))].slice(0, 4) })
}
await putSidebars({ right: [], collapsed: [], heights: {}, ...before })
console.table(rows.map(({ shifted, heights, ...r }) => ({ ...r, ...(VERBOSE ? { heights, shifted: shifted.join(" ") } : {}) })))
// (the first visit can't know a list's length; the second must)
for (const r of rows) check(`${r.view} (${r.visit} visit) keeps still while it loads`, r.cls <= MOST && (r.visit === "first" || r.moved <= MOVED), r)
console.table(shell.map(({ moved, ...r }) => ({ ...r, ...(VERBOSE ? { moved: moved.join(" ") } : {}) })))
check("the right sidebar has its three panels", shell.every((r) => r.right === 3), shell)
for (const r of shell.filter((x) => x.visit !== "first")) check(`the sidebars and the status bar (${r.visit} visit) don't move while a note loads`, r.shifts === 0, r)
await done()
