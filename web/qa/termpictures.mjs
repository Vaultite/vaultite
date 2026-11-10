// Kitty graphics pictures drawn in a terminal: a PNG shown as Claude Code shows one (Unicode placeholders), Claude Code's
// own bytes for one (tools/fixtures/claude/kitty-picture.bin), and RGBA pixels placed at the cursor; read back from the
// screen in WebGL and in Canvas2D, after a reload (the server sends them again), and on a phone. Runs a shell: throwaway
// server only.
//   node web/qa/termpictures.mjs <base url> [shots dir]
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { ROOT, WEBGL, launch, qa, terminalText, until, wait, webkitLaunch } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/termpictures/"], browser, check, watch, done } = await qa(import.meta.url, { chrome: { args: WEBGL } })
fs.mkdirSync(OUT, { recursive: true })

/** The colours drawn: the PNG's four quadrants, the RGBA picture's. */
const COLORS = { red: [230, 40, 40], green: [40, 180, 60], blue: [40, 80, 230], yellow: [240, 200, 30], magenta: [200, 0, 200] }

function png(W, H) {
  const raw = Buffer.alloc((W * 3 + 1) * H), q = [COLORS.red, COLORS.green, COLORS.blue, COLORS.yellow]
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) raw.set(q[(x < W / 2 ? 0 : 1) + (y < H / 2 ? 0 : 2)], y * (W * 3 + 1) + 1 + x * 3)
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
  const chunk = (t, d) => { const l = Buffer.alloc(4), c = Buffer.alloc(4), td = Buffer.concat([Buffer.from(t), d]); l.writeUInt32BE(d.length); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}
// Claude Code's way: a PNG in 4096-byte chunks (a=T,U=1,q=2), then its placeholder cells, the id as a 256 colour.
const D = ["̅", "̍", "̎", "̐", "̒", "̽", "̾", "̿", "͆", "͊", "͋", "͌"]
const b64 = png(160, 96).toString("base64"), parts = b64.match(/.{1,4096}/g)
const viaPlaceholders = parts.map((c, i) => (i === 0 ? `\x1b_Ga=T,U=1,q=2,f=100,i=9,c=12,r=4,m=${parts.length > 1 ? 1 : 0};${c}\x1b\\` : `\x1b_Gm=${i === parts.length - 1 ? 0 : 1},q=2;${c}\x1b\\`)).join("")
  + `\x1b[38;5;9m${[0, 1, 2, 3].map((r) => Array.from({ length: 12 }, (_, c) => `\u{10EEEE}${D[r]}${D[c]}`).join("")).join("\r\n")}\x1b[39m`
// RGBA pixels at the cursor (a=T, direct), over text.
const rgba = Buffer.alloc(48 * 48 * 4)
for (let i = 0; i < 48 * 48; i++) rgba.set([...COLORS.magenta, 255], i * 4)
const atCursor = `\x1b_Ga=T,i=11,f=32,s=48,v=48,c=6,r=3,q=2;${rgba.toString("base64")}\x1b\\`
// (Claude Code 2.1.319 drawing a mod's two Images: one by its bytes, one by a file it names, here)
const real = path.join(ROOT, "tools/fixtures/claude/kitty-picture.bin"), realFile = "/tmp/vaultite-kitty-picture.png"

/** Where each colour shows in the terminal's screenshot: how many pixels, and their centre. */
async function colours(page, name) {
  const box = await page.locator("[data-term-screen]").first().boundingBox()
  const shot = await page.screenshot({ path: path.join(OUT, `${name}.png`), clip: box })
  return page.evaluate(async ([b64, colors]) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode()
    const c = new OffscreenCanvas(img.width, img.height), g = c.getContext("2d"); g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, img.width, img.height).data, out = {}
    for (const [k, [r, gg, b]] of Object.entries(colors)) {
      let n = 0, sx = 0, sy = 0
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r) < 24 && Math.abs(d[i + 1] - gg) < 24 && Math.abs(d[i + 2] - b) < 24) { n++; sx += (i / 4) % img.width; sy += Math.floor(i / 4 / img.width) }
      out[k] = { n, x: n ? sx / n : -1, y: n ? sy / n : -1 }
    }
    return out
  }, [shot.toString("base64"), COLORS])
}
const quadrants = (c) => c.red.n > 200 && c.green.n > 200 && c.blue.n > 200 && c.yellow.n > 200
  && c.red.x < c.green.x && c.blue.x < c.yellow.x && c.red.y < c.blue.y && c.green.y < c.yellow.y

