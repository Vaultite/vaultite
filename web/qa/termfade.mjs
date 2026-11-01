// A closing terminal keeps its picture while it fades (core/snapshot.ts: offerPicture): its pane closed, and its tab
// dragged out as a card. Runs a shell: throwaway server only.
//   node web/qa/termfade.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { WEBGL, command, qa, terminalText, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/termfade-shots/"], browser, check, watch, done } = await qa(import.meta.url, { chrome: { args: WEBGL } })
mkdirSync(OUT, { recursive: true })
const id = `qa${Date.now().toString(36)}`

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage())
const cdp = await ctx.newCDPSession(page)
await cdp.send("Animation.enable")
const slow = (rate) => cdp.send("Animation.setPlaybackRate", { playbackRate: rate })
const end = (sid) => page.evaluate((s) => { new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminal/${s}?end=1`) }, sid)
/** How much of `el`'s box (a pane fading, a drag card) is lit like text on the terminal's ground: the share of its
 *  pixels far from the ground's colour, read from a screenshot of it. */
async function inked(sel, name) {
  const box = await page.locator(sel).first().boundingBox()
  if (!box) return -1
  const png = await page.screenshot({ path: `${OUT}${name}.png`, clip: box })
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode()
    const c = new OffscreenCanvas(img.width, img.height), g = c.getContext("2d"); g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, img.width, img.height).data, at = (i) => [d[i], d[i + 1], d[i + 2]]
    // (the ground: the colour of the box's middle row most often)
    const n = new Map(), mid = Math.floor(img.height / 2) * img.width * 4
    for (let x = 0; x < img.width; x++) { const k = at(mid + x * 4).join(); n.set(k, (n.get(k) ?? 0) + 1) }
    const ground = [...n].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number)
    let lit = 0
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - ground[0]) + Math.abs(d[i + 1] - ground[1]) + Math.abs(d[i + 2] - ground[2]) > 90) lit++
    return lit / (d.length / 4)
  }, png.toString("base64"))
}

try {
  await page.goto(B)
  await page.waitForSelector("section[aria-label=Pane]", { timeout: 30000 }); await wait(800)
  await command(page, "Split right", 600)
  await page.evaluate((s) => { location.hash = `#view/terminal%2F${s}` }, id)
  await until(() => page.$(".xterm-screen canvas"), 10000)
  await wait(1500)
  await page.click(".xterm-screen")
  await page.keyboard.type("for i in $(seq 1 30); do echo \"line $i of the closing picture ##########\"; done\n")
  check("the terminal shows its output", !!(await until(async () => /line 30 of/.test(await terminalText(page)), 8000)))
  const webgl = await page.evaluate(() => !!document.querySelector(".xterm-screen canvas:not(.xterm-link-layer)"))
  check("it draws with WebGL", webgl)
  await wait(500)
  const pane = await page.evaluate(() => document.querySelector(".xterm").closest("section[aria-label=Pane]").dataset.group)
  const live = await inked(`section[data-group="${pane}"] .xterm-screen`, "live")

  // Lifted as a card, by its pane's handle or its tab: the card's copy shows its lines too.
  for (const [what, grip] of [["pane", `[data-pane-handle="${pane}"]`], ["tab", `section[data-group="${pane}"] [data-tab-bar] [data-tab-id]`]]) {
    await page.hover(`section[data-group="${pane}"] [data-tab-bar]`)
    const h = await page.locator(grip).first().boundingBox()
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down()
    await page.mouse.move(h.x - 120, h.y + 200, { steps: 8 }); await wait(700)
    const card = await inked("[data-drag-ghost] > *", `${what}-card`)
    check(`its ${what} dragged: the card shows its text`, card > 0.01, { card })
    await page.keyboard.press("Escape"); await page.mouse.up()
    await until(async () => !(await page.$("[data-drag-ghost]")), 3000); await wait(300)
  }

  // Its pane closed: mid-fade, the copy that shrinks away shows its lines, not a blank ground.
  await slow(0.05)
  await page.evaluate(() => document.activeElement?.blur())
  await command(page, "Close pane", 0)
  await until(() => page.$("[data-pane-gone]"), 3000)
  await wait(500)
  const fading = await inked("[data-pane-gone] .xterm-screen", "pane-closing")
  await page.screenshot({ path: `${OUT}pane-closing-full.png` })
  check("closing its pane: its fading copy still shows its text", live > 0.01 && fading > live * 0.3, { live, fading })
  await slow(1)
  await until(async () => !(await page.$("[data-pane-gone]")), 5000)
} finally {
  await end(id).catch(() => {})
  await wait(300)
}
await done()
