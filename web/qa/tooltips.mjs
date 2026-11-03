// Tooltips say only what can't be seen (web/CLAUDE.md): sidebar rows, the rail, cut-off headings and path bar folders.
// Pins a note and writes notes, .vaultite/plugins.json and sidebars.json: throwaway only.
//   node web/qa/tooltips.mjs <base url> <vault path>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)

const LONG = "A note whose name is far too long to fit in the sidebar at its usual width"
writeFileSync(path.join(VAULT, `${LONG}.md`), `# ${LONG}\n\n## A heading long enough that the outline panel has to cut it off somewhere\n\nText.\n`)
await fetch(new URL("/api/pins", B), { method: "POST", body: JSON.stringify({ path: `${LONG}.md`, pinned: true }) })

// The Outline panel in the sidebar, under the pins (Workspaces off: the sidebar is sidebars.json's).
const plugins = path.join(VAULT, ".vaultite/plugins.json")
const conf = existsSync(plugins) ? JSON.parse(readFileSync(plugins, "utf8")) : {}
writeFileSync(plugins, JSON.stringify({ ...conf, disabled: (conf.disabled ?? []).filter((d) => d !== "outline"), enabled: (conf.enabled ?? []).filter((d) => d !== "workspaces") }, null, 2) + "\n")
writeFileSync(path.join(VAULT, ".vaultite/sidebars.json"), JSON.stringify({ left: ["search:search", "pages:pages", "outline:outline", "files:files"], right: [], collapsed: [] }, null, 2) + "\n")

const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
/** What the tooltip says after hovering `sel` (null: none showed). */
async function tipOf(sel) {
  await page.mouse.move(640, 790)
  await wait(700) // (past the warm-up, so the next one waits its delay)
  await page.hover(sel)
  await wait(900)
  return page.$eval("[role=tooltip]", (e) => e.textContent).catch(() => null)
}
try {
  await page.goto(B)
  await page.waitForSelector("aside [data-pin]")
  const short = `aside [data-pin="Start here.md"]`, long = `aside [data-pin="${LONG}.md"]`
  await until(() => page.$(long))
  check("a name that fits: no tooltip", (await tipOf(short)) === null, await tipOf(short))
  const cut = await page.$eval(`${long} .fade-end`, (e) => e.scrollWidth > e.clientWidth)
  check("the long name is cut off", cut)
  check("a name cut off: its whole name", (await tipOf(long)) === LONG, await tipOf(long))

  // The rail: every row says its name, cut off or not.
  await page.click("[aria-label='Hide left sidebar']")
  await until(async () => (await page.$eval(short, (e) => e.getBoundingClientRect().width)) < 60)
  await wait(300)
  check("in the rail: a short name too", (await tipOf(short)) === "Start here", await tipOf(short))
  await page.click("[aria-label='Show left sidebar']")
  await wait(400)

  // The Outline panel: a heading cut off shows whole.
  await page.click(long)
  const item = "aside [data-outline-item^='A heading long']"
  if (await until(() => page.$(item))) {
    const cutOff = await page.$eval(`${item} .truncate`, (e) => e.scrollWidth > e.clientWidth)
    const t = await tipOf(item)
    check("an outline heading cut off: its whole text", cutOff && t?.startsWith("A heading long") && !t.includes("*"), { cutOff, t })
  } else check("the outline lists the heading", false)

  // The path bar: a folder squeezed to a letter says its whole name, one that fits only what a click does.
  const deep = Array.from({ length: 6 }, (_, i) => `Folder ${i} with a name long enough to be squeezed`)
  mkdirSync(path.join(VAULT, ...deep), { recursive: true })
  writeFileSync(path.join(VAULT, ...deep, "Deep.md"), "# Deep\n")
  await page.goto("about:blank")
  await page.goto(`${B}#file/${encodeURIComponent([...deep, "Deep.md"].join("/"))}`)
  const crumbs = "nav[aria-label='File path'] button[data-tip-cut]"
  await until(async () => (await page.$$(crumbs)).length === deep.length)
  const squeezed = await page.$$eval(crumbs, (bs) => bs.map((b) => b.scrollWidth > b.clientWidth))
  const i = squeezed.indexOf(true)
  check("a path bar folder is cut off", i >= 0, squeezed)
  if (i >= 0) {
    const t = await tipOf(`${crumbs} >> nth=${i}`)
    check("a cut-off folder: its whole name", t === `${deep[i]}\nOpen folder`, t)
  }
} catch (e) {
  check("ran through", false, String(e))
} finally {
  await done()
}
