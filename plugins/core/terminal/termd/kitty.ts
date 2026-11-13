import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import type { Picture, Placement, Vt } from "../vt/vt.ts"
import { CELL_PX } from "../claude-pictures/decode/cells.ts"
import { decodePng, isPng } from "./png.ts"

export const PICTURE_MAX = 64 << 20
/** The protocol asks for a multiple of 4. */
const CHUNK = 1 << 16
const REMOTE = /^(ssh|mosh-client|et|telnet|docker|podman|kubectl)$/

type Keys = Map<string, string>
const parseKeys = (s: string): Keys => new Map(s.split(",").filter(Boolean).map((kv): [string, string] => { const i = kv.indexOf("="); return [kv.slice(0, i), kv.slice(i + 1)] }))
const keysText = (k: Keys) => [...k].map(([a, b]) => `${a}=${b}`).join(",")
const apc = (keys: string, payload = "") => `\x1b_G${keys}${payload ? `;${payload}` : ""}\x1b\\`

const TEMP_DIRS = [...new Set([os.tmpdir(), "/tmp", "/var/tmp"].flatMap((d) => { try { return [fs.realpathSync(d)] } catch { return [] } }))]
const under = (p: string, dirs: string[]) => dirs.some((d) => p === d || p.startsWith(d + path.sep))

/** As kitty has it: regular files only, never a device's or a FIFO's; a temporary one (t=t, removed once read) only in
 *  a temp folder, by its own name, no link out of it. */
export function readPicture(name: string, temp: boolean, offset = 0, size = 0): Buffer | string {
  if (!path.isAbsolute(name)) return "not an absolute path"
  let real: string, st: fs.Stats
  try { real = fs.realpathSync(name); st = fs.statSync(real) } catch (e) { return (e as NodeJS.ErrnoException).code ?? "unreadable" }
  if (!st.isFile()) return "not a regular file"
  if (under(real, ["/dev", "/proc", "/sys"])) return "a system file"
  if (temp) {
    if (!name.includes("tty-graphics-protocol")) return "not named as a temporary picture"
    if (fs.lstatSync(name).isSymbolicLink() || !under(real, TEMP_DIRS)) return "not in a temporary folder"
  }
  const len = size > 0 ? Math.min(size, st.size - offset) : st.size - offset
  if (len <= 0) return "empty"
  if (len > PICTURE_MAX) return "too big"
  const buf = Buffer.alloc(len)
  const fd = fs.openSync(real, "r")
  try { fs.readSync(fd, buf, 0, len, offset) } finally { fs.closeSync(fd) }
  if (temp) try { fs.unlinkSync(real) } catch { /* someone else's to remove */ }
  return buf
}

export type KittyOptions = {
  emit: (d: string) => void
  remote: () => boolean
  log?: (...a: unknown[]) => void
}

export class KittyFeed {
  private o: KittyOptions
  private cmd: string | null = null
  private passing = false
  private tail = ""
  private chunks: { keys: Keys; heads: string[]; payload: string[]; size: number } | null = null
  private chunksPass = false

  constructor(o: KittyOptions) { this.o = o }

  feed(d: string) {
    if (this.tail) { d = this.tail + d; this.tail = "" }
    if (this.cmd === null && !d.includes("\x1b_G")) {
      const t = d.endsWith("\x1b") ? 1 : d.endsWith("\x1b_") ? 2 : 0
      if (t) { this.tail = d.slice(-t); d = d.slice(0, -t) }
      if (d) this.o.emit(d)
      return
    }
    let out = "", i = 0
    while (i < d.length) {
      if (this.cmd === null) {
        const at = d.indexOf("\x1b_G", i)
        if (at < 0) {
          let end = d.length
          if (d.endsWith("\x1b")) end--; else if (d.endsWith("\x1b_")) end -= 2
          out += d.slice(i, end); this.tail = d.slice(end)
          break
        }
        out += d.slice(i, at)
        i = at + 3; this.cmd = ""; this.passing = false
        continue
      }
      const st = d.indexOf("\x1b\\", i)
      const body = d.slice(i, st < 0 ? d.length : st)
      if (this.passing) out += body; else this.cmd += body
      if (st < 0) {
        // A pty read can end between the ESC and the backslash of a terminator.
        if (body.endsWith("\x1b")) { if (this.passing) out = out.slice(0, -1); else this.cmd = this.cmd.slice(0, -1); this.tail = "\x1b" }
        if (!this.passing) this.decideEarly()
        if (this.passing && this.cmd) { out += "\x1b_G" + this.cmd; this.cmd = "" }
        break
      }
      i = st + 2
      if (this.passing) out += "\x1b\\"
      else out += this.command(this.cmd)
      this.cmd = null; this.passing = false
    }
    if (out) this.o.emit(out)
  }

  private decideEarly() {
    const semi = this.cmd!.indexOf(";")
    if (semi < 0 && this.cmd!.length < 4096) return
    const keys = parseKeys(this.cmd!.slice(0, semi < 0 ? undefined : semi))
    if (!this.wanted(keys) || this.cmd!.length > PICTURE_MAX * 1.4) this.passing = true
  }

