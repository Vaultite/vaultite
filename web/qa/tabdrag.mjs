// A tab dragged along the Tabs panel and the tab bar, frame by frame: the tabs make way once each and never slide back
// while the pointer goes on or holds still (held on a tab's middle too, where it holds still and opens after a moment,
// and just past a tab group's last tab), what's dragged stays a tab over the list (never a card of its panes, as pulled
// off), and let go it lands in its place from where it was let go. Writes the vault's appearance and sidebars (put
// back): throwaway server only.
//   node web/qa/tabdrag.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { qa, wait } from "./lib/qa.mjs"
const { args: [B0, VAULT, OUT = "/tmp/tabdrag-shots/"], browser, check, watch, done } = await qa(import.meta.url, { motion: true })
const B = B0.endsWith("/") ? B0 : `${B0}/`
mkdirSync(OUT, { recursive: true })
const keep = (f) => { const p = path.join(VAULT, ".vaultite", f); return { p, was: existsSync(p) ? readFileSync(p, "utf8") : null } }
const sidebars = keep("sidebars.json"), look = keep("appearance.json")
const appearance = (v) => writeFileSync(look.p, JSON.stringify({ ...JSON.parse(look.was ?? "{}"), ...v }) + "\n")

// [Start here] (Lighthouse: five tabs) [Search] [Graph] [blank], Start here on screen.
const f = (p) => `file:${p}`
const t = (id, to, group) => ({ id, root: { id: `p${id}`, to }, focus: `p${id}`, ...(group ? { group } : {}) })
const seed = {
  groups: [{ id: "g1", name: "Lighthouse", color: "purple" }],
  tabs: [t("p0", f("Start here.md")), t("a1", f("ME.md"), "g1"), t("a2", f("Notes/Lisbon trip.md"), "g1"), t("a3", f("Notes/How this vault works.md"), "g1"),
    t("a4", f("Projects/Garden planner.md"), "g1"), t("a5", f("Projects/Lighthouse.md"), "g1"), t("u1", "view:search"), t("u2", "view:graph"), t("x", "new")],
  active: "p0",
}
const ORDER = seed.tabs.map((x) => x.id)

async function open(sel) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript((s) => { if (!sessionStorage.getItem("qa.seeded")) { localStorage.setItem("vaultite.tabs", s); sessionStorage.setItem("qa.seeded", "1") } }, JSON.stringify(seed))
  const page = watch(await ctx.newPage())
  await page.goto(`${B}#file/${encodeURIComponent("Start here.md")}`)
  await page.waitForSelector(`${sel} [data-slide='a5']`)
  await wait(1000)
  return { ctx, page }
}

/** Records every frame from now on: where each of the list's items is going (its slide's target, not where its
 *  transition has got to) and where it's drawn, the drag's picture, the lit tab and the pointer. */
const record = (page, sel, axis) => page.evaluate(([sel, axis]) => {
  const out = window.__frames = []
  let px = 0, py = 0
  addEventListener("pointermove", (e) => { px = e.clientX; py = e.clientY }, true)
  // (read once the frame's callbacks have all run, as it's painted: a drop's landing starts in one)
  const tick = () => setTimeout(() => {
    const root = document.querySelector(sel), rows = {}
    for (const e of root?.querySelectorAll("[data-slide]") ?? []) {
      const r = e.getBoundingClientRect(), m = /translate[XY]\((-?[\d.]+)px\)/.exec(e.style.transform)
      rows[e.dataset.slide] = { to: m ? Math.round(+m[1]) : 0, at: Math.round((axis === "y" ? r.top : r.left) * 10) / 10 }
    }
    const g = document.querySelector("[data-drag-ghost]"), c = g?.querySelector("[data-drag-card]")?.getBoundingClientRect()
    out.push({ t: performance.now(), px, py, rows, active: document.querySelector("[data-open-tab].font-medium, [data-tab-bar] [role=tab][aria-selected=true]")?.closest("[data-slide]")?.dataset.slide,
      lit: [...document.querySelectorAll("[data-spring-tab]")].filter((e) => !e.querySelector(".font-medium[data-open-tab], [aria-selected=true]") && /bg-foreground\/\[0\.08\]/.test(e.className + (e.firstElementChild?.className ?? ""))).map((e) => e.dataset.springTab),
      ghost: g ? { look: g.dataset.dragLook, shape: g.dataset.dragShape ?? "", w: Math.round(c?.width ?? 0), h: Math.round(c?.height ?? 0), at: Math.round(axis === "y" ? c?.top ?? 0 : c?.left ?? 0) } : null })
    requestAnimationFrame(tick)
  })
  requestAnimationFrame(tick)
}, [sel, axis])
const frames = (page) => page.evaluate(() => window.__frames.splice(0))

