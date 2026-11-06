// The terminal server's screens (vt/: libghostty-vt) against xterm.js: the same answers to programs, captures read the
// same, pictures replayed in xterm.js (the pages) show the same screen. `node tools/test_vt.ts` (npm test)
import crypto from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { newVt } from "../plugins/core/terminal/vt/load.ts"
import { LAYOUT } from "../plugins/core/terminal/vt/vt.ts"
import { minisignOk } from "./ghostty_update.ts"
import { inkFrames, seq, streaming } from "./perf/vtcorpus.ts"
import { check, section, summary } from "./test/lib.ts"

const t0 = Date.now()
const require = createRequire(import.meta.url)
const { Terminal } = require("@xterm/headless") as typeof import("@xterm/headless")
const VT = path.join(import.meta.dirname, "../plugins/core/terminal/vt")

/** xterm.js' headless terminal, fed `data`: its text as the server read it before (wrapped lines joined). */
async function xtermText(data: string, cols: number, rows: number, scrollback = 1000) {
  const t = new Terminal({ cols, rows, scrollback, allowProposedApi: true })
  await new Promise<void>((ok) => t.write(data, ok))
  const b = t.buffer.active, out: string[] = []
  for (let y = 0; y < b.length; y++) {
    const l = b.getLine(y)
    if (!l) continue
    const s = l.translateToString(true)
    if (l.isWrapped && out.length) out[out.length - 1] += s; else out.push(s)
  }
  while (out.length && !out[out.length - 1].trim()) out.pop()
  const cursor = { x: b.cursorX, y: b.cursorY }, alt = b.type === "alternate"
  t.dispose()
  return { text: out.join("\n"), cursor, alt }
}

await section("the module", () => {
  const wasm = fs.readFileSync(path.join(VT, "ghostty-vt.wasm")), prov = fs.readFileSync(path.join(VT, "PROVENANCE.md"), "utf8")
  const hash = crypto.createHash("sha256").update(wasm).digest("hex")
  check("ghostty-vt.wasm is the one PROVENANCE.md names", prov.includes(`SHA-256: ${hash}`), hash)
  // Its C structs where vt.ts has them: its own layouts (ghostty_type_json), a field's offset or a packed one's bit.
  const e = new WebAssembly.Instance(new WebAssembly.Module(wasm), {}).exports as Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory }
  const p = e.ghostty_type_json(), mem = new Uint8Array(e.memory.buffer)
  let n = p
  while (mem[n]) n++
  type T = { fields?: Record<string, { offset: number; type: string }>; bits?: Record<string, { lsb: number }>; type?: string }
  const types = JSON.parse(new TextDecoder().decode(mem.subarray(p, n))).types as Record<string, T>
  const at = (path: string) => {
    let [type, ...fields] = path.split("."), off = 0
    for (const f of fields) {
      const t = types[type]
      if (t?.bits) return off + (t.bits[f]?.lsb ?? NaN)
      const fd = t?.fields?.[f]
      if (!fd) return NaN
      off += fd.offset; type = fd.type
    }
    return off
  }
  const wrong = Object.entries(LAYOUT).filter(([k, v]) => at(k) !== v).map(([k, v]) => `${k}: ${at(k)}, vt.ts has ${v}`)
  check("the C structs and packed values vt.ts uses are where the module has them", !wrong.length, wrong)
  // (a signature made here for the check: Ghostty's own is checked when it's taken, by ghostty_update.ts)
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12), id = Buffer.from("0123456789abcdef", "hex").subarray(0, 8)
  const key = Buffer.concat([Buffer.from("Ed"), id, raw]).toString("base64"), data = Buffer.from("a module")
  const sig = crypto.sign(null, crypto.createHash("blake2b512").update(data).digest(), privateKey), trusted = "timestamp:1\tfile:x"
  const global = crypto.sign(null, Buffer.concat([sig, Buffer.from(trusted)]), privateKey)
  const file = `untrusted comment: x\n${Buffer.concat([Buffer.from("ED"), id, sig]).toString("base64")}\ntrusted comment: ${trusted}\n${global.toString("base64")}\n`
  check("the updater takes a release's minisign signature, and no other file's", minisignOk(data, file, key) && !minisignOk(Buffer.from("another"), file, key) && !minisignOk(data, file))
})

