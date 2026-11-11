// The companion's one UI model in Vaultite's window (core/desktop/uimodel.ts, uidom.ts, panes.ts): tasks any
// user asks, by role and name, each read back: fold and open a section, show a place, select a tab, find a setting's
// switch, read a state with check, and an act that changes nothing says so. Throwaway server only (it opens tabs).
//   node web/qa/companionui.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/companionui-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const call = async (id, body) => {
  const r = await fetch(new URL(`/api/ops/${id}`, B), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const act = (action, find, more = {}) => call("companion.act", { action, ...(find ? { find } : {}), ...more })
const holds = async (condition) => (await call("companion.check", { condition })).body
const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
const files = "[data-ui='panel:files:files']"
try {
  await page.goto(B)
  await page.waitForSelector(files)
  await wait(800)

  // Its ARIA: the panel a named region, its heading the disclosure that says what it folds
  const aria = await page.evaluate((f) => { const p = document.querySelector(f), h = p?.querySelector("[aria-expanded]"); return { role: p?.getAttribute("role"), name: document.getElementById(p?.getAttribute("aria-labelledby") ?? "")?.textContent?.trim(), controls: h?.getAttribute("aria-controls") === p?.id && !!p?.id } }, files)
  check("a panel is a named group, its heading controls it", aria.role === "group" && aria.name === "Files" && aria.controls, aria)

  // Fold a section by its name, then again: the second does nothing and says it's already so
  const fold = await act("collapse", "Files")
  check("collapse \"Files\" folds it, read back", fold.status === 200 && fold.body?.ok === true && !!(await page.$(`${files}[data-collapsed]`)), fold.body)
  const twice = await act("collapse", "Files")
  check("folding it again changes nothing, and says it's already folded", twice.body?.already === true && /already folded/.test(twice.body?.saw ?? ""), twice.body)
  const c1 = await holds(`collapsed "Files"`), c2 = await holds(`expanded "Files"`)
  check("check reads the fold back both ways", c1?.ok === true && c2?.ok === false && /folded/.test(c2?.saw ?? ""), { c1, c2 })

  // Open it by name (its heading pressed, not its container) and by its id (a place shown)
  const open = await act("expand", "Files", { role: "button" })
  check("expand button \"Files\" opens it", open.body?.ok === true && !(await page.$(`${files}[data-collapsed]`)) && /Start here/.test(open.body?.shows ?? ""), open.body)
  await act("collapse", "Files")
  const place = await call("companion.act", { ui: "panel:files:files", action: "click" })
  check("a place by its id is shown, unfolded, with what it shows", place.body?.opened === true && place.body?.ok === true && !(await page.$(`${files}[data-collapsed]`)), place.body)
  await page.screenshot({ path: `${OUT}files-open.png` })

  // Select a tab by its role and name, read back
  await call("companion.open", { path: "Start here.md" })
  await call("companion.open", { path: "view:files" })
  await until(async () => (await page.$$("[role=tab]")).length >= 2)
  const tab = await act("select", "Start here", { role: "tab" })
  check("select tab \"Start here\" selects it", tab.status === 200 && tab.body?.ok === true && (await holds(`selected tab "Start here"`))?.ok === true, tab.body)
  const tabAgain = await act("select", "Start here", { role: "tab" })
  check("selecting it again is already so", tabAgain.body?.already === true, tabAgain.body)

  // Find a setting: its switch by name, its state read (Settings' first switch, whatever it is)
  await page.keyboard.press("ControlOrMeta+Comma")
  await until(async () => !!(await page.$("[role=switch][aria-label]")))
  const sw = await page.evaluate(() => { const s = document.querySelector("[role=switch][aria-label]"); return s ? { name: s.getAttribute("aria-label"), on: s.getAttribute("aria-checked") === "true" } : null })
  const read = sw && await holds(`checked switch ${JSON.stringify(sw.name)}`)
  check("a setting's switch is found by its name and its state read", !!sw && read?.ok === sw.on && read?.thing?.role === "switch", { sw, read })
  await page.screenshot({ path: `${OUT}settings.png` })

  // What isn't there, and a check that can't be read, say so
  const miss = await act("click", "No such thing here")
  check("a thing not on screen is a 404", miss.status === 404, miss.body)
  const gone = await holds(`gone "No such thing here"`), bad = await call("companion.check", { condition: "wobbly \"x\"" })
  check("gone holds for what isn't there; a bad condition says how it's written", gone?.ok === true && bad.status === 400 && /no condition/.test(bad.body?.error ?? ""), { gone, bad: bad.body })
  const shows = await holds(`shows "Start here"`)
  check("shows finds words in the window", shows?.ok === true, shows)
} finally { await done() }