  private wanted(keys: Keys) {
    if (this.chunks || this.chunksPass) return !this.chunksPass && !!this.chunks
    const t = keys.get("t") ?? "d", f = keys.get("f") ?? "32", a = keys.get("a") ?? "t"
    if (!["t", "T", "q", "f"].includes(a)) return false
    return t === "f" || t === "t" || (t === "d" && f === "100")
  }

  private command(body: string) {
    const raw = `\x1b_G${body}\x1b\\`
    const semi = body.indexOf(";"), head = semi < 0 ? body : body.slice(0, semi), keys = parseKeys(head), payload = semi < 0 ? "" : body.slice(semi + 1)
    const more = keys.get("m") === "1"
    if (this.chunks || this.chunksPass) {
      if (this.chunksPass) { if (!more) this.chunksPass = false; return raw }
      const c = this.chunks!
      c.heads.push(head); c.payload.push(payload); c.size += payload.length
      const all = () => c.heads.map((h, i) => apc(h, c.payload[i])).join("")
      if (c.size > PICTURE_MAX * 1.4) { this.chunks = null; this.chunksPass = more; return all() }
      if (more) return ""
      this.chunks = null
      return this.rewrite(c.keys, c.payload.join(""), all())
    }
    if (!this.wanted(keys)) { if (more) this.chunksPass = true; return raw }
    if (more) { this.chunks = { keys, heads: [head], payload: [payload], size: payload.length }; return "" }
    return this.rewrite(keys, payload, raw)
  }

  private rewrite(keys: Keys, payload: string, raw: string) {
    const t = keys.get("t") ?? "d"
    let data: Buffer
    if (t === "d") data = Buffer.from(payload, "base64")
    else {
      if (this.o.remote()) return raw
      const got = readPicture(Buffer.from(payload, "base64").toString("utf8"), t === "t", Number(keys.get("O")) || 0, Number(keys.get("S")) || 0)
      if (typeof got === "string") { this.o.log?.("kitty", t === "t" ? "temporary file" : "file", "not read:", got); return raw }
      data = got
    }
    const out = new Map(keys)
    for (const k of ["t", "S", "O", "m"]) out.delete(k)
    if ((keys.get("f") ?? "32") === "100") {
      if (keys.get("o") === "z") try { data = zlib.inflateSync(data, { maxOutputLength: PICTURE_MAX }) } catch { return raw }
      let px = decodePng(data, PICTURE_MAX)
      if (!px) { this.o.log?.("kitty", isPng(data) ? "PNG not decoded" : "not a PNG"); return raw }
      const k = keptScale(keys, px.width, px.height)
      if (k > 1) px = { ...shrink(px.data, px.width, px.height, px.channels, px.channels, k), channels: px.channels }
      out.set("f", String(px.channels * 8)); out.set("s", String(px.width)); out.set("v", String(px.height)); out.set("o", "z")
      data = zlib.deflateSync(px.data, { level: 1 })
    } else if (t === "d") return raw
    out.set("t", "d")
    return chunked(out, data.toString("base64"))
  }
}

/** The protocol takes keys on the first chunk only, and `q` on each, else each chunk is answered. */
function chunked(keys: Keys, b64: string) {
  if (b64.length <= CHUNK) return apc(keysText(keys), b64)
  const q = keys.get("q"), rest = q ? `,q=${q}` : ""
  let s = apc(`${keysText(keys)},m=1`, b64.slice(0, CHUNK))
  for (let i = CHUNK; i < b64.length; i += CHUNK) s += apc(`m=${i + CHUNK >= b64.length ? 0 : 1}${rest}`, b64.slice(i, i + CHUNK))
  return s
}

export const remoteFront = (name: string) => REMOTE.test(name)

export const REPLAY_MAX = 8 << 20
const REPLAY_PIXELS = 1 << 20

/** Kitty takes RGB or RGBA only. */
function sendable(p: Picture) {
  const ch = p.format === "rgba" ? 4 : p.format === "rgb" ? 3 : p.format === "gray_alpha" ? 2 : 1, out = ch === 2 || ch === 4 ? 4 : 3
  const k = Math.max(1, Math.ceil(Math.sqrt((p.width * p.height) / REPLAY_PIXELS)))
  if (k === 1 && ch === out) return { width: p.width, height: p.height, scale: 1, format: out * 8, data: Buffer.from(p.data.buffer, p.data.byteOffset, p.data.length) }
  const s = shrink(p.data, p.width, p.height, ch, out, k)
  return { ...s, scale: s.width / p.width, format: out * 8 }
}

