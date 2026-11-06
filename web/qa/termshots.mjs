// The terminal's drawing on fixture screens (Claude Code's UI, box drawing, emoji and CJK, underline styles, dim,
// truecolor), as screenshots; given a folder of earlier ones (another renderer's), how far each is from it. Runs a shell:
// throwaway server only.
//   node web/qa/termshots.mjs <base url> [out dir] [baseline dir]
import fs from "node:fs"
import path from "node:path"
import { WEBGL, qa, terminalText, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/termshots/", BASE], browser, check, watch, done } = await qa(import.meta.url, { chrome: { args: WEBGL } })
fs.mkdirSync(OUT, { recursive: true })
const id = `qa${Date.now().toString(36)}`
const E = "\x1b["
const rgb = (r, g, b) => `${E}38;2;${r};${g};${b}m`
/** Each fixture's text, ending in a line the script waits for. */
const FIXTURES = {
  claude: [
    `${rgb(215, 119, 87)}╭───────────────────────────────────────────────────╮${E}0m`,
    `${rgb(215, 119, 87)}│${E}0m ${rgb(215, 119, 87)}✻${E}0m Welcome to ${E}1mClaude Code${E}0m!                         ${rgb(215, 119, 87)}│${E}0m`,
    `${rgb(215, 119, 87)}│${E}0m                                                   ${rgb(215, 119, 87)}│${E}0m`,
    `${rgb(215, 119, 87)}│${E}0m   ${E}2m/help for help, /status for your setup${E}0m         ${rgb(215, 119, 87)}│${E}0m`,
    `${rgb(215, 119, 87)}╰───────────────────────────────────────────────────╯${E}0m`,
    "",
    `${E}38;5;246m>${E}0m Fix the failing test in ${E}1msrc/app.ts${E}0m`,
    "",
    `${rgb(78, 186, 101)}⏺${E}0m Read(${E}1msrc/app.ts${E}0m)`,
    `  ⎿  Read ${E}1m120${E}0m lines`,
    `${rgb(78, 186, 101)}⏺${E}0m Update(${E}1msrc/app.ts${E}0m)`,
    `  ⎿  Updated ${E}1msrc/app.ts${E}0m with ${E}1m1${E}0m addition and ${E}1m1${E}0m removal`,
    `       ${E}48;2;61;1;0m${rgb(255, 220, 220)} 12 -   return a + b ${E}0m`,
    `       ${E}48;2;2;40;0m${rgb(220, 255, 220)} 12 +   return a - b ${E}0m`,
    "",
    `${rgb(215, 119, 87)}✻ Thinking… ${E}0m${E}2m(12s · ↑ 1.2k tokens · esc to interrupt)${E}0m`,
    "",
    `${E}38;5;244m╭───────────────────────────────────────────────────╮${E}0m`,
    `${E}38;5;244m│${E}0m > ${E}7m ${E}0m                                               ${E}38;5;244m│${E}0m`,
    `${E}38;5;244m╰───────────────────────────────────────────────────╯${E}0m`,
    `  ${E}2m? for shortcuts${E}0m                    ${rgb(215, 119, 87)}◯ IDE${E}0m  fixture-end`,
  ],
  box: [
    "┌─┬─┐ ┏━┳━┓ ╔═╦═╗ ╭─┬─╮ ┍━┯━┑",
    "│ │ │ ┃ ┃ ┃ ║ ║ ║ │ │ │ │ │ │",
    "├─┼─┤ ┣━╋━┫ ╠═╬═╣ ├─┼─┤ ┝━┿━┥",
    "│ │ │ ┃ ┃ ┃ ║ ║ ║ │ │ │ │ │ │",
    "└─┴─┘ ┗━┻━┛ ╚═╩═╝ ╰─┴─╯ ┕━┷━┙",
    "╌╌╌ ┄┄┄ ┈┈┈ ╍╍╍ ┅┅┅ ┉┉┉ ╱╲╳ ╴╵╶╷",
    "████████ ▀▀▀▀ ▄▄▄▄ ▌▌▐▐ ░░░ ▒▒▒ ▓▓▓",
    "▁▂▃▄▅▆▇█ ▏▎▍▌▋▊▉ ▖▗▘▙▚▛▜▝▞▟",
    `${E}44m┌──────────┐${E}0m ${E}31;42m▀▄▀▄▀▄▀▄${E}0m`,
    `${E}44m│ on blue  │${E}0m ${E}33;45m▐▌▐▌▐▌▐▌${E}0m`,
    `${E}44m└──────────┘${E}0m fixture-end`,
  ],
  unicode: [
    "emoji: 👍 🎉 🚀 ✅ ❌ ⚠️ 🔥",
    "zwj: 👨‍👩‍👧‍👦 🏳️‍🌈 👩🏽‍💻 🧑‍🚀",
    "flags: 🇺🇸 🇯🇵 🇫🇷",
    "cjk: 漢字かなカナ 한국어 中文字符",
    "wide|漢|x|字|y",
    "combining: é ä ñ Z̵",
    "arrows: ← ↑ → ↓ ⇧ ⌘ ⌥ ⌃ ⏎",
    "fixture-end",
  ],
  underline: [
    `${E}4msingle${E}0m ${E}4:2mdouble${E}0m ${E}4:3mcurly${E}0m ${E}4:4mdotted${E}0m ${E}4:5mdashed${E}0m`,
    `${E}4;58;2;255;0;0mred underline${E}0m ${E}4:3;58;5;33mblue curly${E}0m`,
    `${E}9mstrike${E}0m ${E}53moverline${E}0m ${E}4;9mboth${E}0m`,
    `${E}31;4mred text underlined${E}0m ${E}1;4mbold underlined${E}0m`,
    "fixture-end",
  ],
  dim: [
    `normal ${E}2mdim${E}0m ${E}1mbold${E}0m ${E}3mitalic${E}0m ${E}1;3mbold italic${E}0m ${E}7minverse${E}0m`,
    ...[31, 32, 33, 34, 35, 36, 37].map((c) => `${E}${c}mcolor ${c}${E}0m ${E}2;${c}mdim ${c}${E}0m ${E}1;${c}mbold ${c}${E}0m ${E}${c + 60}mbright ${c + 60}${E}0m`),
    `${E}2;7mdim inverse${E}0m ${E}8mhidden${E}0m<-hidden`,
    "fixture-end",
  ],
  truecolor: [
    ...[0, 1, 2, 3].map((row) => Array.from({ length: 64 }, (_, i) => {
      const t = i / 63, [r, g, b] = row === 0 ? [255 * t, 0, 255 * (1 - t)] : row === 1 ? [0, 255 * t, 128] : row === 2 ? [255, 255 * t, 0] : [255 * t, 255 * t, 255 * t]
      return `${E}48;2;${Math.round(r)};${Math.round(g)};${Math.round(b)}m `
    }).join("") + `${E}0m`),
    Array.from({ length: 32 }, (_, i) => `${E}38;2;${i * 8};${255 - i * 8};200m█`).join("") + `${E}0m`,
    Array.from({ length: 16 }, (_, i) => `${E}48;5;${i}m  `).join("") + `${E}0m`,
    Array.from({ length: 36 }, (_, i) => `${E}48;5;${16 + i * 6}m `).join("") + `${E}0m`,
    "fixture-end",
  ],
}

/** Share of pixels that differ (any channel by more than 48) between two PNGs of one size, read in the page. */
const diff = (a, b) => page.evaluate(async ([a, b]) => {
  const read = async (b64) => { const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode(); const c = new OffscreenCanvas(img.width, img.height), g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height) }
  const [x, y] = [await read(a), await read(b)]
  const w = Math.min(x.width, y.width), h = Math.min(x.height, y.height)
  let off = 0
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const p = (j * x.width + i) * 4, q = (j * y.width + i) * 4
    if (Math.abs(x.data[p] - y.data[q]) > 48 || Math.abs(x.data[p + 1] - y.data[q + 1]) > 48 || Math.abs(x.data[p + 2] - y.data[q + 2]) > 48) off++
  }
  return { off: off / (w * h), size: [x.width, x.height, y.width, y.height] }
}, [a.toString("base64"), b.toString("base64")])

