// Token count's limits: the status bar's count is amber near the file's limit and red over it (a CLAUDE.md by what it
// loads with its @imports), its tooltip saying the limit and the load; files over their limit are marked in the file
// tree; the Agent context tab lists them and the load chains, and a row opens its file; the op says the same as text.
// Typing past the limit turns the count red before saving. Screenshots of the status bar, the tree and the tab, light
// and dark. WRITES "QA tokens/" and appearance.json (put back): throwaway server only.
//   node web/qa/tokenlimits.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [BASE, VAULT, OUT = "/tmp/tokenlimits-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, "")
mkdirSync(OUT, { recursive: true })
const file = (rel) => `${VAULT}/${rel}`
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = [keep(".vaultite/appearance.json")]
const api = (method, p, body) => fetch(`${B}/api/${p}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) })
const enc = encodeURIComponent
const DIR = "QA tokens"
const LONG = `${DIR}/Long notes.md`, NEAR = `${DIR}/Near notes.md`, SHORT = `${DIR}/Short notes.md`, CLAUDE = `${DIR}/CLAUDE.md`, RULES = `${DIR}/Rules.md`
const words = (n) => Array.from({ length: n }, (_, i) => (i % 12 === 11 ? "garden.\n" : "garden")).join(" ")

rmSync(file(DIR), { recursive: true, force: true })
// (each note's own limit, max_tokens; the CLAUDE.md's is the default for CLAUDE.md files, 3k)
const fm = "---\nmax_tokens: 400\n---\n"
for (const [rel, text] of [[LONG, fm + words(600)], [NEAR, fm + words(300)], [SHORT, fm + "A few lines.\n"], [CLAUDE, "@Rules.md\n\nBe brief.\n"], [RULES, words(2900)]]) {
  await api("PUT", "file", { path: rel, text })
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = watch(await ctx.newPage())
const go = async (rel) => { await page.goto(`${B}/#file/${enc(rel)}`); await page.locator(`.file-view[data-path="${rel}"]:visible`).waitFor({ timeout: 10000 }); await wait(700) }
const count = () => page.locator("[role=status] [data-tokens]")
const levelOf = async () => (await count().getAttribute("data-level"))
const colour = () => count().evaluate((el) => getComputedStyle(el).color)
const token = (name) => page.evaluate((n) => { const d = document.createElement("span"); d.style.color = `var(--${n})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c }, name)

// ---------- the status bar ----------
await go(LONG)
check("status: over its limit, red", await levelOf() === "over" && await colour() === await token("red"), [await levelOf(), await colour()])
const tip = await count().getAttribute("data-tip")
check("status: the tooltip says the limit and where it's set", /Over its limit: 400 \(its max_tokens\)/.test(tip), tip)
await go(NEAR)
check("status: near its limit, amber", await levelOf() === "near" && await colour() === await token("orange"), [await levelOf(), await colour()])
await go(SHORT)
check("status: under its limit, the bar's own colour", await levelOf() === "ok" && await colour() !== await token("red") && await colour() !== await token("orange"))
await go(CLAUDE)
const ctip = await count().getAttribute("data-tip")
check("status: a CLAUDE.md is over by what it loads with its imports", await levelOf() === "over" && /With its @imports an agent loads ~3\.\dk tokens \(2 files\)/.test(ctip) && /set for CLAUDE\.md/.test(ctip), ctip)
for (const t of ["light", "dark"]) {
  await api("PATCH", "config/appearance", { theme: t }); await wait(700)
  const sb = await page.locator("[role=status]").boundingBox()
  await page.screenshot({ path: `${OUT}status-${t}.png`, clip: { x: sb.x + sb.width - 420, y: sb.y - 4, width: 420, height: sb.height + 8 } })
}

// ---------- the file tree ----------
const tree = page.locator("aside [role=tree]").first()
if (!(await tree.locator(`[data-tree-path="${LONG}"]`).count())) await tree.locator(`[data-tree-path="${DIR}"] > button`).first().click()
await wait(400)
const mark = (rel) => tree.locator(`[data-tree-path="${rel}"] [data-file-mark]`)
check("tree: a file over its limit is marked with its size", (await mark(LONG).count()) === 1 && /^\d/.test(await mark(LONG).innerText()), await mark(LONG).count())
check("tree: a CLAUDE.md over by its imports is marked with what it loads", (await mark(CLAUDE).count()) === 1 && /^3\.\dk$/.test(await mark(CLAUDE).innerText()))
check("tree: near or under, no mark", (await mark(NEAR).count()) === 0 && (await mark(RULES).count()) === 0)
check("tree: the mark is red", await mark(LONG).evaluate((el) => getComputedStyle(el).color) === await token("red"))
const row = await tree.locator(`[data-tree-path="${DIR}"]`).first().boundingBox()
await page.screenshot({ path: `${OUT}tree-dark.png`, clip: { x: 0, y: row.y - 6, width: 300, height: 190 } })

// ---------- the Agent context tab ----------
await page.goto(`${B}/#view/agent-context`)
const view = page.locator("[data-context-view]:visible")
await view.waitFor({ timeout: 10000 })
const rows = (group) => view.locator(`[data-context-group="${group}"] [data-context-row]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-context-row")))
const over = await rows("over")
check("tab: over the limit, biggest first", over.join() === `${CLAUDE},${LONG}`, over)
check("tab: near the limit", (await rows("near")).join() === NEAR, await rows("near"))
const chain = await view.locator(`[data-context-chain="${CLAUDE}"] [data-context-row]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-context-row")))
check("tab: the load chain lists the CLAUDE.md, then what it imports", chain.join() === `${CLAUDE},${RULES}`, chain)
for (const t of ["light", "dark"]) {
  await api("PATCH", "config/appearance", { theme: t }); await wait(700)
  await view.screenshot({ path: `${OUT}tab-${t}.png` })
}
await view.locator(`[data-context-group="near"] [data-context-row="${NEAR}"]`).click()
check("tab: a row opens its file", await until(() => page.locator(`.file-view[data-path="${NEAR}"]:visible`).count(), 6000))

// ---------- the op ----------
const text = await (await api("POST", "ops/token-count.size?as=text", {})).text()
check("op: over, near and the chain, as text", /Over their limit \(2\)/.test(text) && /Near their limit/.test(text) && /@QA tokens\/Rules\.md/.test(text), text)
const hook = await (await api("POST", "ops/token-count.size?as=text", { path: `${VAULT}/${LONG}`, over: true })).text()
check("op: a hook's absolute path, over", hook.startsWith("Over its limit:"), hook)
console.log(text)

// Typing past the limit: red before it's saved.
await go(SHORT)
await page.locator(`.file-view[data-path="${SHORT}"]:visible .cm-content`).click()
await page.keyboard.press("End")
await page.keyboard.insertText(` ${words(420)}`)
check("status: typing past the limit turns it red", await until(async () => (await levelOf()) === "over", 6000), await levelOf())

await browser.close()
rmSync(file(DIR), { recursive: true, force: true })
restore.forEach((f) => f())
await done()
