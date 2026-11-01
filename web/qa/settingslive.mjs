// Settings written from outside apply live, as an AI writes them: appearance.json (theme, density, line numbers) and
// editor.json (properties hidden or as text) change two open windows without a reload; one set in a window reaches the
// other and its file; a file written wrong is ignored without an error, and deleting it brings the defaults back.
// WRITES appearance.json, editor.json and a note: throwaway server only.
//   node web/qa/settingslive.mjs <base url> <vault path> [out dir]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { SHOTS, apiAt, palette, qa, until } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const conf = (name) => path.join(VAULT, ".vaultite", `${name}.json`)
const write = (name, value) => writeFileSync(conf(name), typeof value === "string" ? value : JSON.stringify(value, null, 2))
const read = (name) => { try { return JSON.parse(readFileSync(conf(name), "utf8")) } catch { return null } }
rmSync(conf("appearance"), { force: true }); rmSync(conf("editor"), { force: true })
const NOTE = "Qa settings/Harbour plan.md"
await api("POST", "file", { path: NOTE, text: "---\nstatus: draft\n---\n# Harbour plan\n\nAlice Park walks the Lighthouse path.\n" })

/** A window on the note, counting its loads (a setting must apply without one). */
async function open(name) {
  const page = watch(await (await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" })).newPage(), { label: name })
  page.loads = 0
  page.on("load", () => page.loads++)
  await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
  await page.waitForSelector(`article.file-view[data-path="${NOTE}"] .cm-content`, { timeout: 30000 })
  return page
}
const [a, b] = [await open("a"), await open("b")]
const both = (fn) => until(async () => (await fn(a)) && (await fn(b)), 6000)
const look = (p) => p.evaluate(() => ({ dark: document.documentElement.classList.contains("dark"), density: document.documentElement.dataset.density ?? "" }))
const article = (p) => p.locator(`article.file-view[data-path="${NOTE}"]`)
const props = (p) => article(p).locator("section[aria-label=Properties]").count()
const gutter = (p) => article(p).locator(".cm-lineNumbers").count()
const source = (p) => article(p).locator(".cm-content").innerText().then((t) => t.startsWith("---"))
check("at first: light, compact, Properties shown, no line numbers", !(await look(a)).dark && !(await look(a)).density && (await props(a)) === 1 && !(await gutter(a)), [await look(a), await props(a)])

// ---------- appearance.json from outside
write("appearance", { theme: "dark" })
check("appearance.json's theme: both windows go dark", !!(await both(async (p) => (await look(p)).dark)), [await look(a), await look(b)])
write("appearance", { theme: "dark", density: "comfortable", lineNumbers: true })
check("...its density, in both", !!(await both(async (p) => (await look(p)).density === "comfortable")), [await look(a), await look(b)])
check("...its line numbers, in the open note", !!(await both(async (p) => (await gutter(p)) > 0)))
await a.screenshot({ path: `${OUT}settingslive-dark.png` })

// ---------- editor.json from outside
write("editor", { propertiesInDocument: "hidden" })
check("editor.json's properties hidden: the note's Properties go", !!(await both(async (p) => (await props(p)) === 0)))
write("editor", { propertiesInDocument: "source" })
check("...as text: the note shows its frontmatter in the text", !!(await both(source)))

// ---------- one window's change: the other and the file
// (a theme is a value of the palette's Theme… picker, not a command of its own)
await palette(a, "Theme…", 300)
const light = a.locator("[role=option]").filter({ hasText: /^\s*Light\s*$/ })
await until(() => light.count(), 3000); await light.click(); await a.waitForTimeout(100)
check("Use light theme in one window: appearance.json says so", !!(await until(() => read("appearance")?.theme === "light", 4000)), read("appearance"))
check("...the other window goes light", !!(await until(async () => !(await look(b)).dark, 6000)), await look(b))
check("...the rest of the file kept", read("appearance")?.density === "comfortable" && read("appearance")?.lineNumbers === true, read("appearance"))

// ---------- written wrong, then fixed, then gone
write("appearance", "{ \"theme\": \"dark\", ")
write("editor", { propertiesInDocument: "sideways", editingMode: 3 })
await until(async () => (await api("GET", "config/editor"))?.propertiesInDocument === "sideways", 4000)
check("a file that isn't JSON, and values of the wrong kind: nothing breaks, the note is still drawn", (await article(a).count()) === 1 && (await article(b).count()) === 1)
write("appearance", { theme: "dark" })
check("...written right again: it applies", !!(await both(async (p) => (await look(p)).dark)), [await look(a), await look(b)])
rmSync(conf("appearance")); rmSync(conf("editor"))
check("deleted: the defaults come back, light and compact", !!(await both(async (p) => { const l = await look(p); return !l.dark && !l.density })), [await look(a), await look(b)])
check("...Properties shown again, in live preview", !!(await both(async (p) => (await props(p)) === 1 && !(await source(p)) && !(await gutter(p)))))
check("no window reloaded", a.loads === 1 && b.loads === 1, [a.loads, b.loads])

await api("DELETE", `file?path=${encodeURIComponent("Qa settings")}`).catch(() => {})
await done()