await section("answers", () => {
  // What xterm.js' headless terminal answered (test_vt's record of it, 2026-11-05), but graphemes (2027) on: the pages
  // draw with libghostty-vt too, so both count emoji sequences' widths as it does.
  const XTERM: Record<string, string> = {
    "\x1b[c": "\x1b[?1;2c", "\x1b[>c": "\x1b[>0;276;0c", "\x1b[5n": "\x1b[0n", "\x1b[6n": "\x1b[2;1R", "\x1b[?6n": "\x1b[?2;1R",
    "\x1b[?2004$p": "\x1b[?2004;2$y", "\x1b[?1049$p": "\x1b[?1049;2$y", "\x1b[?2026$p": "\x1b[?2026;2$y", "\x1b[?2027$p": "\x1b[?2027;1$y",
    "\x1b[4$p": "\x1b[4;2$y", "\x1bP$qm\x1b\\": "\x1bP1$r0m\x1b\\",
    // (none: no kitty keyboard, XTVERSION, colors, sizes, color scheme or ENQ)
    "\x1b[>q": "", "\x1b[?u": "", "\x1b]10;?\x07": "", "\x1b]11;?\x07": "", "\x1b]12;?\x07": "", "\x1b]4;1;?\x07": "",
    "\x1b[14t": "", "\x1b[16t": "", "\x1b[18t": "", "\x1b[?996n": "", "\x05": "",
  }
  const wrong: string[] = []
  for (const [q, want] of Object.entries(XTERM)) {
    let got = ""
    const v = newVt({ cols: 120, rows: 30, scrollback: 100, onReply: (r) => { got += r } })
    v.write(`hello\r\n${q}`)
    v.dispose()
    if (got !== want) wrong.push(`${JSON.stringify(q)}: ${JSON.stringify(got)}, not ${JSON.stringify(want)}`)
  }
  check("its answers to programs' questions are xterm.js'", !wrong.length, wrong)
  let got = ""
  const v = newVt({ cols: 80, rows: 24, scrollback: 100, onReply: (r) => { got += r } })
  v.write("\x1b[c\x1b[6n")
  check("answers to a piece of output come together, after it", got === "\x1b[?1;2c\x1b[1;1R", got)
  v.dispose()
})

await section("captures", async () => {
  for (const [name, data, cols, rows] of [["seq", seq(3000), 80, 24], ["streaming", streaming(400), 100, 30], ["ink", inkFrames(80), 120, 40]] as const) {
    const v = newVt({ cols, rows, scrollback: 1000 }), x = await xtermText(data, cols, rows)
    v.write(data)
    const mine = v.text(null), theirs = x.text
    // (whole pages go: libghostty-vt may keep more history than asked, so its text ends as xterm.js' does)
    check(`${name}: its text reads as xterm.js' did, its cursor where xterm.js had it`, mine.endsWith(theirs.split("\n").slice(-900).join("\n")) && JSON.stringify(v.cursor) === JSON.stringify(x.cursor),
      [mine.slice(-300), theirs.slice(-300), v.cursor, x.cursor])
    check(`${name}: its last lines`, v.text(10) === theirs.split("\n").slice(-10).join("\n"), [v.text(10), theirs.split("\n").slice(-10).join("\n")])
    v.dispose()
  }
  const v = newVt({ cols: 60, rows: 10, scrollback: 100 })
  v.write(`${"a".repeat(90)}\r\n`)
  check("a wrapped line reads as one", v.text(null) === "a".repeat(90), v.text(null))
  v.write("\x1b[1mdone\x1b[0m \x1b[2mdim\x1b[0m > ask \x1b[38;5;244mtry this\x1b[39m \x1b[38;2;128;128;128mand grey\x1b[0m")
  const input = v.inputLine()
  // (as the server read it with xterm.js: each cell plain or faint, the spaces between plain)
  check("the cursor's line: what's typed, and what's dim or grey (a suggestion)", input.typed === "done  > ask" && input.suggested === "dimtry thisand grey" && input.line === "done dim > ask try this and grey", input)
  v.write("\r\n東京 🙂 x")
  check("wide characters in the cursor's line", v.inputLine().typed === "東京 🙂 x", v.inputLine())
  v.write("\x1b]0;its title\x07")
  check("the title a program sets", v.title === "its title", v.title)
  v.write("\x1b[?2004h\x1b[?1h")
  check("its modes: bracketed paste, application cursor keys", v.mode(2004) && v.mode(1) && !v.mode(1049), [v.mode(2004), v.mode(1)])
  v.write("\x1b[?2004l")
  check("… and off again", !v.mode(2004))
  v.dispose()
  const big = newVt({ cols: 80, rows: 24, scrollback: 500 })
  big.write(seq(20000))
  const kept = big.length
  check("history kept to about its scrollback (whole pages go)", kept >= 524 && kept < 2000, kept)
  big.dispose()
})

