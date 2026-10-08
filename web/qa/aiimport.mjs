// AI import (plugins/core/ai-import): "Import from ChatGPT or Claude…" picks a made-up export (tools/fixtures/ai-import),
// one toast follows it and says what it did with "Review memories"; the chats are notes; the review list's card counts
// the ticked ones and Add puts them in ME.md (MCP's remember, over this server's API) and under Added; importing again
// adds nothing; Claude's .dms works; a file over 8 MB goes up in pieces; `vau import` does the same from a terminal; a
// chat reads well at 390px. WRITES Chats/ and ME.md: throwaway server only.
//   node web/qa/aiimport.mjs <base url> [out dir]
import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { SHOTS, apiAt, qa, wait } from "./lib/qa.mjs"
const { args: [B, OUT = `${SHOTS}aiimport/`], browser, check, watch, done } = await qa(import.meta.url)
fs.mkdirSync(OUT, { recursive: true })
const ROOT = new URL("../../", import.meta.url).pathname
// What it uses, whatever the vault turned off (the sandbox starts calm: AI import is off). `--url` naming this server
// makes vau ask it for its vault; the vault variables a Vaultite terminal sets (the user's) are left out besides.
{
  const env = { ...process.env }
  for (const k of ["VAULTITE_VAULT", "VAULTITE_URL"]) delete env[k]
  execFileSync(process.execPath, [path.join(ROOT, "bin/vau"), "--url", B.replace(/\/+$/, ""), "plugin", "on", "ai-import"], { encoding: "utf8", env })
}
const api = apiAt(B)
const file = async (p) => (await api("GET", `file?path=${encodeURIComponent(p)}`)).text ?? null
const files = async (pre) => (await api("GET", "files")).files.map((f) => f.path).filter((p) => p.startsWith(pre))

// The made-up exports, and a big one (random text, so it stays over 8 MB zipped).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiimport-qa-"))
execFileSync("node", [path.join(ROOT, "tools/fixtures/ai-import/make.ts"), dir])
const { zipFiles } = await import(path.join(ROOT, "plugins/core/ai-import/zip.ts"))
const many = Array.from({ length: 1100 }, (_, i) => ({ uuid: `b16b16b1-0000-4000-8000-${String(i).padStart(12, "0")}`, name: `Big chat ${i}`,
  created_at: "2026-09-02T10:00:00Z", updated_at: "2026-09-02T10:05:00Z", chat_messages: [
    { uuid: `${i}a`, text: `Question ${i}: ${crypto.randomBytes(8000).toString("base64")}`, sender: "human", created_at: "2026-09-02T10:00:00Z" },
    { uuid: `${i}b`, text: `Answer ${i}`, sender: "assistant", created_at: "2026-09-02T10:01:00Z" }] }))
fs.writeFileSync(path.join(dir, "big-claude.zip"), zipFiles({ "conversations.json": JSON.stringify(many) }))
check("the big export is over 8 MB", fs.statSync(path.join(dir, "big-claude.zip")).size > 8 << 20, fs.statSync(path.join(dir, "big-claude.zip")).size)

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true })
const toast = (text) => page.locator("[data-sonner-toast]", { hasText: text }).first()
const importVia = async (name) => {
  const chooser = page.waitForEvent("filechooser")
  await page.keyboard.press("ControlOrMeta+p"); await wait(300)
  await page.keyboard.type("Import from ChatGPT or Claude"); await wait(300)
  await page.keyboard.press("Enter")
  await (await chooser).setFiles(path.join(dir, name))
}

await page.goto(B); await wait(2000)

// 1. ChatGPT's export through the palette.
await importVia("chatgpt-export.zip")
const done1 = toast("ChatGPT: 3 chats")
await done1.waitFor({ timeout: 30_000 })
const t1 = await done1.innerText()
check("the toast says what it did", /2 new/.test(t1) && /1 short one skipped/.test(t1) && /1 image/.test(t1) && /6 memories to review/.test(t1), t1)
check("with Review memories", (await done1.locator("[data-button]").innerText()) === "Review memories")
await page.screenshot({ path: `${OUT}toast.png` })
const chats = await files("Chats/ChatGPT/")
check("the chats are notes in Chats/ChatGPT, the image in Attachments", chats.includes("Chats/ChatGPT/2026-09-20 Trip to Lisbon.md") && chats.includes("Chats/ChatGPT/Memories to review.md") &&
  (await api("GET", "files")).others.some((f) => f.path === "Chats/ChatGPT/Attachments/file-Img001-beach.png"), chats)