const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: Number(process.env.DPR || 1) })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage())
const dir = fs.mkdtempSync("/tmp/termshots-fixtures-")
try {
  await page.goto(B)
  await page.waitForSelector("section[data-pane-frame]", { timeout: 30000 }); await wait(800)
  await page.evaluate((s) => { location.hash = `#view/terminal%2F${s}` }, id)
  await until(() => page.$("[data-term-screen]"), 10000)
  await until(async () => /\$|%/.test(await terminalText(page)), 10000)
  await page.click("[data-term-screen]")
  const renderer = await page.evaluate(() => document.querySelector("[data-term]")?.getAttribute("data-term-renderer"))
  fs.writeFileSync(path.join(OUT, "renderer.txt"), `${renderer}\n`)
  for (const [name, lines] of Object.entries(FIXTURES)) {
    const file = path.join(dir, `${name}.txt`)
    // (drawn from the top-left of a cleared screen, the cursor hidden)
    fs.writeFileSync(file, `\x1bc\x1b[?25l${lines.join("\r\n")}`)
    await page.keyboard.type(`stty -echo; cat ${file}; sleep 30; printf '\\e[?25h'; stty echo\n`)
    check(`${name}: drawn`, !!(await until(async () => /fixture-end/.test(await terminalText(page)), 8000)))
    await wait(700)
    const box = await page.locator("[data-term-screen]").first().boundingBox()
    const png = await page.screenshot({ path: path.join(OUT, `${name}.png`), clip: { x: box.x, y: box.y, width: Math.min(box.width, 760), height: Math.min(box.height, 420) } })
    const before = BASE && path.join(BASE, `${name}.png`)
    if (before && fs.existsSync(before)) {
      const d = await diff(png, fs.readFileSync(before))
      console.log(`${name}: ${(d.off * 100).toFixed(2)}% of pixels differ from ${before}`)
    }
    await page.keyboard.press("Control+C"); await wait(300)
    await page.keyboard.type("printf '\\e[?25h'; stty echo; clear\n"); await wait(300)
  }
} finally {
  await page.evaluate((s) => { new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminal/${s}?end=1`) }, id).catch(() => {})
  await wait(300)
  fs.rmSync(dir, { recursive: true, force: true })
}
await done()