/** Where each of the list's items starts and ends along the axis, as laid out now. */
const spans = (page, sel, axis) => page.evaluate(([sel, axis]) => Object.fromEntries([...document.querySelectorAll(`${sel} [data-slide]`)].map((e) => {
  const r = e.getBoundingClientRect()
  return [e.dataset.slide, axis === "y" ? [r.top, r.bottom] : [r.left, r.right]]
})), [sel, axis])
/** The tabs in the list as drawn, each with its tab group. */
const drawn = (page, sel) => page.evaluate((sel) => [...document.querySelectorAll(`${sel} [data-slide]`)].filter((e) => !e.dataset.slide.startsWith("group:") && e.dataset.slide !== "new").map((e) => `${e.dataset.slide}${e.dataset.inGroup ? `@${e.dataset.inGroup}` : ""}`).join(" "), sel)

/** Presses tab `id` on its middle and drags it along `axis` to each place in `path` (px along the axis), a few px a
 *  frame; at each `{ hold: ms }` it holds still. Ends held. */
async function drag(page, sel, axis, id, path) {
  const b = await page.locator(`${sel} [data-slide='${id}']`).boundingBox()
  const x0 = axis === "y" ? b.x + 60 : b.x + b.width / 2, y0 = b.y + b.height / 2
  await page.mouse.move(x0, y0); await page.mouse.down()
  let d = axis === "y" ? y0 : x0
  for (const p of path) {
    if (p.hold) { await wait(p.hold); continue }
    while (Math.abs(p - d) >= 1) {
      d += Math.sign(p - d) * Math.min(axis === "y" ? 2 : 3, Math.abs(p - d))
      await page.mouse.move(axis === "y" ? x0 : d, axis === "y" ? d : y0); await wait(24)
    }
  }
}

/** Each item's slide target over the frames: the values it took in turn (a change back to one it had: a snap back). */
function targets(fs) {
  const seq = {}
  for (const f of fs) for (const [k, r] of Object.entries(f.rows)) { const s = (seq[k] ??= []); if (s.at(-1) !== r.to) s.push(r.to) }
  return seq
}
const backs = (seq) => Object.entries(seq).filter(([, s]) => new Set(s).size < s.length).map(([k, s]) => `${k}: ${s.join(" > ")}`)
/** Frames, from `ms` into each hold of the pointer to its end, where something moved: nothing moves the pointer didn't. */
function stillWhileHeld(fs) {
  const moved = []
  let from = null
  for (let i = 1; i < fs.length; i++) {
    const a = fs[i - 1], b = fs[i]
    if (a.px !== b.px || a.py !== b.py) { from = b.t; continue }
    if (from === null || b.t - from < 360) continue
    for (const [k, r] of Object.entries(b.rows)) if (a.rows[k] && Math.abs(a.rows[k].at - r.at) > 0.5) moved.push(`${k} at ${Math.round(b.t - from)}ms held: ${a.rows[k].at} > ${r.at}`)
  }
  return moved
}
/** The checks every drag's frames pass: none slides back, nothing moves while the pointer holds still, what's dragged
 *  stays the tab it is (never a card of its panes, as pulled off the list), and no tab passed over lights. */
function steady(name, fs, { moved, still, passed }) {
  const seq = targets(fs)
  check(`${name}: each tab makes way once and never slides back`, !backs(seq).length && moved.every((k) => seq[k]?.length === 2) && still.every((k) => seq[k]?.length === 1),
    backs(seq).length ? backs(seq) : seq)
  check(`${name}: nothing moves while the pointer holds still (on its own place, a tab's middle, a group's end)`, !stillWhileHeld(fs).length, stillWhileHeld(fs).slice(0, 6))
  const looks = fs.filter((x) => x.ghost).map((x) => `${x.ghost.look}${x.ghost.shape ? `:${x.ghost.shape}` : ""} ${x.ghost.h}`)
  check(`${name}: what's dragged stays a tab the whole way, never a card of its panes`, looks.length > 20 && looks.every((x) => /^tab 2\d$/.test(x)), [...new Set(looks)])
  check(`${name}: a tab passed over doesn't light`, !fs.some((x) => passed.some((k) => x.lit.includes(k))), [...new Set(fs.flatMap((x) => x.lit))])
}
/** Let go: it slides from where its picture was into its place (no jump there), the picture gone. */
async function lands(name, page, id) {
  const before = await frames(page)
  const was = before.findLast((x) => x.ghost)?.ghost.at
  await page.mouse.up(); await wait(700)
  const after = (await frames(page)).filter((x) => !x.ghost && x.rows[id]), at = after.map((x) => x.rows[id].at)
  const end = at.at(-1), dir = Math.sign(end - at[0])
  check(`${name}: let go, it slides from where it was let go into its place`, Math.abs(at[0] - was) < 4 && Math.abs(at[0] - end) > 2 && at.every((v, i) => !i || (v - at[i - 1]) * dir > -1.2),
    { was, at: at.slice(0, 12) })
}