async function run(b, label, { phone = false, reload = true } = {}) {
  const id = `qa${Date.now().toString(36)}${label.replace(/\W/g, "")}`
  const ctx = await b.newContext(phone ? { viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: !label.includes("webkit"), deviceScaleFactor: 3 } : { viewport: { width: 1100, height: 700 }, deviceScaleFactor: 2 })
  await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
  const page = watch(await ctx.newPage(), { label })
  const dir = fs.mkdtempSync("/tmp/termpictures-")
  try {
    await page.goto(`${B}#view/terminal%2F${id}`)
    await until(() => page.$("[data-term-screen]"), 20000)
    await until(async () => /\$|%/.test(await terminalText(page)), 15000)
    const renderer = await page.evaluate(() => document.querySelector("[data-term]")?.getAttribute("data-term-renderer"))
    const show = async (name, bytes) => {
      fs.writeFileSync(path.join(dir, `${name}.bin`), Buffer.concat([Buffer.from("\x1bc"), Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), Buffer.from("\r\nfixture-end")]))
      await page.locator("[data-term]").first().click()
      // (the last fixture's sleep ended first)
      await page.keyboard.press("Control+C"); await wait(300)
      await page.keyboard.type(`clear; cat ${path.join(dir, `${name}.bin`)}; sleep 60\n`)
      return until(async () => /fixture-end/.test(await terminalText(page)), 10000)
    }
    check(`${label} (${renderer}): the PNG, as Claude Code sends it, shown`, !!(await show("placeholders", `pictures\r\n${viaPlaceholders}`)))
    await wait(800)
    let c = await colours(page, `${label}-placeholders`)
    check(`${label}: its four quadrants drawn where they are`, quadrants(c), c)
    if (reload) {
      await page.reload()
      await until(() => page.$("[data-term-screen]"), 20000)
      await until(async () => /fixture-end/.test(await terminalText(page)), 15000)
      // (focused, as before it: WebKit's screenshot reads a WebGL canvas's buffer, kept only while it draws, and an idle
      // unfocused terminal draws nothing, so it reads blank where the screen shows the frame; the cursor's blink draws)
      await page.locator("[data-term]").first().click()
      await wait(1000)
      c = await colours(page, `${label}-reloaded`)
      check(`${label}: after a reload too (the server sent them again)`, quadrants(c), c)
    }
    await page.keyboard.press("Control+C"); await wait(300)
    check(`${label}: RGBA pixels placed at the cursor, over text`, !!(await show("cursor", `over text over text over text\r\n${atCursor}after`)))
    await wait(800)
    c = await colours(page, `${label}-cursor`)
    check(`${label}: … drawn`, c.magenta.n > 400, c.magenta)
    await page.keyboard.press("Control+C"); await wait(300)
    if (fs.existsSync(real)) {
      fs.writeFileSync(realFile, png(96, 64))
      check(`${label}: Claude Code's own bytes for a picture`, !!(await show("claude", fs.readFileSync(real))))
      await wait(800)
      c = await colours(page, `${label}-claude`)
      check(`${label}: … drawn`, quadrants(c), c)
      await page.keyboard.press("Control+C"); await wait(300)
    }
    return renderer
  } finally {
    await page.evaluate((s) => { new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminal/${s}?end=1`) }, id).catch(() => {})
    await wait(300)
    await ctx.close()
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(realFile, { force: true })
  }
}

check("WebGL draws them", (await run(browser, "webgl")) === "webgl")
const plain = await launch({ args: ["--disable-webgl", "--disable-webgl2", "--disable-gpu"] })
try { check("Canvas2D draws them", (await run(plain, "canvas")) === "canvas") } finally { await plain.close() }
await run(browser, "phone", { phone: true })
const wk = await webkitLaunch().catch(() => null)
if (wk) try { await run(wk, "phone-webkit", { phone: true }) } finally { await wk.close() }
else console.log("skipped: WebKit isn't installed (npx playwright install webkit)")
await done()
