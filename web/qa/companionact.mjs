// The companion acting in the app's own UI: act --ui clicks a sidebar row by its words, opens a folded panel and
// answers its rows, see --ui reads one, open shows a note with its cursor there. Throwaway server only (it opens tabs).
//   node web/qa/companionact.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/companionact-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const call = async (id, body) => {
  const r = await fetch(new URL(`/api/ops/${id}`, B), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
const shown = () => page.evaluate(() => [...document.querySelectorAll("[data-ui^='tab:']")].map((e) => e.getAttribute("aria-selected") === "true" || e.hasAttribute("data-active") ? `*${e.innerText.trim()}` : e.innerText.trim()).join(" | "))
const cursor = () => page.evaluate(() => { const e = document.querySelector(".companion-overlay [data-to]"); return e ? { to: e.getAttribute("data-to"), docked: e.hasAttribute("data-docked"), away: e.hasAttribute("data-away") } : null })
try {
  await page.goto(B)
  await page.waitForSelector("[data-ui='panel:pages:pages']")
  await wait(800)

  // A pinned page's row, clicked by its words: that page opens, its cursor on the row first.
  const r = await call("companion.act", { ui: "panel:pages:pages", find: "How this vault works", action: "click" })
  check("act --ui answers", r.status === 200 && r.body?.clicked !== undefined, r)
  check("the pinned page opened", await until(async () => /How this vault works/.test(await page.evaluate(() => document.title + " " + (document.querySelector("[data-ui^='pane:']")?.innerText ?? "")))), await shown())
  await page.screenshot({ path: `${OUT}act-ui.png` })

  // Words not there: a 404 that says what the panel shows.
  const miss = await call("companion.act", { ui: "panel:pages:pages", find: "No such page here", action: "click" })
  check("a miss says so, and nothing of what the panel shows", miss.status === 404 && !/it shows:/.test(miss.body?.error ?? ""), miss)
  // Typing into the app's UI isn't a click.
  const typed = await call("companion.act", { ui: "panel:pages:pages", action: "fill", value: "x" })
  check("only clicks in the app's UI", typed.status === 400, typed)

  // open: the note opens and its cursor goes to it (the pane it answers).
  const o = await call("companion.open", { path: "Start here.md" })
  check("open answers its pane", o.status === 200 && !!o.body?.pane, o)
  check("its cursor shows by the note", await until(async () => { const c = await cursor(); return !!c && !c.docked && !c.away }), await cursor())
  await page.screenshot({ path: `${OUT}open.png` })

  // A folded panel, clicked as a whole ("open files"): it unfolds, and its rows come back to point at.
  const files = "[data-ui='panel:files:files']"
  if (!(await page.$(`${files}[data-collapsed]`))) await page.click(`${files} [data-panel-handle] [aria-expanded]`)
  check("the Files panel is folded first", await until(async () => !!(await page.$(`${files}[data-collapsed]`))))
  const folded = await call("companion.see", { ui: "panel:files:files" })
  check("see --ui says a folded panel is folded", folded.status === 200 && /folded/.test(folded.body?.text ?? ""), folded)
  const op = await call("companion.act", { ui: "panel:files:files", action: "click" })
  check("act --ui on a panel opens it", op.status === 200 && op.body?.opened === true, op)
  check("it's unfolded on screen", await until(async () => !(await page.$(`${files}[data-collapsed]`))))
  check("its answer lists the panel's rows", /Start here/.test(op.body?.shows ?? ""), op.body?.shows)
  const again = await call("companion.act", { ui: "panel:files:files", action: "click" })
  check("asked again, it stays open", again.status === 200 && !(await page.$(`${files}[data-collapsed]`)), again)
  const read = await call("companion.see", { ui: "panel:files:files" })
  check("see --ui reads its rows", read.status === 200 && /Start here/.test(read.body?.text ?? ""), read)
  await page.screenshot({ path: `${OUT}panel-open.png` })

  // Words alone, from a note: the app's row saying them.
  const words = await call("companion.act", { find: "How this vault works", action: "click" })
  check("act --find alone clicks the app's UI", words.status === 200 && words.body?.clicked !== undefined, words)

  // A bad pane for act: a terminal or nothing says so.
  const none = await call("companion.act", { action: "click" })
  check("no page and no ui: says what to give", none.status >= 400, none)
} finally { await done() }