function shrink(src: Uint8Array, width: number, height: number, ch: number, out: number, k: number) {
  const w = Math.max(1, Math.floor(width / k)), h = Math.max(1, Math.floor(height / k))
  const data = Buffer.alloc(w * h * out), sum = new Float64Array(4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    sum.fill(0)
    let n = 0
    for (let yy = y * k; yy < Math.min(height, (y + 1) * k); yy++) for (let xx = x * k; xx < Math.min(width, (x + 1) * k); xx++) {
      const i = (yy * width + xx) * ch
      if (ch <= 2) { sum[0] += src[i]; sum[1] += src[i]; sum[2] += src[i]; sum[3] += ch === 2 ? src[i + 1] : 255 }
      else { sum[0] += src[i]; sum[1] += src[i + 1]; sum[2] += src[i + 2]; sum[3] += ch === 4 ? src[i + 3] : 255 }
      n++
    }
    const o = (y * w + x) * out
    for (let c = 0; c < out; c++) data[o + c] = Math.round(sum[c] / n)
  }
  return { width: w, height: h, data }
}

/** Claude Code shows pictures whole in c × r cells (a=T, U=1). Pixels past what those show only fill Ghostty's image
 *  storage, whose oldest pictures go (their rows left blank). */
export function keptScale(keys: Map<string, string>, width: number, height: number) {
  const cols = Number(keys.get("c")) || 0, rows = Number(keys.get("r")) || 0
  if (keys.get("a") !== "T" || keys.get("U") !== "1" || !cols || !rows || ["x", "y", "w", "h"].some((k) => keys.has(k))) return 1
  return Math.max(1, Math.floor(Math.max(width / (cols * CELL_PX.width), height / (rows * CELL_PX.height))))
}

export function withPictures(t: Vt) {
  const vt = t.serialize(), placements = t.placements()
  if (!placements.length) return vt
  const pics = [...new Set(placements.map((p) => p.image))].map((id) => t.picture(id)).filter((p): p is Picture => !!p).sort((a, b) => (a.generation < b.generation ? 1 : -1))
  let sent = 0, head = ""
  const scale = new Map<number, number>()
  for (const p of pics) {
    const s = sendable(p), b64 = zlib.deflateSync(s.data, { level: 6 }).toString("base64")
    if (sent + b64.length > REPLAY_MAX) continue
    sent += b64.length
    scale.set(p.id, s.scale)
    head += chunked(new Map([["a", "t"], ["i", String(p.id)], ["f", String(s.format)], ["s", String(s.width)], ["v", String(s.height)], ["o", "z"], ["q", "2"]]), b64)
  }
  const put = (p: Placement, virtual: boolean) => {
    const k = scale.get(p.image)!, keys = new Map([["a", "p"], ["i", String(p.image)]])
    if (p.id) keys.set("p", String(p.id))
    if (virtual) keys.set("U", "1")
    const cols = p.columns || p.gridColumns, rows = p.rows || p.gridRows
    if (cols) keys.set("c", String(cols))
    if (rows) keys.set("r", String(rows))
    if (p.sourceX) keys.set("x", String(Math.floor(p.sourceX * k)))
    if (p.sourceY) keys.set("y", String(Math.floor(p.sourceY * k)))
    if (p.sourceWidth) keys.set("w", String(Math.max(1, Math.round(p.sourceWidth * k))))
    if (p.sourceHeight) keys.set("h", String(Math.max(1, Math.round(p.sourceHeight * k))))
    if (p.xOffset) keys.set("X", String(p.xOffset))
    if (p.yOffset) keys.set("Y", String(p.yOffset))
    if (p.z) keys.set("z", String(p.z))
    keys.set("C", "1"); keys.set("q", "2")
    return apc(keysText(keys))
  }
  const shown = placements.filter((p) => scale.has(p.image))
  head += shown.filter((p) => p.virtual).map((p) => put(p, true)).join("")
  const fixed = shown.filter((p) => !p.virtual && p.y >= 0)
  const active = t.length - t.rows, cur = t.cursor
  const atEnd = (ps: Placement[]) => ps.length ? ps.map((p) => `\x1b[${p.y - active + 1};${p.x + 1}H${put(p, false)}`).join("") + `\x1b[${cur.y + 1};${Math.min(cur.x, t.cols - 1) + 1}H` : ""
  if (t.alternate) {
    const m = /\x1b\[\?(?:1049|1047|47)h/.exec(vt)
    if (!m) return vt
    const at = m.index + m[0].length
    return vt.slice(0, at) + head + vt.slice(at) + atEnd(fixed.filter((p) => p.y >= active))
  }
  const from = Math.max(0, t.length - t.rows - t.scrollback), cont = t.continued(from), lineOf: number[] = [], lastRow: number[] = []
  cont.forEach((c, i) => { const l = i === 0 ? 0 : lineOf[i - 1] + (c ? 0 : 1); lineOf.push(l); lastRow[l] = i })
  const lines = vt.split("\r\n"), end: Placement[] = []
  for (const p of fixed) {
    const i = p.y - from, l = lineOf[i]
    if (i < 0 || l === undefined) continue
    if (l < lines.length - 1) {
      const up = lastRow[l] - i
      lines[l] += `${up ? `\x1b[${up}A` : ""}\x1b[${p.x + 1}G${put(p, false)}${up ? `\x1b[${up}B` : ""}`
    } else if (p.y >= active) end.push(p)
  }
  return head + lines.join("\r\n") + atEnd(end)
}
