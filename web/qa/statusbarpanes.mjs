// The desktop status bar split along the panes (components/statusColumns.ts): the focused file's items right under its
// pane, each other pane's file in a word under its own, the right corner at the right of the panes it may draw over (not
// a chat's or a terminal's foot), a narrow pane's part down to its word count, a word clicked focusing its pane.
// WRITES workspace 1's layout and three notes (put back, removed): throwaway server only.
//   node web/qa/statusbarpanes.mjs <base url>
import { apiAt, qa, SHOTS, until, wait } from "./lib/qa.mjs"

const { args: [B0], browser, check, watch, done } = await qa(import.meta.url)
const B = B0.endsWith("/") ? B0 : `${B0}/`
const api = apiAt(B)
const N = ["Qa panes one.md", "Qa panes two.md", "Qa panes three.md"]
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ")
for (const [i, p] of N.entries()) await api("POST", "file", { path: p, text: `# Pane ${i + 1}\n\n${words(10 * (i + 1))}\n` })
const looks = await api("GET", "config/appearance")
const was = (await api("GET", "workspaces")).workspaces?.find((w) => w.n === 1 || w.slot === 1)
const put = (layout) => api("PUT", "workspaces/1", { layout })
/** A pane (the tabs' layouts hold panes: one tab of them all, core/layout.ts). */
const g = (id, to) => ({ id, to })
const tabsOf = (root, focus) => ({ tabs: [{ id: "tqa", root, focus }], active: "tqa" })
const row = (...kids) => ({ id: "s0", dir: "row", kids, sizes: kids.map(() => 1 / kids.length) })
const file = (p) => `file:${p}`

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => {
    if (location.protocol === "about:") return
    if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") }
    const tabs = new URLSearchParams(location.search).get("qa-tabs")
    if (tabs) { localStorage.setItem("vaultite.tabs", tabs); history.replaceState(null, "", location.pathname) }
  })
  const page = watch(await ctx.newPage(), { console: true })
  const still = () => page.waitForFunction(() => !document.getAnimations().some((a) => a.id === "pane-motion")).then(() => wait(450))
  /** Lay the panes out, and load the app on them. */
  const open = async (layout, focus) => {
    // (this device's tabs, set before the app runs, and the workspace's, which it would otherwise take on)
    await put(tabsOf(layout, focus))
    await page.goto("about:blank"); await page.goto(`${B}?qa-tabs=${encodeURIComponent(JSON.stringify(tabsOf(layout, focus)))}`)
    await until(() => page.evaluate(() => document.querySelectorAll("[data-pane-area] > section[data-pane-frame]:not([data-away])").length), 15000)
    await still()
  }
  /** Each pane's box, and each part of the bar drawn: its box and what it says. */
  const look = () => page.evaluate(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width) } }
    const panes = Object.fromEntries([...document.querySelectorAll("[data-pane-area] > section[data-pane-frame]:not([data-away])")].map((s) => [s.dataset.paneFrame, box(s)]))
    const parts = [...document.querySelectorAll("[data-status-bar]")].filter((el) => el.offsetWidth).map((el) => ({
      kind: "statusLeft" in el.dataset ? "left" : "statusRight" in el.dataset ? "right" : "statusPane" in el.dataset ? "pane" : "word",
      ...box(el), text: el.innerText.replace(/\s+/g, " ").trim(),
      keys: [...el.querySelectorAll("[data-status-key]")].filter((k) => k.offsetWidth && k.textContent).map((k) => k.dataset.statusKey),
      words: [...el.querySelectorAll("[data-status-word]")].map((w) => w.dataset.statusWord),
    }))
    return { panes, parts, vw: innerWidth }
  })
  const part = (l, kind) => l.parts.find((p) => p.kind === kind)
  const within = (p, pane) => p && p.l >= pane.l - 1 && p.r <= pane.r + 1
  const strip = (name) => page.screenshot({ path: `${SHOTS}statusbarpanes-${name}.png`, clip: { x: 0, y: 900 - 90, width: 1440, height: 90 } })

  // 1. Two notes, the left one focused: its items under it, the right one's word in the right corner.
  await open(row(g("ga", file(N[0])), g("gb", file(N[1]))), "ga")
  await until(async () => /word/.test(part(await look(), "pane")?.text ?? ""), 10000)
  let l = await look()
  const seg = part(l, "pane"), right = part(l, "right")
  check("two notes: the focused one's items in a part right under it", within(seg, l.panes.ga) && Math.abs(seg.r - l.panes.ga.r) <= 2 && seg.keys.includes("core:words"), { seg, pane: l.panes.ga })
  check("…the other's word count in the right corner, under it, fainter, alone", within(right, l.panes.gb) && right.words.includes("gb") && /22 words/.test(right.text) && !right.keys.includes("core:words"), right)
  await strip("1-two-notes")

  // 2. The right one focused: its items in the right corner, the left one's word under the left pane.
  await page.locator('[data-pane-body="gb"] .cm-content').first().click(); await wait(600)
  l = await look()
  const word = l.parts.find((p) => p.kind === "word")
  check("focus moved right: the right corner has its items", part(l, "right")?.keys.includes("core:words") && !part(l, "pane"), l.parts)
  check("…the left one's word under its pane, at its right", within(word, l.panes.ga) && Math.abs(word.r - l.panes.ga.r) <= 2 && /12 words/.test(word.text), word)
  await strip("2-focus-right")
  // A word clicked focuses its pane.
  await page.locator('[data-status-word="ga"]').click(); await wait(600)
  l = await look()
  check("its word clicked: the left pane focused, its items back under it", within(part(l, "pane"), l.panes.ga) && part(l, "pane").keys.includes("core:words")
    && await page.evaluate(() => !!document.querySelector('section[data-pane-frame="ga"][data-focused]')), l.parts)

  // 3. A note beside a chat: nothing over the chat's foot (its input); the right corner at the note's right.
  await open(row(g("ga", file(N[0])), g("gc", "view:claude-session/new")), "ga")
  await until(async () => /word/.test(part(await look(), "right")?.text ?? ""), 10000)
  l = await look()
  check("note | chat: the right corner under the note, at its right", within(part(l, "right"), l.panes.ga) && Math.abs(part(l, "right").r - l.panes.ga.r) <= 2, { parts: l.parts, panes: l.panes })
  check("…nothing of the bar over the chat", l.parts.every((p) => p.r <= l.panes.gc.l + 1), l.parts)
  await strip("3-note-chat")
  // Focused, the chat: the note's word under it, still nothing over the chat.
  await page.locator('[data-pane-body="gc"]').click({ position: { x: 200, y: 200 } }); await wait(600)
  l = await look()
  check("chat focused: the note's word under the note, nothing over the chat", /12 words/.test(part(l, "right")?.text ?? "") && within(part(l, "right"), l.panes.ga) && l.parts.every((p) => p.r <= l.panes.gc.l + 1), l.parts)
  await strip("4-chat-focused")

  // 4. Three notes, the middle one focused: its items under it; the others' words under theirs.
  await open(row(g("ga", file(N[0])), g("gb", file(N[1])), g("gd", file(N[2]))), "gb")
  await until(async () => /word/.test(part(await look(), "pane")?.text ?? ""), 10000)
  l = await look()
  check("three notes: the middle one's items under it", within(part(l, "pane"), l.panes.gb) && part(l, "pane").keys.includes("core:words"), l.parts)
  check("…the left one's word under it, the right one's in the right corner", within(l.parts.find((p) => p.kind === "word"), l.panes.ga) && /32 words/.test(part(l, "right")?.text ?? ""), l.parts)
  check("…each part in its pane's column", l.parts.every((p) => Object.values(l.panes).some((pane) => within(p, pane))), { parts: l.parts, panes: l.panes })
  await strip("5-three-notes")

  // 5. Narrow: the focused pane's part down to its word count, the rest to the tray; never past its column.
  await page.setViewportSize({ width: 860, height: 900 }); await wait(800)
  l = await look()
  const narrow = part(l, "pane")
  check("narrow: the focused part keeps its word count, the characters left out", narrow?.keys.includes("core:words") && !narrow.keys.includes("core:characters"), narrow)
  check("…every part inside its column", l.parts.every((p) => Object.values(l.panes).some((pane) => within(p, pane))), { parts: l.parts, panes: l.panes })
  await page.screenshot({ path: `${SHOTS}statusbarpanes-6-narrow.png`, clip: { x: 0, y: 900 - 90, width: 860, height: 90 } })
  await page.setViewportSize({ width: 1440, height: 900 }); await wait(500)

  // 6. Panes as cards: each part a chip in its card, a gap (6px) in from the card's bottom-right corner.
  await api("PATCH", "config/appearance", { paneCards: true })
  await open(row(g("ga", file(N[0])), g("gb", file(N[1]))), "ga")
  await until(async () => /word/.test(part(await look(), "pane")?.text ?? ""), 10000)
  l = await look()
  const inset = (p, pane) => p && Math.abs(pane.r - p.r - 6) <= 1 && Math.abs(pane.b - p.b - 6) <= 1
  check("as cards: the focused part a gap in from its card's corner", inset(part(l, "pane"), l.panes.ga) && within(part(l, "pane"), l.panes.ga), { parts: l.parts, panes: l.panes })
  check("…the right corner a gap in from the right card's", inset(part(l, "right"), l.panes.gb), { parts: l.parts, panes: l.panes })
  await strip("7-cards")
  await api("PATCH", "config/appearance", { paneCards: looks.paneCards ?? null })

  // 7. One pane: the bar as it always was, at the window's right.
  await open(g("ga", file(N[0])), "ga")
  await until(async () => /word/.test(part(await look(), "right")?.text ?? ""), 10000)
  l = await look()
  check("one pane: one right corner, at the window's right, with the file's items", !part(l, "pane") && !l.parts.some((p) => p.kind === "word")
    && Math.abs(part(l, "right").r - l.panes.ga.r) <= 2 && part(l, "right").keys.includes("core:words"), l.parts)
  await strip("8-one-pane")
} finally {
  await api("PATCH", "config/appearance", { paneCards: looks.paneCards ?? null })
  if (was?.layout) await api("PUT", "workspaces/1", { layout: was.layout })
  else await api("DELETE", "workspaces/1")
  for (const p of N) await fetch(`${B}api/file?path=${encodeURIComponent(p)}`, { method: "DELETE" })
}
await done()