// 2. The review list: its card, ticked ones added to ME.md.
await done1.locator("[data-button]").click(); await wait(1500)
// (a note opens with the cursor at its start, which shows a block there as its source: read it instead)
await page.keyboard.press("ControlOrMeta+p"); await wait(300); await page.keyboard.type("Switch to reading view"); await wait(300); await page.keyboard.press("Enter"); await wait(800)
const card = page.locator("[data-memory-add]").first()
check("Review memories opens the list, its card says nothing is ticked", (await card.innerText()) === "Tick the ones to add", await card.innerText().catch(() => null))
await page.screenshot({ path: `${OUT}review.png` })
const rel = "Chats/ChatGPT/Memories to review.md"
const list = await file(rel)
await api("PUT", "file", { path: rel, base: list, text: list.replace("- [ ] **Me** · I have a dog named Biscuit.", "- [x] **Me** · I have a dog named Biscuit.")
  .replace("- [ ] **How to work with me** · Prefer concise answers with bullet points.", "- [x] **How to work with me** · Prefer concise answers with bullet points.") })
check("the ticks are written", (await file(rel)).split("- [x]").length === 3, await file(rel))
await page.waitForFunction(() => document.querySelector("[data-memory-add]")?.textContent === "Add 2 ticked", null, { timeout: 30_000 }).catch(() => {})
check("ticking two shows Add 2 ticked", (await card.innerText()) === "Add 2 ticked", await card.innerText())
await card.click()
await toast("Added 2 memories").waitFor({ timeout: 15_000 }).catch(() => {})
const me = await file("ME.md")
check("Add puts them in ME.md, under About me and How to work with me", /## About me[\s\S]*- I have a dog named Biscuit\./.test(me) && /## How to work with me[\s\S]*- Prefer concise answers with bullet points\./.test(me), me)
const after = await file(rel)
check("and moves them under Added", /## Added\n\n- ME.md, About me · I have a dog named Biscuit\./.test(after) && !after.includes("[x]"), after.slice(after.indexOf("## To review")))
// The page follows the files live: the store reloads at most once a second, so the count comes within about that.
const counted = () => page.locator("section", { has: card }).first().innerText()
for (let i = 0; i < 50 && !/4 to review, 0 ticked/.test(await counted()); i++) await wait(100)
check("the card counts what's left", /4 to review, 0 ticked/.test(await counted()), await counted())

// 3. Again: nothing new, nothing doubled.
await importVia("chatgpt-export.zip")
const done2 = toast("2 already here")
await done2.waitFor({ timeout: 30_000 }).catch(() => {})
check("importing again: already here, no memories come back", (await done2.isVisible()) && !/memories to review/.test(await done2.innerText()), await page.locator("[data-sonner-toast]").allInnerTexts())
check("no second files", (await files("Chats/ChatGPT/")).length === chats.length, await files("Chats/ChatGPT/"))

// 4. Claude's .dms.
await importVia("claude-export.dms")
const done3 = toast("Claude: 3 chats")
await done3.waitFor({ timeout: 30_000 }).catch(() => {})
check("Claude's export: chats, a project, memories", (await done3.isVisible()) && /1 project/.test(await done3.innerText()) && /5 memories/.test(await done3.innerText()), await page.locator("[data-sonner-toast]").allInnerTexts())

// 5. Over 8 MB: in pieces.
const pieces = []
page.on("request", (r) => { if (r.url().includes("/api/ai-import/upload")) pieces.push(r.url()) })
await importVia("big-claude.zip")
const done4 = toast("Claude: 1100 chats")
await done4.waitFor({ timeout: 180_000 }).catch(() => {})
check("a big export goes up in pieces and imports", pieces.length >= 2 && (await done4.isVisible()) && /1100 new/.test(await done4.innerText()), [pieces.length, await page.locator("[data-sonner-toast]").allInnerTexts()])

// 6. vau import: the same, from a terminal; idempotent.
const out = execFileSync("node", [path.join(ROOT, "bin/vau"), "import", path.join(dir, "claude-export.dms")], { env: { ...process.env, VAULTITE_URL: B.replace(/\/$/, "") }, encoding: "utf8" })
check("vau import: said and nothing doubled", /Claude: 3 chats in Chats\/Claude\/: 0 new, 0 updated, 2 already there/.test(out), out)

// 7. A chat at 390px.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const pp = watch(await phone.newPage())
await pp.goto(`${B}#file/${encodeURIComponent("Chats/Claude/2026-09-21 Recipe ideas.md")}`); await wait(2500)
const wide = await pp.evaluate(() => document.documentElement.scrollWidth)
check("a chat at 390px: no sideways scroll", wide <= 390, wide)
await pp.screenshot({ path: `${OUT}phone-chat.png` })
await page.goto(`${B}#file/${encodeURIComponent("Chats/ChatGPT/2026-09-20 Trip to Lisbon.md")}`); await wait(2000)
await page.screenshot({ path: `${OUT}desktop-chat.png` })

fs.rmSync(dir, { recursive: true, force: true })
await done()
