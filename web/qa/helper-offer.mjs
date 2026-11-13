// A command auto mode blocks, asked by voice, is offered on a card by the pointer and answered there.
// LIVE: a real model, and `defaults` on this Mac's com.vaultite.offer-test only.
//   VAULTITE_QA_LIVE=1 node web/qa/helper-offer.mjs <vault copy>
import { _electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done, skip } = await qa(import.meta.url, { chrome: false, live: true })
if (process.platform !== "darwin") await skip("the helper is a Mac's")
const DOMAIN = "com.vaultite.offer-test"
const read = (k) => { try { return execFileSync("defaults", ["read", DOMAIN, k], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() } catch { return null } }
const clear = () => { try { execFileSync("defaults", ["delete", DOMAIN], { stdio: "ignore" }) } catch {} }
clear()
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-offer-"))
// (a Mac before macOS 26 has no recognizer to hear a file with)
const WORDS = path.join(TMP, "said.txt")
const speak = (text) => fs.writeFileSync(WORDS, text)
const conf = (id, v) => { fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", id), { recursive: true }); fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", id, "data.json"), JSON.stringify(v)) }
conf("dictation", { engine: "apple", language: "en-US" })
conf("companion", { agent: "claude" })
speak("Run defaults write com.vaultite.offer-test probe -int 1 for me.")

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_HELPER: "1", VAULTITE_DICTATION_TEXT: WORDS, VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
try {
  const win = watch(await app.firstWindow(), { console: true })
  await win.waitForSelector("[role=tree]", { timeout: 60000 })
  const helper = (fn, arg) => app.evaluate((_e, [f, a]) => globalThis.vaultiteHelper && new Function("h", "a", `return (${f})(h, a)`)(globalThis.vaultiteHelper, a), [String(fn), arg])
  const engines = await win.evaluate((l) => window.vaultite?.dictation?.engines(l), "en-US")
  if (!engines?.apple) await skip(`Apple's recognizer doesn't dictate here (${JSON.stringify(engines)})`)
  const w9 = { window: 9, bundle: "com.example.notes", name: "Example Notes", title: "Draft", frame: { x: 100, y: 120, width: 800, height: 600 } }
  await helper((h, w) => { h.stub("focus", { ...w, field: false, pid: 1 }); h.stub("window", w); h.stub("at", w) }, w9)
  await wait(1500)
  const press = async () => {
    const n = await helper((h) => h.asked().filter((m) => m.kind === "ask").length)
    await helper((h) => h.heard({ event: "chord", name: "control_option", on: true }))
    await until(() => helper((h) => h.scene()?.summon?.state === "listening"), 8000)
    await until(() => helper((h) => (h.scene()?.summon?.words ?? "").length > 2), 30000, 200)
    await wait(1500)
    await helper((h) => h.heard({ event: "chord", name: "control_option", on: false }))
    return until(() => helper((h, k) => h.asked().filter((m) => m.kind === "ask")[k], n), 30000, 200)
  }
  const cards = () => app.windows().filter((p) => p.url().startsWith("data:text/html") && decodeURIComponent(p.url()).includes('href="takeover:yes"'))
  const shownUp = (u) => app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL() === url && w.isVisible()), u)
  const said = () => helper((h) => h.spoken().filter((m) => m.cmd === "say").map((m) => m.text).join(" "))

  const ask = await press()
  check("asked by voice", /defaults/i.test(ask?.text ?? ""), ask)
  const card = await until(() => cards()[0], 120000, 300)
  if (card) await until(() => shownUp(card.url()), 5000)
  const line = card ? decodeURIComponent(card.url()) : ""
  check("the blocked command is offered on a card by the pointer", /Run `defaults write com\.vaultite\.offer-test probe/.test(line), line.slice(0, 600))
  await wait(8000) // (longer than its words take)
  check("…and it stays up while they decide", !!card && !card.isClosed() && cards().length === 1)
  const before = await said()
  const hit = (page, sel) => page.locator(sel).click({ timeout: 5000 }).then(() => true, (e) => (console.log(`couldn't click ${sel}: ${e.message.split("\n")[0]}`), false))
  if (card) await hit(card, 'a[href="takeover:yes"]')
  check("clicking Run runs that command", await until(() => read("probe") === "1", 60000, 300), read("probe"))
  check("…the card goes", await until(() => !cards().length, 5000))
  check("…and the ask completes: it says it's done", await until(async () => (await said()).length > before.length && !(await helper((h) => h.scene()?.summon)), 60000, 300), (await said()).slice(before.length))
  console.log("said:", (await said()).slice(before.length))

  await until(async () => !(await helper((h) => h.scene()?.summon)) && !cards().length, 30000, 300)
  speak("Run these two as two separate commands at the same time, in parallel: defaults write com.vaultite.offer-test a -int 1, and defaults write com.vaultite.offer-test b -int 1.")
  await press()
  const first = await until(() => cards()[0], 120000, 300)
  const which = (c) => / (a|b) -int/.exec(c ? decodeURIComponent(c.url()) : "")?.[1]
  const one = which(first), other = one === "a" ? "b" : "a"
  check("two blocked commands at once: the first offered", !!one, first?.url().slice(0, 200))
  speak("Yes.")
  const n = await helper((h) => h.spoken().length)
  await press()
  const second = await until(() => cards().find((c) => which(c) === other), 60000, 300)
  check("a spoken yes answers it, and the other comes up for its own answer", !!second && !cards().some((c) => which(c) === one) && read(other) === null, cards().map(which))
  if (second) await until(() => shownUp(second.url()), 5000)
  check("…clicked Not now", !!second && !second.isClosed() && await hit(second, 'a[href="takeover:no"]'), second?.isClosed())
  check("…its Not now: the one said yes to runs, that one doesn't", await until(() => read(one) === "1", 60000, 300) && read(other) === null, [read(one), read(other)])
  check("…and it says so", await until(async () => (await helper((h) => h.spoken().length)) > n, 60000, 300), await said())
  console.log("said:", (await helper((h, k) => h.spoken().slice(k).filter((m) => m.cmd === "say").map((m) => m.text).join(" "), n)))
} finally {
  await app.close().catch(() => {})
  clear()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