await section("pictures replayed in xterm.js", async () => {
  for (const [name, data, cols, rows] of [["seq", seq(500), 80, 24], ["streaming", streaming(200), 100, 30], ["ink", inkFrames(60), 120, 40]] as const) {
    const v = newVt({ cols, rows, scrollback: 1000 })
    v.write(data)
    const pic = v.serialize(), direct = await xtermText(data, cols, rows), replayed = await xtermText(pic, cols, rows)
    check(`${name}: its picture draws in xterm.js what the output did, the cursor where it was`, replayed.text === direct.text && JSON.stringify(replayed.cursor) === JSON.stringify(direct.cursor),
      [replayed.text.slice(-200), direct.text.slice(-200), replayed.cursor, direct.cursor])
    check(`${name}: its picture sets no palette (the page's colors stay)`, !/\x1b\]4;/.test(pic))
    v.dispose()
  }
  const v = newVt({ cols: 40, rows: 8, scrollback: 100 })
  const data = "one\r\ntwo\r\n$ vim\x1b[?1049h\x1b[H\x1b[2Jin the editor\x1b[3;5H"
  v.write(data)
  const pic = v.serialize(), direct = await xtermText(data, 40, 8), replayed = await xtermText(pic, 40, 8)
  check("the alternate screen up: its picture has it, the cursor in it", replayed.alt && replayed.text === direct.text && JSON.stringify(replayed.cursor) === JSON.stringify(direct.cursor), [pic, replayed, direct])
  const back = await xtermText(`${pic}\x1b[?1049l`, 40, 8), backDirect = await xtermText(`${data}\x1b[?1049l`, 40, 8)
  check("… and the screen under it, back once it ends", back.text === backDirect.text && JSON.stringify(back.cursor) === JSON.stringify(backDirect.cursor), [back, backDirect])
  const blink = newVt({ cols: 40, rows: 8, scrollback: 100 })
  blink.write("\x1b[?12h\x1b[?2004hx")
  check("its picture keeps its modes but the cursor's blinking (the page's setting)", !blink.serialize().includes("?12h") && blink.serialize().includes("\x1b[?2004h"), blink.serialize())
  blink.dispose()
  check("HTML of its screen", /in the editor/.test(v.html(0)) && /<\w+/.test(v.html(0)), v.html(0).slice(0, 200))
  v.write("x\x1b[?1049l")
  check("its own screen under it is kept", v.text(null) === "one\ntwo\n$ vim", v.text(null))
  v.dispose()
})

await section("sizes", async () => {
  const v = newVt({ cols: 40, rows: 6, scrollback: 100 })
  v.write(`${"word ".repeat(20)}\r\nshort`)
  v.resize(100, 6)
  check("a resize reflows its lines", v.cols === 100 && v.rows === 6 && v.text(null) === `${"word ".repeat(20).trimEnd()}\nshort`, v.text(null))
  v.resize(20, 4)
  check("… narrower too", v.text(null) === `${"word ".repeat(20).trimEnd()}\nshort`, v.text(null))
  v.dispose()
})

await section("memory", () => {
  const vs = Array.from({ length: 20 }, () => newVt({ cols: 120, rows: 40, scrollback: 10000 }))
  const each = vs[0].memory
  check("a new terminal holds under 2 MB", each < 2 * 1024 * 1024, each)
  for (const v of vs) v.dispose()
})

summary("vt", t0)
