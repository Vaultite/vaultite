// Provenance, pinned properties and Token count: a file's `origin` label in its header and the status bar (choosing
// writes only that key), `origin: ai` for an agent's note through the API, none for the app's (the header then shows no
// label) and `human` once the vault labels the user's (`label_user`), images' labels
// in files.json (an agent's upload carries the IPTC mark), the values from the settings sheet, pinned property chips,
// Token count following typing, and 390px. Screenshots light and dark. WRITES files in "QA provenance/", plugins.json,
// appearance.json, both plugins' data.json and Provenance's files.json (put back): throwaway server only.
//   node web/qa/provenance.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [BASE, VAULT, OUT = "/tmp/provenance-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, "") // its paths are `${B}/...`: a base given with its slash would open the app at "//"
mkdirSync(OUT, { recursive: true })
const file = (rel) => `${VAULT}/${rel}`
const text = (rel) => { try { return readFileSync(file(rel), "utf8") } catch { return "" } }
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = [keep(".vaultite/plugins.json"), keep(".vaultite/appearance.json"), keep(".vaultite/plugins/provenance/data.json"), keep(".vaultite/plugins/properties/data.json"),
  keep(".vaultite/plugins/provenance/files.json")]
const api = (method, p, body, headers = {}) => fetch(`${B}/api/${p}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body && JSON.stringify(body) }).then((r) => r.json())
const enc = encodeURIComponent
const DIR = "QA provenance"
const AI = `${DIR}/Garden plan.md`, PLAIN = `${DIR}/Reading list.md`
const origin = (rel) => /^origin: (.*)$/m.exec(text(rel))?.[1] ?? null

const plugins = async (fn) => { const cur = await api("GET", "config/plugins"); await api("PATCH", "config/plugins", fn(cur)) }
const theme = (t) => api("PATCH", "config/appearance", { theme: t })

// An agent's note (curl: no client header) and one the user wrote in the app.
rmSync(file(DIR), { recursive: true, force: true })
await api("PUT", "file", { path: AI, text: "## Beds\n\n- Tomatoes along the fence\n- Basil between them\n" })
await api("PUT", "file", { path: PLAIN, text: "---\ntags: [Books]\n---\n\nThe books Alice Park lent me.\n" }, { "X-Vaultite-Client": "app/desktop" })
check("an agent's new note through the API is origin: ai", origin(AI) === "ai", text(AI))
check("the app's stays unlabelled: no label is the user's", text(PLAIN) === "---\ntags: [Books]\n---\n\nThe books Alice Park lent me.\n", text(PLAIN))
await plugins((c) => ({ disabled: [...(c.disabled ?? []).filter((x) => x !== "token-count"), "token-count"] }))

async function open(w, h, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(mobile ? { isMobile: true, hasTouch: true } : {}) })
  return { ctx, page: watch(await ctx.newPage(), { label: w }) }
}
// (hidden tabs stay drawn: only the one on screen counts)
const go = async (page, rel) => { await page.goto(`${B}/#file/${enc(rel)}`); await page.locator(`.file-view[data-path="${rel}"]:visible`).waitFor({ timeout: 10000 }); await wait(800) }
const shown = (page, rel, sel = "") => page.locator(`.file-view[data-path="${rel}"]:visible ${sel}`.trim())
// (by the start of its text: "AI" is also in Reviewed's hint)
const choose = async (page, label) => { await page.locator("[role=menu] [role=menuitemradio]").filter({ hasText: new RegExp(`^\\s*${label}`) }).first().click(); await wait(200) }

// ---------- desktop ----------
{
  const { ctx, page } = await open(1280, 800)
  await go(page, AI)
  const head = shown(page, AI, "[data-chip=origin]")
  const status = page.locator("[role=status] [data-chip=origin]")
  check("desktop: the header says AI", (await head.getAttribute("data-value")) === "ai" && (await head.innerText()).trim() === "AI", await head.innerText())
  check("desktop: so does the status bar", (await status.getAttribute("data-value")) === "ai", await status.count())
  // Right before the view button, in the same bar.
  const order = await page.evaluate(() => {
    const chip = [...document.querySelectorAll(".file-view [data-chip=origin]")].find((e) => e.checkVisibility()), bar = chip?.parentElement
    const kids = [...(bar?.children ?? [])]
    const view = kids.find((k) => k.getAttribute("aria-label") === "Read" || k.getAttribute("aria-label") === "Edit")
    // (Dispatch's buttons, when it's on, sit between it and the view button)
    const a = chip.getBoundingClientRect(), b = chip.nextElementSibling?.getBoundingClientRect()
    return { before: !!view && kids.indexOf(chip) < kids.indexOf(view), gap: b ? Math.round(b.left - a.right) : null, mid: b ? Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) : null }
  })
  check("desktop: the label sits before the view button, centred with it, the next item close by", order.before && order.gap !== null && order.gap >= 0 && order.gap <= 12 && order.mid < 1, order)
  check("desktop: no token count while Token count is off", (await page.locator("[data-tokens]").count()) === 0)
  for (const t of ["light", "dark"]) {
    await theme(t); await wait(700)
    const box = await head.boundingBox()
    await page.screenshot({ path: `${OUT}desktop-${t}-header.png`, clip: { x: Math.max(0, box.x - 500), y: Math.max(0, box.y - 12), width: 620, height: 52 } })
    const sb = await page.locator("[role=status]").boundingBox()
    await page.screenshot({ path: `${OUT}desktop-${t}-status.png`, clip: { x: sb.x - 8, y: sb.y - 8, width: sb.width + 8, height: sb.height + 8 } })
  }
  // Choosing in the header writes the key, and the status bar follows.
  await head.click(); await wait(200)
  await page.screenshot({ path: `${OUT}desktop-dark-menu.png`, clip: { x: 700, y: 0, width: 580, height: 260 } })
  await choose(page, "Reviewed")
  check("desktop: Reviewed from the header is saved", await until(() => origin(AI) === "reviewed"), text(AI))
  check("desktop: the status bar follows", await until(async () => (await status.getAttribute("data-value")) === "reviewed"))
  // From the status bar: Human, then Unlabeled removes the key (and the header goes back to its icon).
  await status.click(); await wait(200); await choose(page, "Mixed")
  check("desktop: Mixed, a default value too", await until(() => origin(AI) === "mixed") && await until(async () => (await head.innerText()).trim() === "Mixed"), text(AI))
  await status.click(); await wait(200); await choose(page, "Human")
  check("desktop: Human from the status bar", await until(() => origin(AI) === "human"), text(AI))
  await status.click(); await wait(200); await choose(page, "Unlabeled")
  check("desktop: Unlabeled removes the key, nothing else", await until(() => text(AI) === "---\n---\n\n## Beds\n\n- Tomatoes along the fence\n- Basil between them\n" || !/origin:/.test(text(AI))) && text(AI).includes("## Beds"), text(AI))
  check("desktop: unlabeled, the header shows no label, the status bar says so", await until(async () => (await head.count()) === 0 && (await status.innerText()).includes("Unlabeled")))
  // With the user's notes labelled (on from here): the header asks too, and the app's new note is the first value.
  await api("PATCH", "config/plugin/provenance", { label_user: true })
  check("desktop: label_user on, the header shows unlabeled", await until(async () => (await head.getAttribute("data-value")) === "none"))
  const MINE = `${DIR}/Mine.md`
  await api("PUT", "file", { path: MINE, text: "Mine.\n" }, { "X-Vaultite-Client": "app/desktop" })
  check("label_user on: the app's new note is labelled the first value (human)", origin(MINE) === "human", text(MINE))
  await go(page, PLAIN)
  await shown(page, PLAIN, "[data-chip=origin]").click(); await wait(200); await choose(page, "AI")
  check("desktop: labelling keeps the other keys and the text", await until(() => text(PLAIN) === "---\ntags: [Books]\norigin: ai\n---\n\nThe books Alice Park lent me.\n"), text(PLAIN))

  // Asked of every kind of file, a person too.
  const person = (await api("GET", "state")).people?.[0]
  if (person) {
    await go(page, `${person.id}.md`)
    check("desktop: a person is labelled too", await until(async () => (await page.locator("[data-chip=origin]:visible").count()) > 0))
  }

  // The values are the vault's: a label typed in the settings sheet shows in the header; Reset puts the defaults back.
  await go(page, AI)
  await page.goto(`${B}/#settings/plugin-settings/provenance`)
  const row = page.locator("[data-chip-value=human]")
  check("settings: the values, in order", await until(async () => (await page.locator("[data-chip-value]").evaluateAll((es) => es.map((e) => e.dataset.chipValue))).join() === "human,reviewed,mixed,ai"))
  await row.locator("input[aria-label=Label]").fill("Mine"); await row.locator("input[aria-label=Label]").press("Enter")
  check("settings: saved in its data.json", await until(() => /"label": "Mine"/.test(text(".vaultite/plugins/provenance/data.json"))), text(".vaultite/plugins/provenance/data.json"))
  await row.locator("button[aria-expanded]").click(); await wait(200)
  await page.locator("[role=radiogroup][aria-label=Colour] [aria-label=orange]").click()
  check("settings: a colour picked", await until(() => /"tint": "orange"/.test(text(".vaultite/plugins/provenance/data.json"))))
  for (const t of ["light", "dark"]) { await theme(t); await wait(600); await page.screenshot({ path: `${OUT}settings-${t}.png` }) }
  await page.keyboard.press("Escape"); await wait(400)
  await go(page, AI)
  await status.click(); await wait(200); await choose(page, "Mine")
  check("settings: the header says the new label", await until(async () => (await head.innerText()).trim() === "Mine" && origin(AI) === "human"), await head.innerText())
  await page.goto(`${B}/#settings/plugin-settings/provenance`)
  await page.locator("[data-provenance-reset]").click()
  check("settings: Reset puts the defaults back", await until(() => !/values/.test(text(".vaultite/plugins/provenance/data.json"))), text(".vaultite/plugins/provenance/data.json"))
  await page.keyboard.press("Escape"); await wait(400)

  // A pinned property: a chip of its own, only on the kinds it names.
  await api("PATCH", "config/plugin/properties", { chips: [{ key: "status", values: [{ value: "draft", icon: "pencil", tint: "orange" }, { value: "done", icon: "circle-check", tint: "green" }], types: ["note"] }] })
  await go(page, PLAIN)
  const st = shown(page, PLAIN, "[data-chip=status]")
  check("chips: a pinned property shows, unset", await until(async () => (await st.count()) === 1 && (await st.getAttribute("data-value")) === "none"))
  await st.click(); await wait(200); await choose(page, "Draft")
  check("chips: choosing writes the key", await until(() => /^status: draft$/m.test(text(PLAIN))), text(PLAIN))
  check("chips: it shows the value, before the origin", await until(async () => (await st.innerText()).trim() === "Draft") && await page.evaluate(() => {
    const a = [...document.querySelectorAll(".file-view [data-chip=status]")].find((e) => e.checkVisibility()), b = [...document.querySelectorAll(".file-view [data-chip=origin]")].find((e) => e.checkVisibility())
    return !!a && !!b && a.getBoundingClientRect().right <= b.getBoundingClientRect().left
  }))
  check("chips: not in the status bar unless asked", (await page.locator("[role=status] [data-chip=status]").count()) === 0)
  for (const t of ["light", "dark"]) {
    await theme(t); await wait(700)
    const box = await st.boundingBox()
    await page.screenshot({ path: `${OUT}desktop-${t}-chips.png`, clip: { x: Math.max(0, box.x - 400), y: Math.max(0, box.y - 12), width: 620, height: 52 } })
  }
  if (person) {
    await go(page, `${person.id}.md`)
    check("chips: not on a kind it doesn't name", (await page.locator("[data-chip=status]:visible").count()) === 0)
  }
  await api("PATCH", "config/plugin/properties", { chips: null })
  await go(page, PLAIN)

  // Token count: on (it is by default), it shows after the counts and follows typing.
  await plugins((c) => ({ disabled: (c.disabled ?? []).filter((x) => x !== "token-count") }))
  const tokens = page.locator("[role=status] [data-tokens]")
  check("tokens: shown once turned on", await until(async () => (await tokens.count()) === 1, 8000))
  await go(page, PLAIN) // (the workspace's tabs may have been put back meanwhile)
  const t0 = Number(await tokens.getAttribute("data-tokens"))
  const last = await page.evaluate(() => { const t = document.querySelector("[role=status] [data-tokens]"); return t?.parentElement?.lastElementChild === t && /words/.test(t.parentElement.textContent) })
  check("tokens: after the words and characters, as ~N tokens", last && /^~\d+ tokens$/.test((await tokens.innerText()).trim()), await tokens.innerText())
  await shown(page, PLAIN, ".cm-content").click()
  await page.keyboard.press("End")
  await page.keyboard.type(" And a few more words about each of them, so the count goes up.")
  check("tokens: follow typing", await until(async () => Number(await tokens.getAttribute("data-tokens")) > t0 + 10), [t0, await tokens.getAttribute("data-tokens")])
  for (const t of ["light", "dark"]) {
    await theme(t); await wait(700)
    const sb = await page.locator("[role=status]").boundingBox()
    await page.screenshot({ path: `${OUT}desktop-${t}-status-tokens.png`, clip: { x: sb.x - 8, y: sb.y - 8, width: sb.width + 8, height: sb.height + 8 } })
  }
  await ctx.close()
}