try {
  // ---------- the Tabs panel ----------
  appearance({ tabBar: false, theme: "light" })
  writeFileSync(sidebars.p, JSON.stringify({ left: ["tabs:tabs", "files:files"], right: [], collapsed: [] }) + "\n")
  await wait(800)
  const P = "[data-open-tabs]"
  {
    const { ctx, page } = await open(P)
    const s = await spans(page, P, "y"), mid = (id) => (s[id][0] + s[id][1]) / 2
    await record(page, P, "y")
    // Lisbon trip (a2) down through its group: a moment on its own place, held on the middle of Garden planner (a4) and
    // of the group's last tab (a5), and just past it, then held on Search's middle (u1) till Search opens.
    await drag(page, P, "y", "a2", [mid("a2") + 8, { hold: 500 }, mid("a4"), { hold: 700 }, mid("a5"), { hold: 500 }, s.a5[1] + 2, { hold: 700 }, mid("u1"), { hold: 1400 }])
    const fs = await frames(page)
    await page.screenshot({ path: `${OUT}panel-held.png`, clip: { x: 0, y: 0, width: 520, height: 420 } })
    // (held on Search's middle, it goes before it: Search holds still)
    steady("the panel, down", fs, { moved: ["a3", "a4", "a5"], still: ["p0", "a1", "u1", "u2"], passed: ["a3"] })
    check("the panel: held on a tab's middle, it lights, then opens, the rows holding still", fs.some((x) => x.lit.includes("a4")) && fs.at(-1).active === "u1", { lit: [...new Set(fs.flatMap((x) => x.lit))], active: fs.at(-1).active })
    await lands("the panel, down", page, "a2")
    check("  it's out of its group, before Search", (await drawn(page, P)) === "p0 a1@g1 a3@g1 a4@g1 a5@g1 a2 u1 u2 x", await drawn(page, P))
    await ctx.close()
  }
  {
    const { ctx, page } = await open(P)
    const s = await spans(page, P, "y"), mid = (id) => (s[id][0] + s[id][1]) / 2
    await record(page, P, "y")
    // Graph (u2) up through the group, held on How this vault works' middle (a3), then over the panel's heading, above the
    // first tab, held there: let go, it's first.
    await drag(page, P, "y", "u2", [mid("u2") - 6, { hold: 400 }, mid("a3"), { hold: 700 }, s.p0[0] - 8, { hold: 600 }])
    const fs = await frames(page)
    steady("the panel, up", fs, { moved: ["u1", "a5", "a4", "a3", "a2", "a1", "group:g1", "p0"], still: ["x"], passed: ["a4", "a2"] })
    await lands("the panel, up", page, "u2")
    check("  dropped over the panel's heading, it's first", (await drawn(page, P)) === "u2 p0 a1@g1 a2@g1 a3@g1 a4@g1 a5@g1 u1 x", await drawn(page, P))
    await ctx.close()
  }

  // ---------- the tab bar ----------
  appearance({ tabBar: true, theme: "light" })
  writeFileSync(sidebars.p, JSON.stringify({ left: ["files:files"], right: [], collapsed: [] }) + "\n")
  await wait(800)
  const T = "[data-tab-row]"
  {
    const { ctx, page } = await open(T)
    const s = await spans(page, T, "x"), mid = (id) => (s[id][0] + s[id][1]) / 2
    await record(page, T, "x")
    await drag(page, T, "x", "a2", [mid("a2") + 8, { hold: 500 }, mid("a4"), { hold: 700 }, s.a5[1] + 2, { hold: 700 }, mid("u1"), { hold: 600 }])
    const fs = await frames(page)
    await page.screenshot({ path: `${OUT}bar-held.png`, clip: { x: 0, y: 0, width: 1280, height: 120 } })
    steady("the tab bar", fs, { moved: ["a3", "a4", "a5"], still: ["p0", "a1", "u1", "u2"], passed: ["a3"] })
    await lands("the tab bar", page, "a2")
    check("  it's out of its group, before Search", (await drawn(page, T)) === "p0 a1@g1 a3@g1 a4@g1 a5@g1 a2 u1 u2 x", await drawn(page, T))
    await ctx.close()
  }
} finally {
  for (const x of [sidebars, look]) if (x.was === null) rmSync(x.p, { force: true }); else writeFileSync(x.p, x.was)
}
await done()
