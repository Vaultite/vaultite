// The terminal server's screens (vt/: libghostty-vt) against xterm.js: the same answers to programs, captures read the
// same, pictures replayed in xterm.js (the pages) show the same screen. `node tools/test_vt.ts` (npm test)
import crypto from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { newVt } from "../plugins/core/terminal/vt/load.ts"
import { KITTY_STORAGE, LAYOUT, wasiImports } from "../plugins/core/terminal/vt/vt.ts"
import { Screen } from "../plugins/core/terminal/vt/screen.ts"
import { keptScale, KittyFeed, readPicture, REPLAY_MAX, withPictures } from "../plugins/core/terminal/termd/kitty.ts"
import { decodePng } from "../plugins/core/terminal/termd/png.ts"
import { about, minisignOk } from "./ghostty_update.ts"
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
  const mod = new WebAssembly.Module(wasm)
  let memory: WebAssembly.Memory | null = null
  const e = new WebAssembly.Instance(mod, wasiImports(mod, () => memory!)).exports as Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory }
  memory = e.memory
  check("it draws kitty graphics, built from a clean tree", about(wasm).kitty && !about(wasm).dirty, about(wasm))
  const imports = WebAssembly.Module.imports(mod).map((i) => `${i.module}.${i.name}`)
  check("it imports WASI functions only, each one vt.ts gives", imports.every((i) => i.startsWith("wasi_snapshot_preview1.")), imports)
  // (a module importing env.open: refused)
  let refused = false
  try { wasiImports(new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 12, 1, 3, 101, 110, 118, 4, 111, 112, 101, 110, 0, 0])), () => memory!) } catch { refused = true }
  check("… and one importing anything else is refused", refused)
  check("its debug info left out (-Dstrip)", [".debug_info", ".debug_line", "name"].every((n) => !WebAssembly.Module.customSections(mod, n).length))
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

