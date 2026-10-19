// Player: a time in a note plays its video from there and is lit; going to another file keeps it playing in the mini
// player (the picture in it), where it stopped is kept on the server; the queue lists it with its time left and plays
// an episode from its row; captions and speed. Desktop and 390px. Needs ffmpeg for its media. WRITES "Qa player" and
// files in Attachments/: throwaway only.
//   node web/qa/player.mjs <base url> <vault path> [out dir]
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { SHOTS, qa, until, wait } from "./lib/qa.mjs"
import { pagePath } from "./subjects.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url, { chrome: { args: ["--autoplay-policy=no-user-gesture-required"] } })
const enc = encodeURIComponent
const put = (path, text) => fetch(`${B}api/file`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/qa" }, body: JSON.stringify({ path, text }) })
const TALK = "Qa player/Talk.md", EP = "Qa player/Episode.md", OTHER = "Qa player/Other.md"

// Media made here: a 2.5 minute video with captions and a picture, a 3 minute episode.
const dir = `${VAULT}/Qa player`
fs.mkdirSync(dir, { recursive: true })
const ff = (...a) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...a])
ff("-f", "lavfi", "-i", "testsrc=d=150:s=320x180:r=15", "-f", "lavfi", "-i", "sine=f=440:d=150", "-c:v", "libvpx-vp9", "-b:v", "100k", "-c:a", "libopus", "-shortest", `${dir}/Qa talk.webm`)
ff("-f", "lavfi", "-i", "sine=f=330:d=180", "-c:a", "libopus", `${dir}/Qa episode.opus`)
ff("-f", "lavfi", "-i", "testsrc=s=160x160", "-frames:v", "1", `${dir}/Qa episode.jpg`)
fs.writeFileSync(`${dir}/Qa talk.vtt`, "WEBVTT\n\n00:00:01.000 --> 00:00:09.000\nHello from the captions\n")
await put(TALK, "---\ntype: inbox\nstatus: new\nfrom: Videos\nsource: https://example.com/talk\n---\n\n![[Qa talk.webm]]\n\n- 0:30 Intro\n- 1:15 The middle\n\n## Transcript\n\n**0:00** Hello.\n\n**1:00** The middle part.\n")
await put(EP, "---\ntype: inbox\nstatus: new\nfrom: A show\nsource: https://example.com/ep\n---\n\n![[Qa episode.opus]]\n\nAn episode.\n")
await put(OTHER, "Nothing playing here.\n")
await wait(1500)

for (const [label, viewport] of [["desktop", { width: 1280, height: 820 }], ["phone", { width: 390, height: 844 }]]) {
  const page = watch(await (await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: label === "phone", hasTouch: label === "phone" })).newPage(), { label })
  const el = () => page.evaluate(() => { const v = document.querySelector("[data-player-for]"); return v && { t: v.currentTime, paused: v.paused, mini: !!v.closest("[data-mini-player]"), rate: v.playbackRate } })
  await page.goto(`${B}#file/${enc(TALK)}`); await wait(2000)
  await page.evaluate(() => document.querySelectorAll("[data-sonner-toast]").forEach((t) => t.remove()))
  check(`${label}: the note's times are links`, await until(async () => await page.locator(".cm-timestamp").count() >= 3, 5000))
  await page.locator(".cm-timestamp", { hasText: "1:15" }).first().click()
  await until(async () => ((await el())?.t ?? 0) > 75, 5000)
  const a = await el()
  check(`${label}: a time plays from there`, a && !a.paused && a.t >= 75 && a.t < 80, a)
  check(`${label}: and is lit`, (await page.locator(".cm-timestamp-now").allInnerTexts()).includes("1:15"))
  check(`${label}: captions and speed under the video`, await page.getByRole("button", { name: "Captions" }).count() === 1 && await page.getByRole("button", { name: /^Speed/ }).count() === 1)

  await page.goto(`${B}#file/${enc(OTHER)}`); await wait(1500)
  const b = await el()
  check(`${label}: elsewhere it keeps playing, in the mini player`, b && !b.paused && b.mini && b.t > a.t, b)
  await page.screenshot({ path: `${OUT}player-mini-${label}.png` })
  if (label === "desktop") {
    const mini = page.locator("[data-mini-player]")
    if (await page.locator("[data-sidebar-toggle=right]").getAttribute("aria-expanded") !== "true") { await page.locator("[data-sidebar-toggle=right]").click(); await wait(500) }
    const side = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--right-sidebar")) || 0)
    const r0 = await mini.boundingBox()
    check("desktop: the mini player keeps clear of the right sidebar", side > 100 && r0 && r0.x + r0.width <= viewport.width - side - 8, { r0, side })
    await page.screenshot({ path: `${OUT}player-mini-sidebar-${label}.png` })
    check("desktop: its picture has no browser controls", await page.evaluate(() => document.querySelector("[data-mini-player] video")?.controls === false))
    await page.mouse.move(r0.x + 100, r0.y + 60); await page.mouse.down()
    for (let i = 1; i <= 10; i++) { await page.mouse.move(r0.x + 100 - i * 80, r0.y + 60 - i * 50); await wait(16) }
    await page.mouse.up(); await wait(600)
    const r1 = await mini.boundingBox()
    check("desktop: dragged, it lands in the top left corner", r1 && r1.y < 140 && r1.x < viewport.width / 2, r1)
    check("desktop: a drag doesn't open the note", page.url().includes("Other"), page.url())
  }
  await page.getByRole("button", { name: "Pause" }).first().click(); await wait(800)
  const kept = await (await fetch(`${B}api/player/places`)).json()
  check(`${label}: where it stopped is kept`, Math.abs((kept.places?.["Qa player/Qa talk.webm"]?.t ?? 0) - (await el()).t) < 2, kept.places?.["Qa player/Qa talk.webm"])
  await page.getByRole("button", { name: "Stop" }).click(); await wait(400)
  check(`${label}: Stop closes the mini player`, await page.locator("[data-mini-player]").count() === 0)

  await page.goto(`${B}#file/${enc(await pagePath(B, "Queue"))}`); await wait(2000)
  const row = page.locator('[data-queue-row="Qa player/Talk"]')
  check(`${label}: the queue shows its time left`, /left/.test(await row.innerText().catch(() => "")), await row.innerText().catch(() => ""))
  const play = page.locator('[data-queue-row="Qa player/Episode"] [aria-label="Play"]')
  await page.evaluate(() => document.querySelectorAll("[data-sonner-toast]").forEach((t) => t.remove()))
  await play.evaluate((e) => e.scrollIntoView({ block: "center" })); await play.click(); await wait(1500)
  const c = await el()
  check(`${label}: play in the queue starts the episode in the mini player`, c && !c.paused && /Episode/.test(await page.locator("[data-mini-player]").innerText().catch(() => "")), c)
  await page.screenshot({ path: `${OUT}player-queue-${label}.png` })
  await page.getByRole("button", { name: "Stop" }).click(); await wait(300)
  await page.close()
}
await done()