// ---------- files that aren't notes: their label in the list ----------
// A 2x2 PNG, and the same with the IPTC mark an AI's image carries (as Provenance writes it).
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg=="
const MARK = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"
const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"><Iptc4xmpExt:DigitalSourceType>${MARK}</Iptc4xmpExt:DigitalSourceType></rdf:Description></rdf:RDF></x:xmpmeta>`
const { crc32 } = await import("node:zlib")
function marked(b64) {
  const b = Buffer.from(b64, "base64"), data = Buffer.from(`XML:com.adobe.xmp\0\0\0\0\0${xmp}`, "latin1"), c = Buffer.alloc(12 + data.length)
  c.writeUInt32BE(data.length, 0); c.write("iTXt", 4, "latin1"); data.copy(c, 8); c.writeUInt32BE(crc32(c.subarray(4, 8 + data.length)), 8 + data.length)
  return Buffer.concat([b.subarray(0, 33), c, b.subarray(33)]).toString("base64")
}
const IMG_AI = `${DIR}/Chart.png`, IMG_MINE = `${DIR}/Photo.png`, IMG_MARKED = `${DIR}/From an AI app.png`
const listed = () => { try { return JSON.parse(text(".vaultite/plugins/provenance/files.json")) } catch { return {} } }
// (the bytes as the body: POST /api/upload)
const upload = (p, b64, headers = {}) => fetch(`${B}/api/upload?path=${enc(p)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream", ...headers }, body: Buffer.from(b64, "base64") })
await upload(IMG_AI, PNG)
await upload(IMG_MINE, PNG, { "X-Vaultite-Client": "app/desktop" })
await upload(IMG_MARKED, marked(PNG), { "X-Vaultite-Client": "app/desktop" })
check("files: an agent's upload is listed ai and its PNG carries the mark", listed()[IMG_AI] === "ai" && readFileSync(file(IMG_AI)).includes(MARK), listed())
check("files: the user's is listed human, its bytes as sent", listed()[IMG_MINE] === "human" && readFileSync(file(IMG_MINE)).toString("base64") === PNG, listed())
{
  const { ctx, page } = await open(1280, 800)
  await go(page, IMG_AI)
  const head = shown(page, IMG_AI, "[data-chip=origin]")
  const status = page.locator("[role=status] [data-chip=origin]")
  check("files desktop: an agent's image says AI in its header", await until(async () => (await head.count()) === 1 && (await head.getAttribute("data-value")) === "ai"), await head.count())
  check("files desktop: and in the status bar", await until(async () => (await status.getAttribute("data-value")) === "ai"))
  for (const t of ["light", "dark"]) {
    await theme(t); await wait(700)
    const box = await head.boundingBox()
    await page.screenshot({ path: `${OUT}files-desktop-${t}-header.png`, clip: { x: Math.max(0, box.x - 500), y: Math.max(0, box.y - 12), width: 620, height: 52 } })
    const sb = await page.locator("[role=status]").boundingBox()
    await page.screenshot({ path: `${OUT}files-desktop-${t}-status.png`, clip: { x: sb.x - 8, y: sb.y - 8, width: sb.width + 8, height: sb.height + 8 } })
  }
  const bytes = readFileSync(file(IMG_AI)).toString("base64")
  await head.click(); await wait(200); await choose(page, "Reviewed")
  check("files desktop: Reviewed from the header goes in the list, the image untouched", await until(() => listed()[IMG_AI] === "reviewed") && readFileSync(file(IMG_AI)).toString("base64") === bytes, listed())
  check("files desktop: both places follow", await until(async () => (await head.getAttribute("data-value")) === "reviewed" && (await status.getAttribute("data-value")) === "reviewed"))
  await status.click(); await wait(200); await choose(page, "Unlabeled")
  // (its bytes carry the mark: unlisted, it says what they say)
  check("files desktop: Unlabeled takes it out of the list; then it's AI as its bytes say", await until(() => !(IMG_AI in listed()))
    && await until(async () => (await head.getAttribute("data-value")) === "ai" && /file says/.test(await head.getAttribute("data-tip"))), listed())
  await go(page, IMG_MINE)
  check("files desktop: the user's image says Human", await until(async () => (await shown(page, IMG_MINE, "[data-chip=origin]").getAttribute("data-value")) === "human"))
  await go(page, IMG_MARKED)
  const m = shown(page, IMG_MARKED, "[data-chip=origin]")
  check("files desktop: an unlisted image carrying the mark says AI, with why", await until(async () => (await m.getAttribute("data-value")) === "ai") && /file says an AI made it/.test(await m.getAttribute("data-tip")) && !(IMG_MARKED in listed()), [await m.getAttribute("data-tip"), listed()])
  await m.click(); await wait(200); await choose(page, "Human")
  check("files desktop: the user's label wins over what it carries", await until(() => listed()[IMG_MARKED] === "human") && await until(async () => (await m.getAttribute("data-value")) === "human"), listed())
  // Moved in the app: the label follows.
  await api("POST", "file/move", { from: IMG_MINE, to: `${DIR}/Moved/Photo.png` }, { "X-Vaultite-Client": "app/desktop" })
  check("files: a moved image keeps its label", await until(() => listed()[`${DIR}/Moved/Photo.png`] === "human" && !(IMG_MINE in listed())), listed())
  await go(page, `${DIR}/Moved/Photo.png`)
  check("files desktop: shown where it went", await until(async () => (await shown(page, `${DIR}/Moved/Photo.png`, "[data-chip=origin]").getAttribute("data-value")) === "human"))
  await ctx.close()
}
{
  const { ctx, page } = await open(390, 844, true)
  await go(page, IMG_MARKED)
  const chip = shown(page, IMG_MARKED, "[data-chip=origin]")
  check("files 390: an image's label is in the line above its name", await until(async () => (await chip.count()) === 1 && (await chip.getAttribute("data-value")) === "human"))
  const fit = await page.evaluate(() => {
    const c = [...document.querySelectorAll(".file-view [data-chip=origin]")].find((e) => e.checkVisibility()).getBoundingClientRect()
    return { right: Math.round(c.right), h: Math.round(c.height), wide: document.documentElement.scrollWidth }
  })
  check("files 390: it fits, a 44px target, nothing wider than the screen", fit.right <= 390 && fit.h >= 44 && fit.wide <= 390, fit)
  for (const t of ["light", "dark"]) { await theme(t); await wait(700); await page.screenshot({ path: `${OUT}files-phone-${t}.png`, clip: { x: 0, y: 0, width: 390, height: 360 } }) }
  await chip.click(); await wait(300); await choose(page, "Mixed")
  check("files 390: choosing saves it in the list", await until(() => listed()[IMG_MARKED] === "mixed"), listed())
  await ctx.close()
}

// ---------- phone ----------
{
  await api("PUT", "file", { path: AI, text: `---\norigin: ai\n---\n\n${text(AI).replace(/^---\n[\s\S]*?\n?---\n\n?/, "")}` })
  const { ctx, page } = await open(390, 844, true)
  await go(page, AI)
  const chip = shown(page, AI, "[data-chip=origin]")
  check("390: the label is in the line above the title", (await chip.count()) === 1 && (await chip.getAttribute("data-value")) === "ai")
  const fit = await page.evaluate(() => {
    const c = [...document.querySelectorAll(".file-view [data-chip=origin]")].find((e) => e.checkVisibility()).getBoundingClientRect()
    return { right: Math.round(c.right), h: Math.round(c.height), wide: document.documentElement.scrollWidth }
  })
  check("390: it fits, a 44px target, nothing wider than the screen", fit.right <= 390 && fit.h >= 44 && fit.wide <= 390, fit)
  for (const t of ["light", "dark"]) {
    await theme(t); await wait(700)
    await page.screenshot({ path: `${OUT}phone-${t}.png`, clip: { x: 0, y: 0, width: 390, height: 260 } })
  }
  await chip.click(); await wait(300)
  await page.screenshot({ path: `${OUT}phone-dark-menu.png`, clip: { x: 0, y: 0, width: 390, height: 420 } })
  await choose(page, "Reviewed")
  check("390: choosing saves it", await until(() => origin(AI) === "reviewed"), text(AI))
  await ctx.close()
}

await browser.close()
rmSync(file(DIR), { recursive: true, force: true })
for (const r of restore) r()
await done()
