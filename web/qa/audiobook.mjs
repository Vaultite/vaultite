// The full player: an audiobook's cover, chapters, skips between them, bookmarks and the sleep timer, and the mini
// player opening it again, desktop and 390px. Needs ffmpeg. Writes Qa audiobook/: throwaway only.
//   node web/qa/audiobook.mjs <base url> <vault path> [out dir]
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { SHOTS, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url, { chrome: { args: ["--autoplay-policy=no-user-gesture-required"] } })
const enc = encodeURIComponent
const BOOK = "Qa audiobook/The keeper's log.m4b", OTHER = "Qa audiobook/Other.md"

// A 5 minute book (Opus in MP4: Chromium for Testing has no AAC) with three chapters and a cover inside it.
const dir = `${VAULT}/Qa audiobook`
fs.mkdirSync(dir, { recursive: true })
const ff = (...a) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...a])
const tmp = fs.mkdtempSync("/tmp/qa-book-")
fs.writeFileSync(`${tmp}/meta.txt`, ";FFMETADATA1\ntitle=The keeper's log\nartist=Alice Park\n" +
  [[0, 60, "Opening"], [60, 150, "The storm"], [150, 300, "Morning"]].map(([s, e, t]) => `[CHAPTER]\nTIMEBASE=1/1\nSTART=${s}\nEND=${e}\ntitle=${t}\n`).join(""))
ff("-f", "lavfi", "-i", "testsrc=s=300x300", "-frames:v", "1", `${tmp}/cover.jpg`)
ff("-f", "lavfi", "-i", "sine=f=330:d=300", "-i", `${tmp}/meta.txt`, "-i", `${tmp}/cover.jpg`, "-map", "0:a", "-map", "2:v", "-map_metadata", "1", "-map_chapters", "1",
  "-c:a", "libopus", "-b:a", "24k", "-c:v", "copy", "-disposition:v", "attached_pic", "-f", "mp4", `${dir}/The keeper's log.m4b`)
fs.rmSync(tmp, { recursive: true, force: true })
await fetch(`${B}api/file`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/qa" }, body: JSON.stringify({ path: OTHER, text: "Nothing playing here.\n" }) })
await wait(1500)

for (const [label, viewport] of [["desktop", { width: 1280, height: 820 }], ["phone", { width: 390, height: 844 }]]) {
  const page = watch(await (await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: label === "phone", hasTouch: label === "phone" })).newPage(), { label })
  const el = () => page.evaluate(() => { const v = document.querySelector("[data-player-for]"); return v && { t: v.currentTime, paused: v.paused, mini: !!v.closest("[data-mini-player]") } })
  const full = page.locator("[data-player-full]")
  await fetch(`${B}api/player/marks`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/qa" }, body: JSON.stringify({ path: BOOK, marks: [] }) })
  await page.goto(`${B}#file/${enc(BOOK)}`); await wait(2000)
  check(`${label}: a sound's tab is the full player`, await until(() => full.isVisible(), 5000))
  check(`${label}: its title and author from the file's tags`, await until(async () => { const t = await full.innerText(); return /The keeper's log/.test(t) && /Alice Park/.test(t) }, 5000), await full.innerText())
  check(`${label}: its cover from inside the file`, await until(() => full.locator("img").evaluate((i) => i.complete && i.naturalWidth > 0), 5000))
  check(`${label}: its chapters`, await until(async () => (await full.getByRole("radio", { name: /Chapters 3/ }).count()) === 1, 5000))
  await full.getByRole("button", { name: "Play", exact: true }).click()
  check(`${label}: it plays`, await until(async () => (await el())?.paused === false, 5000), await el())
  await full.getByRole("button", { name: /The storm/ }).click()
  check(`${label}: a chapter plays from its start`, await until(async () => { const v = await el(); return v.t >= 60 && v.t < 64 }, 4000), await el())
  check(`${label}: the playing chapter is marked`, await until(async () => (await full.locator("[aria-current]").innerText()).includes("The storm"), 3000))
  await full.getByRole("button", { name: "Next chapter" }).click()
  check(`${label}: next chapter`, await until(async () => { const v = await el(); return v.t >= 150 && v.t < 154 }, 4000), await el())
  await full.getByRole("button", { name: "Previous chapter" }).click()
  check(`${label}: previous chapter, moments in, goes to the one before`, await until(async () => { const v = await el(); return v.t >= 60 && v.t < 64 }, 4000), await el())

  await full.getByRole("button", { name: "Add bookmark" }).click(); await wait(600)
  const marks = (await (await fetch(`${B}api/player/places`)).json()).places?.[BOOK]?.marks ?? []
  check(`${label}: a bookmark is kept`, marks.length === 1 && marks[0].t >= 60 && marks[0].t < 65, marks)
  await full.getByRole("radio", { name: /Bookmarks/ }).click()
  check(`${label}: and listed under its chapter's name`, (await full.locator("section").innerText()).includes("The storm"))

  await full.getByRole("button", { name: "Sleep timer" }).click()
  await page.getByRole("menuitem", { name: "15 minutes" }).click(); await wait(1200)
  const sleep = await full.getByRole("button", { name: /^Sleep timer:/ }).innerText().catch(() => "")
  check(`${label}: the sleep timer counts down on its button`, /1[45]:\d\d/.test(sleep), sleep)
  await until(async () => !(await page.locator("[data-sonner-toast]").count()), 10_000) // (the bookmark's toast, with its Undo)
  await page.screenshot({ path: `${OUT}audiobook-full-${label}.png`, fullPage: false })

  await page.goto(`${B}#file/${enc(OTHER)}`); await wait(1500)
  const mini = page.locator("[data-mini-player]")
  check(`${label}: elsewhere the mini player names the chapter`, /The storm/.test(await mini.innerText().catch(() => "")), await mini.innerText().catch(() => ""))
  await page.screenshot({ path: `${OUT}audiobook-mini-${label}.png` })
  await mini.getByRole("button", { name: /The keeper's log/ }).click()
  check(`${label}: tapping it opens the full player`, await until(() => full.isVisible(), 4000) && (await el())?.paused === false, await el())
  await full.getByRole("button", { name: "Pause", exact: true }).click(); await wait(300)
  await page.close()
}
await done()