await section("kitty graphics", async () => {
  const wasmModule = new WebAssembly.Module(fs.readFileSync(path.join(VT, "ghostty-vt.wasm")))
  const answers = (data: string, screen: boolean) => {
    let got = ""
    const o = { cols: 80, rows: 24, scrollback: 100, onReply: (r: string) => { got += r } }
    const v = screen ? new Screen(wasmModule, o) : newVt(o)
    v.write(data)
    v.dispose()
    return got
  }
  // Claude Code's probe: a query by direct pixels, then DA.
  const probe = "\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\\x1b[c"
  check("a kitty graphics query is answered as kitty does, then DA", answers(probe, false) === "\x1b_Gi=31;OK\x1b\\\x1b[?1;2c", JSON.stringify(answers(probe, false)))
  check("… the same by the server's terminal and a page's", answers(probe, false) === answers(probe, true))
  const bad = "\x1b_Gi=32,s=2,v=2,a=q,t=d,f=24;AAAA\x1b\\\x1b_Gi=33,a=q,t=f,f=100;L2V0Yy9wYXNzd2Q=\x1b\\"
  check("… and so are its errors (a short picture; a file, which only termd reads)", answers(bad, false) === answers(bad, true) && /i=32;E/.test(answers(bad, false)) && /i=33;E/.test(answers(bad, false)), JSON.stringify(answers(bad, false)))

  const rgba = Buffer.alloc(4 * 3 * 4)
  for (let i = 0; i < 12; i++) rgba.set([i * 20, 255 - i * 20, 7, 255], i * 4)
  const v = newVt({ cols: 40, rows: 10, scrollback: 100 })
  v.write(`hi\r\n\x1b_Ga=T,i=5,f=32,s=4,v=3,q=2;${rgba.toString("base64")}\x1b\\after`)
  const pic = v.picture(5)
  check("a direct RGBA picture is stored, its pixels as sent", pic?.width === 4 && pic.height === 3 && pic.format === "rgba" && Buffer.from(pic.data).equals(rgba), pic)
  const pl = v.placements()
  check("… placed at the cursor (a cell of history and screen)", pl.length === 1 && pl[0].image === 5 && pl[0].x === 0 && pl[0].y === 1 && !pl[0].virtual, pl)
  check("… the cursor after it, as kitty moves it", v.cursor.y === 1 && v.cursor.x > 5, v.cursor)

  // A PNG, direct, in chunks, as Claude Code sends one: termd decodes it (the pages have no decoder).
  const png = tinyPng()
  const chunks = png.toString("base64").match(/.{1,64}/g)!
  const seqPng = chunks.map((c, i) => (i === 0 ? `\x1b_Ga=T,U=1,q=2,f=100,i=9,c=6,r=2,m=1;${c}\x1b\\` : `\x1b_Gm=${i === chunks.length - 1 ? 0 : 1},q=2;${c}\x1b\\`)).join("")
  let fed = ""
  const feed = new KittyFeed({ emit: (d) => { fed += d }, remote: () => false })
  for (let i = 0; i < seqPng.length; i += 37) feed.feed(seqPng.slice(i, i + 37))
  const px = decodePng(png, 1 << 20)!
  check("termd's PNGs: decoded, sent on as pixels (zlib)", /^\x1b_Ga=T,U=1,q=2,f=24,i=9,c=6,r=2,s=8,v=6,o=z,t=d;/.test(fed), fed.slice(0, 80))
  // A tall screenshot shown in a few cells: kept at the pixels those cells can show, so a terminal's storage holds many.
  const tall = tinyPng(400, 6000), tallB64 = tall.toString("base64")
  let tallFed = ""
  new KittyFeed({ emit: (d) => { tallFed += d }, remote: () => false }).feed(`\x1b_Ga=T,U=1,q=2,f=100,i=11,c=4,r=16;${tallB64}\x1b\\`)
  const tallVt = newVt({ cols: 40, rows: 10, scrollback: 100 })
  tallVt.write(tallFed)
  const kept = tallVt.picture(11)
  check("a big picture shown in a few cells is kept smaller, its shape kept", !!kept && kept.width === 57 && kept.height === 857 && keptScale(new Map([["a", "T"], ["U", "1"], ["c", "4"], ["r", "16"]]), 400, 6000) === 7,
    [kept?.width, kept?.height])
  check("… not one placed otherwise (transmitted alone, or a part of it shown)", keptScale(new Map([["a", "t"], ["c", "4"], ["r", "16"]]), 400, 6000) === 1
    && keptScale(new Map([["a", "T"], ["U", "1"], ["c", "4"], ["r", "16"], ["h", "100"]]), 400, 6000) === 1)
  tallVt.dispose()
  // Unicode placeholders (U+10EEEE, row and column diacritics, the image id as the colour) draw the virtual placement.
  const s = new Screen(wasmModule, { cols: 40, rows: 10, scrollback: 100 })
  const D = ["̅", "̍", "̎", "̐", "̒", "̽"]
  const place = `\x1b[38;5;9m${[0, 1].map((r) => [0, 1, 2, 3, 4, 5].map((c) => `\u{10EEEE}${D[r]}${D[c]}`).join("")).join("\r\n")}\x1b[39m`
  s.write(fed + place)
  check("… stored, pixels as decoded", Buffer.from(s.picture(9)?.data ?? []).equals(px.data), s.picture(9))
  s.update()
  const drawn = s.drawn()
  check("placeholders lay the picture out for drawing (a run a row, below the text)", drawn.length === 2 && drawn.every((d) => d.image === 9 && d.layer === 1) && drawn[0].row === 0 && drawn[1].row === 1, drawn)
  const gen = s.picturesLaidOut()
  s.update()
  check("… its layout's generation unchanged while nothing changes", s.picturesLaidOut() === gen)
  s.write("\r\n".repeat(12))
  s.update()
  check("… moved up with the text, out of view once scrolled off", s.picturesLaidOut() !== gen && s.drawn().length === 0, s.drawn())

  // A page attaching: its pictures sent before its screen, put back where they were.
  const s2 = new Screen(wasmModule, { cols: 40, rows: 10, scrollback: 100 })
  s2.write(fed + place)
  for (const [name, t] of [["one at a cell", v], ["a virtual one", s2]] as const) {
    const fresh = new Screen(wasmModule, { cols: 40, rows: 10, scrollback: 100 })
    fresh.write(withPictures(t))
    const want = t.placements().map((p) => [p.image, p.x, p.y, p.virtual]), got = fresh.placements().map((p) => [p.image, p.x, p.y, p.virtual])
    const id = t.placements()[0].image
    check(`a page attaching gets its pictures: ${name}, its pixels and where it is`, JSON.stringify(got) === JSON.stringify(want) && Buffer.from(fresh.picture(id)!.data).equals(Buffer.from(t.picture(id)!.data))
      && fresh.text(null) === t.text(null), [want, got, fresh.text(null), t.text(null)])
    fresh.dispose()
  }
  s2.dispose()
  // History: a picture placed, then scrolled into history, comes back on its line.
  const h = newVt({ cols: 30, rows: 5, scrollback: 100 })
  h.write(`top\r\n\x1b_Ga=T,i=3,f=32,s=4,v=3,c=2,r=1,q=2;${rgba.toString("base64")}\x1b\\x\r\n${"line\r\n".repeat(8)}end`)
  const fresh = newVt({ cols: 30, rows: 5, scrollback: 100 })
  fresh.write(withPictures(h))
  check("… one in history too, on its line", JSON.stringify(fresh.placements().map((p) => [p.x, p.y])) === JSON.stringify(h.placements().map((p) => [p.x, p.y])) && fresh.text(null) === h.text(null) && JSON.stringify(fresh.cursor) === JSON.stringify(h.cursor),
    [h.placements(), fresh.placements(), fresh.text(null)])
  fresh.dispose(); h.dispose()
  // (a big one goes smaller, within the budget, over the same cells)
  const big = newVt({ cols: 80, rows: 24, scrollback: 100 }), W = 2000, H = 1500, noise = crypto.randomBytes(W * H * 3)
  big.write(`\x1b_Ga=T,i=4,f=24,s=${W},v=${H},c=20,r=10,q=2;${noise.toString("base64")}\x1b\\`)
  const sent = withPictures(big), back = newVt({ cols: 80, rows: 24, scrollback: 100 })
  back.write(sent)
  const p4 = back.picture(4)
  check("a big picture is sent smaller to a page attaching, over the same cells", sent.length < REPLAY_MAX && !!p4 && p4.width * p4.height <= (1 << 20) && back.placements()[0]?.gridColumns === 20 && back.placements()[0]?.gridRows === 10,
    [sent.length, p4?.width, p4?.height, back.placements()])
  back.dispose(); big.dispose()

  // Storage: a terminal keeps KITTY_STORAGE bytes of pictures, the oldest going first.
  const st = newVt({ cols: 80, rows: 24, scrollback: 100 }), side = 1024, one = Buffer.alloc(side * side * 4, 200).toString("base64")
  const n = Math.ceil(KITTY_STORAGE / (side * side * 4)) + 2
  for (let i = 1; i <= n; i++) st.write(`\x1b_Ga=t,i=${i},f=32,s=${side},v=${side},q=2;${one}\x1b\\`)
  check("its pictures stay within the storage limit, the oldest dropped", !st.picture(1) && !!st.picture(n), [!!st.picture(1), !!st.picture(n)])
  st.dispose(); v.dispose(); s.dispose()

  // termd's feed: everything but what it rewrites goes on as it came, however the output is cut.
  const plain = "a \x1b[31mred\x1b[0m \x1b_Ga=T,f=32,s=1,v=1;AAAA/w==\x1b\\ b \x1b_Gi=1,a=q,f=24,s=1,v=1;AAAA\x1b\\c\x1b]0;t\x1b\\_G"
  let same = true
  for (let k = 1; k < 12 && same; k++) {
    let out = ""
    const f = new KittyFeed({ emit: (d) => { out += d }, remote: () => false })
    for (let i = 0; i < plain.length; i += k) f.feed(plain.slice(i, i + k))
    same = out === plain
  }
  check("termd's feed passes on what it doesn't rewrite, as it came, in any pieces", same)
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "vt-kitty-")), file = path.join(dir, "tty-graphics-protocol-1.png")
  fs.writeFileSync(file, png)
  const viaFile = (name: string, t: string, remote = false) => {
    let out = ""
    new KittyFeed({ emit: (d) => { out += d }, remote: () => remote }).feed(`\x1b_Ga=T,t=${t},f=100,i=2;${Buffer.from(name).toString("base64")}\x1b\\`)
    return out
  }
  check("a picture by file (t=f) is read and sent direct", /t=d;/.test(viaFile(file, "f")))
  check("… not when what runs in front could be remote (ssh)", /t=f,/.test(viaFile(file, "f", true)))
  check("… nor a device or a folder", typeof readPicture("/dev/zero", false) === "string" && typeof readPicture(dir, false) === "string")
  fs.writeFileSync(path.join(dir, "elsewhere.png"), png)
  fs.symlinkSync(path.join(dir, "elsewhere.png"), path.join(dir, "tty-graphics-protocol-link.png"))
  check("a temporary file (t=t) must be one, by its name, no link", typeof readPicture(path.join(dir, "tty-graphics-protocol-link.png"), true) === "string" && typeof readPicture(path.join(dir, "elsewhere.png"), true) === "string")
  check("… read, then removed", /t=d;/.test(viaFile(file, "t")) && !fs.existsSync(file))
  fs.rmSync(dir, { recursive: true, force: true })
})

/** A W×H RGB PNG of four colours (8×6). */
function tinyPng(W = 8, H = 6) {
  const raw = Buffer.alloc((W * 3 + 1) * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) raw.set([[230, 40, 40], [40, 180, 60], [40, 80, 230], [240, 200, 30]][(x < W / 2 ? 0 : 1) + (y < H / 2 ? 0 : 2)], y * (W * 3 + 1) + 1 + x * 3)
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
  const crc = (b: Buffer) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4), c = Buffer.alloc(4), td = Buffer.concat([Buffer.from(t), d]); l.writeUInt32BE(d.length); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}

summary("vt", t0)
