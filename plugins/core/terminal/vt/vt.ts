// A terminal's screen and history, kept by libghostty-vt (Ghostty's terminal as WebAssembly, ghostty-vt.wasm: its
// version in PROVENANCE.md). No Node here: the server loads the module (load.ts), a page can too.

type Exports = Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory; __indirect_function_table: WebAssembly.Table }
type TypeInfo = { kind: string; values?: Record<string, number> }

/** What a terminal answers its program (xterm.js's own answers, which the app's pages give too): DA1 VT100 with
 *  advanced video, DA2 xterm.js' version. */
const DA1 = { level: 1, features: [2] }, DA2 = { type: 0, firmware: 276, rom: 0 }
/** Answers as the app's terminals have always given them (the server and the pages say the same): no kitty keyboard,
 *  XTVERSION or color queries; no page in DECXCPR. */
function asXterm(reply: string) {
  if (/^\x1b\[\?\d*u$/.test(reply) || reply.startsWith("\x1bP>|") || /^\x1b\](?:4;\d+|1[0-9]);/.test(reply)) return ""
  return reply.replace(/^(\x1b\[\?\d+;\d+);\d+R$/, "$1R")
}

const enc = new TextEncoder(), dec = new TextDecoder()
/** About the rows a page of history holds at most: kept beyond a scrollback, as history goes by the page. */
const PAGE_ROWS = 1024
/** Pieces of output written at most this long (UTF-16 units), so the buffer it's copied into stays small. */
const SLICE = 1 << 16

/** The module's types, by C name (ghostty_type_json: enums' values), read once per module. */
const typesOf = new WeakMap<WebAssembly.Module, Record<string, TypeInfo>>()

/** A tiny module re-exporting JS functions as WebAssembly ones, so they fit a function table: each signature is
 *  [i32 params, returns an i32]. */
function trampolines(sigs: [number, boolean][], fns: ((...a: number[]) => number | void)[]) {
  const leb = (n: number) => { const o: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b) } while (n); return o }
  const name = (s: string) => [s.length, ...[...s].map((c) => c.charCodeAt(0))]
  const section = (id: number, body: number[]) => [id, ...leb(body.length), ...body]
  const types = [sigs.length, ...sigs.flatMap(([n, r]) => [0x60, n, ...Array(n).fill(0x7f), ...(r ? [1, 0x7f] : [0])])]
  const imports = [sigs.length, ...sigs.flatMap((_, i) => [...name("e"), ...name(String(i)), 0, i])]
  const exports = [sigs.length, ...sigs.flatMap((_, i) => [...name(String(i)), 0, i])]
  const bytes = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...section(1, types), ...section(2, imports), ...section(7, exports)])
  const e = Object.fromEntries(fns.map((f, i) => [String(i), f]))
  return new WebAssembly.Instance(new WebAssembly.Module(bytes), { e }).exports as Record<string, WebAssembly.ExportValue>
}

export type VtOptions = {
  cols: number; rows: number
  /** Lines of history kept (about: whole pages go). */
  scrollback: number
  /** Its answers to the program's questions (DA, cursor position...). */
  onReply?: (data: string) => void
  onTitle?: (title: string) => void
}

export type InputLine = { line: string; typed: string; suggested: string }

/** Where vt.ts reads and writes C structs and packed values (tools/test_vt.ts checks them against the module's own
 *  layouts): "Type.field[.field]" to its byte offset, a packed one's to its first bit. */
export const LAYOUT: Record<string, number> = {
  "GhosttyDeviceAttributes.primary.features": 2, "GhosttyDeviceAttributes.primary.num_features": 132,
  "GhosttyDeviceAttributes.secondary.device_type": 136, "GhosttyDeviceAttributes.secondary.firmware_version": 138,
  "GhosttyDeviceAttributes.secondary.rom_cartridge": 140, "GhosttyDeviceAttributes.tertiary.unit_id": 144,
  "GhosttyPoint.value.coordinate.x": 8, "GhosttyPoint.value.coordinate.y": 12, "GhosttyGridRef.x": 4,
  "GhosttySelection.end": 8, "GhosttySelection.rectangle": 16, "GhosttyString.len": 4, "GhosttyTerminalModeConfig.value": 2,
  "GhosttyStyle.fg_color": 0, "GhosttyStyle.flags": 12, "GhosttyStyleColor.value": 1,
  "GhosttyCell.content": 2, "GhosttyCell.style_id": 26, "GhosttyCell.wide": 42, "GhosttyStyleFlags.faint": 2,
}

/** One terminal, in a WebAssembly instance of its own: memory a terminal grew goes back when it ends. */
export class Vt {
  protected x: Exports
  protected types: Record<string, TypeInfo>
  protected h = 0
  private fmt = 0
  protected o: VtOptions
  /** Scratch for out-parameters (64 bytes), and the input buffer output is copied into. */
  protected scratch = 0
  private inPtr = 0
  private inLen = 0
  private replies: string[] = []
  private titled = false
  private writing = false
  private copied = false
  title = ""
  scrollback: number

  constructor(module: WebAssembly.Module, o: VtOptions) {
    this.o = o
    this.scrollback = o.scrollback
    const inst = new WebAssembly.Instance(module, {})
    this.x = inst.exports as unknown as Exports
    if (!typesOf.has(module)) typesOf.set(module, JSON.parse(this.cstr(this.x.ghostty_type_json())).types)
    this.types = typesOf.get(module)!
    this.scratch = this.x.ghostty_wasm_alloc(64)
    this.h = this.make((slot) => this.x.ghostty_terminal_new(0, slot, o.cols, o.rows))
    this.set("SCROLLBACK_MAX_BYTES", this.size(0xffffffff))
    // (history goes by the page: at least as many lines kept)
    this.set("SCROLLBACK_MAX_LINES", this.size(o.scrollback > 0 ? o.scrollback + PAGE_ROWS : 0))
    // (graphemes as one character, emoji sequences two columns: the server and the pages count widths alike)
    this.setMode(2027, true)
    this.callbacks()
    this.fmt = this.make((slot) => this.x.ghostty_formatter_terminal_new(0, slot, this.h))
  }

  // ---------- the C ABI

  protected e(type: string, name: string) {
    const v = this.types[type]?.values?.[name]
    if (v === undefined) throw new Error(`libghostty-vt has no ${type} ${name}`)
    return v
  }
  protected get u8() { return new Uint8Array(this.x.memory.buffer) }
  protected get dv() { return new DataView(this.x.memory.buffer) }
  protected cstr(p: number) { const b = this.u8; let n = p; while (b[n]) n++; return dec.decode(b.subarray(p, n)) }
  protected check(r: number, what: string) { if (r !== 0) throw new Error(`libghostty-vt: ${what} failed (${r})`); return r }
  /** A handle a constructor puts in an out-slot. */
  protected make(fn: (slot: number) => number) {
    const slot = this.x.ghostty_wasm_alloc_opaque()
    try { this.check(fn(slot), "new"); return this.x.ghostty_wasm_take_opaque(slot) } finally { this.x.ghostty_wasm_free_opaque(slot) }
  }
  /** A size_t at the scratch, its pointer. */
  protected size(v: number) { this.dv.setUint32(this.scratch, v >>> 0, true); return this.scratch }
  protected set(opt: string, ptr: number) { this.check(this.x.ghostty_terminal_set(this.h, this.e("GhosttyTerminalOption", opt), ptr), `set ${opt}`) }
  /** The formatter's options as last set. */
  private fopts: Record<string, number> = {}
  private fset(opt: string, v: number) {
    if (this.fopts[opt] === v) return
    this.fopts[opt] = v
    this.dv.setUint32(this.scratch, v >>> 0, true)
    this.check(this.x.ghostty_formatter_set(this.fmt, this.e("GhosttyFormatterOption", opt), this.scratch), `format ${opt}`)
  }
  protected get(data: string, read: (dv: DataView, p: number) => number) {
    this.check(this.x.ghostty_terminal_get(this.h, this.e("GhosttyTerminalData", data), this.scratch), `get ${data}`)
    return read(this.dv, this.scratch)
  }
  protected u16(data: string) { return this.get(data, (d, p) => d.getUint16(p, true)) }
  protected u32(data: string) { return this.get(data, (d, p) => d.getUint32(p, true)) }

  /** More callbacks a subclass sets (the page's clipboard): an option, its signature and function. */
  protected more(): { opt: string; sig: [number, boolean]; fn: (...a: number[]) => number | void }[] { return [] }
  private callbacks() {
    const table = this.x.__indirect_function_table, more = this.more()
    const t = trampolines([[4, false], [3, true], [2, false], ...more.map((m) => m.sig)], [
      (_t, _u, ptr, len) => { const r = asXterm(dec.decode(this.u8.subarray(ptr, ptr + len))); if (r) this.replies.push(r) },
      (_t, _u, out) => {
        const d = this.dv
        d.setUint16(out, DA1.level, true)
        DA1.features.forEach((f, i) => d.setUint16(out + 2 + i * 2, f, true))
        d.setUint32(out + 132, DA1.features.length, true)
        d.setUint16(out + 136, DA2.type, true); d.setUint16(out + 138, DA2.firmware, true); d.setUint16(out + 140, DA2.rom, true)
        d.setUint32(out + 144, 0, true)
        return 1
      },
      () => { this.titled = true },
      ...more.map((m) => m.fn),
    ])
    const at = table.grow(3 + more.length)
    for (let i = 0; i < 3 + more.length; i++) table.set(at + i, t[String(i)] as never)
    this.set("WRITE_PTY", at)
    this.set("DEVICE_ATTRIBUTES", at + 1)
    this.set("TITLE_CHANGED", at + 2)
    more.forEach((m, i) => this.set(m.opt, at + 3 + i))
  }

  // ---------- the terminal

  /** Output, parsed now (its answers go out after). */
  write(data: string | Uint8Array) {
    if (this.writing) throw new Error("libghostty-vt: write during a write")
    this.writing = true
    try {
      if (typeof data === "string") for (let i = 0; i < data.length;) {
        let end = Math.min(data.length, i + SLICE)
        if (end < data.length && (data.charCodeAt(end - 1) & 0xfc00) === 0xd800) end-- // (a pair kept whole)
        const piece = data.slice(i, end)
        this.room(piece.length * 3)
        const { written } = enc.encodeInto(piece, this.u8.subarray(this.inPtr, this.inPtr + this.inLen))
        this.x.ghostty_terminal_vt_write(this.h, this.inPtr, written)
        i = end
      }
      else for (let i = 0; i < data.length; i += SLICE * 3) {
        const piece = data.subarray(i, i + SLICE * 3)
        this.room(piece.length)
        this.u8.set(piece, this.inPtr)
        this.x.ghostty_terminal_vt_write(this.h, this.inPtr, piece.length)
      }
    } finally { this.writing = false }
    if (this.titled) {
      this.titled = false
      const [ptr, len] = [this.u32("TITLE"), this.dv.getUint32(this.scratch + 4, true)]
      this.title = ptr ? dec.decode(this.u8.subarray(ptr, ptr + len)) : ""
      this.o.onTitle?.(this.title)
    }
    if (this.replies.length) { const r = this.replies.join(""); this.replies = []; this.o.onReply?.(r) }
  }
  private room(n: number) {
    if (n <= this.inLen) return
    if (this.inPtr) this.x.ghostty_wasm_free(this.inPtr, this.inLen)
    this.inLen = Math.max(n, 4096)
    this.inPtr = this.x.ghostty_wasm_alloc(this.inLen)
    if (!this.inPtr) throw new Error("libghostty-vt: out of memory")
  }

  /** A new size; `cellWidth` and `cellHeight` (px) are what pixel mouse reports and size queries tell. */
  resize(cols: number, rows: number, cellWidth = 8, cellHeight = 16) {
    if (cols === this.cols && rows === this.rows) return
    this.check(this.x.ghostty_terminal_resize(this.h, cols, rows, cellWidth, cellHeight), "resize")
    if (this.replies.length) { const r = this.replies.join(""); this.replies = []; this.o.onReply?.(r) }
  }
  reset() { this.x.ghostty_terminal_reset(this.h) }

  get cols() { return this.u16("COLS") }
  get rows() { return this.u16("ROWS") }
  /** Where the cursor is on its screen; past the last column with a wrap pending (as xterm.js tells it). */
  get cursor() { return { x: this.u16("CURSOR_X") + (this.get("CURSOR_PENDING_WRAP", (d, p) => d.getUint8(p)) ? 1 : 0), y: this.u16("CURSOR_Y") } }
  get alternate() { return this.u32("ACTIVE_SCREEN") === this.e("GhosttyTerminalScreen", "ALTERNATE") }
  /** Rows in its history and screen. */
  get length() { return this.u32("TOTAL_ROWS") }
  /** A DEC private mode (`ansi`: an ANSI one) is set. */
  mode(n: number, ansi = false) {
    this.dv.setUint16(this.scratch, (n & 0x7fff) | (ansi ? 0x8000 : 0), true)
    this.dv.setUint8(this.scratch + 2, 0)
    this.check(this.x.ghostty_terminal_get(this.h, this.e("GhosttyTerminalData", "MODE"), this.scratch), "mode")
    return this.dv.getUint8(this.scratch + 2) !== 0
  }
  protected setMode(n: number, on: boolean) {
    this.dv.setUint16(this.scratch, n & 0x7fff, true)
    this.dv.setUint8(this.scratch + 2, on ? 1 : 0)
    this.set("MODE_DEFAULT", this.scratch)
    this.dv.setUint16(this.scratch, n & 0x7fff, true)
    this.dv.setUint8(this.scratch + 2, on ? 1 : 0)
    this.set("MODE", this.scratch)
  }

  // ---------- what it shows

  /** Its screen and history from row `from` (of its screen and history) down, as text, VT or HTML. */
  protected format(emit: "PLAIN" | "VT" | "HTML", from: number, o: { unwrap: boolean; trim: boolean; extras?: number }) {
    this.fset("EMIT", this.e("GhosttyFormatterFormat", emit))
    this.fset("UNWRAP", o.unwrap ? 1 : 0)
    this.fset("TRIM", o.trim ? 1 : 0)
    this.fset("EXTRAS", o.extras ?? 0)
    const opt = this.e("GhosttyFormatterOption", "SELECTION")
    // A selection from the first row asked to the end (else the whole screen), set just before it's used.
    const sel = from > 0 ? this.selection(from) : 0
    try {
      this.check(this.x.ghostty_formatter_set(this.fmt, opt, sel), "select")
      const pp = this.scratch + 32, lp = this.scratch + 40
      this.check(this.x.ghostty_formatter_format_alloc(this.fmt, 0, pp, lp), "format")
      const ptr = this.dv.getUint32(pp, true), len = this.dv.getUint32(lp, true)
      const out = dec.decode(this.u8.subarray(ptr, ptr + len))
      this.x.ghostty_free(0, ptr, len)
      return out
    } finally {
      if (sel) { this.x.ghostty_formatter_set(this.fmt, opt, 0); this.x.ghostty_wasm_free(sel, 64) }
    }
  }
  /** A GhosttySelection from (0, from) of its screen and history to its last cell. */
  private selection(from: number) {
    const p = this.x.ghostty_wasm_alloc(64), d = this.dv
    const ref = (x: number, y: number, out: number) => {
      d.setInt32(p + 32, this.e("GhosttyPointTag", "SCREEN"), true)
      d.setUint16(p + 40, x, true); d.setUint32(p + 44, y, true)
      this.check(this.x.ghostty_terminal_grid_ref(this.h, p + 32, out), "grid ref")
    }
    ref(0, from, p)
    ref(this.cols - 1, this.length - 1, p + 8)
    this.dv.setUint8(p + 16, 0)
    return p
  }

  /** Its text, a wrapped line joined to the one before, trailing blank lines left out: its last `lines` lines
   *  (null: all). */
  text(lines: number | null) {
    const from = lines === null ? 0 : Math.max(0, this.length - Math.max(lines, this.rows) * 2)
    const out = this.format("PLAIN", from, { unwrap: true, trim: true }).split("\n")
    while (out.length && !out[out.length - 1].trim()) out.pop()
    return (lines === null ? out : out.slice(-lines)).join("\n")
  }
  /** Sequences that draw it again elsewhere: its screen, `above` lines of history, modes and cursor, not its palette
   *  (the page has its own colors). With the alternate screen up, the primary one first, read from a copy. */
  serialize(above = this.scrollback) {
    const from = Math.max(0, this.length - this.rows - above)
    const extras = 0xfff & ~(PALETTE | PWD | TABSTOPS | KITTY_KEYBOARD)
    // (not the cursor's blinking, mode 12: the page's setting has it)
    const vt = this.format("VT", from, { unwrap: true, trim: true, extras }).replace(/\x1b\[\?12[hl]/g, "")
    if (!this.alternate) return vt
    const copy = this.copy()
    try {
      copy.write("\x1b[?1049l")
      const primary = copy.format("VT", Math.max(0, copy.length - copy.rows - above), { unwrap: true, trim: true, extras: extras & ~MODES })
      // (its text is drawn from the top-left: once the alternate screen is up)
      const alt = vt.replace(/\x1b\[\?(?:1049|1047|47)h/, "$&\x1b[H")
      return primary + (alt === vt ? `\x1b[?1049h\x1b[H${vt}` : alt)
    } finally { copy.dispose() }
  }
  html(above = this.scrollback) {
    // (its palette as CSS variables, which its colors name)
    return this.format("HTML", Math.max(0, this.length - this.rows - above), { unwrap: false, trim: true, extras: PALETTE })
  }
  /** A copy of it (its snapshot restored in another terminal of the same instance). */
  private copy(): Vt {
    const pp = this.scratch + 32, lp = this.scratch + 40
    this.check(this.x.ghostty_snapshot_encode_alloc(this.h, 0, pp, lp), "snapshot")
    const ptr = this.dv.getUint32(pp, true), len = this.dv.getUint32(lp, true)
    const dec_ = this.make((slot) => this.x.ghostty_snapshot_decoder_new_buf(0, slot, ptr, len))
    try {
      const h = this.make((slot) => this.x.ghostty_snapshot_decoder_decode(dec_, slot))
      const c = Object.create(Vt.prototype) as Vt
      Object.assign(c, { x: this.x, types: this.types, o: {}, fopts: {}, copied: true, scrollback: this.scrollback, scratch: this.x.ghostty_wasm_alloc(64), inPtr: 0, inLen: 0, replies: [], titled: false, writing: false, title: "", h })
      c.fmt = c.make((slot) => this.x.ghostty_formatter_terminal_new(0, slot, h))
      return c
    } finally { this.x.ghostty_snapshot_decoder_free(dec_); this.x.ghostty_free(0, ptr, len) }
  }

  /** The cursor's line: all of it, what's drawn plainly, and what's faint (dim, or a suggestion's grey). */
  inputLine(): InputLine {
    const p = this.x.ghostty_wasm_alloc(96)
    let typed = "", suggested = "", line = ""
    try {
      let d = this.dv
      d.setInt32(p, this.e("GhosttyPointTag", "ACTIVE"), true)
      d.setUint16(p + 8, 0, true); d.setUint32(p + 12, this.cursor.y, true)
      if (this.x.ghostty_terminal_grid_ref(this.h, p, p + 24) !== 0) return { line: "", typed: "", suggested: "" }
      // (a GhosttyGridRef is its page, x and y: the row's other cells are the same ref with another x)
      for (let x = 0, cols = this.cols; x < cols; x++) {
        d.setUint16(p + 28, x, true)
        if (this.x.ghostty_grid_ref_cell(p + 24, p + 32) !== 0) continue
        // GhosttyCell, packed: content tag (bits 0-1), codepoint (2-22), style id (26-41), wide (42-43)
        const lo = d.getUint32(p + 32, true), hi = d.getUint32(p + 36, true), tag = lo & 3, wide = (hi >>> 10) & 3
        if (wide === 2 || wide === 3) continue // (the second half of a wide one)
        let ch = tag <= 1 && (lo >>> 2) & 0x1fffff ? String.fromCodePoint((lo >>> 2) & 0x1fffff) : " "
        if (tag === 1) {
          this.x.ghostty_grid_ref_graphemes(p + 24, p + 48, 8, p + 40)
          d = this.dv
          ch = ""
          for (let i = 0, n = Math.min(8, d.getUint32(p + 40, true)); i < n; i++) ch += String.fromCodePoint(d.getUint32(p + 48 + i * 4, true))
        }
        let dim = false
        if (((lo >>> 26) | (hi << 6)) & 0xffff) { this.x.ghostty_grid_ref_style(p + 24, p + 80); d = this.dv; dim = faint(d, p + 80) }
        if (dim) suggested += ch; else typed += ch
        line += ch
      }
    } finally { this.x.ghostty_wasm_free(p, 96) }
    return { line: line.trimEnd(), typed: typed.trimEnd(), suggested: suggested.trim() }
  }

  /** Bytes its instance holds (WebAssembly memory only grows). */
  get memory() { return this.x.memory.buffer.byteLength }

  /** Its terminal freed (the instance goes with the last reference to it; a copy shares its original's). */
  dispose() {
    if (!this.h) return
    this.x.ghostty_formatter_free(this.fmt)
    this.x.ghostty_terminal_free(this.h)
    if (this.copied) { this.x.ghostty_wasm_free(this.scratch, 64); if (this.inPtr) this.x.ghostty_wasm_free(this.inPtr, this.inLen) }
    this.h = 0; this.fmt = 0
  }
}

const PALETTE = 1 << 0, MODES = 1 << 1, TABSTOPS = 1 << 3, PWD = 1 << 4, KITTY_KEYBOARD = 1 << 10

/** A cell drawn faint: dim, or a grey a program draws a suggestion in (Claude Code's suggested reply). The style is
 *  GhosttyStyle: its foreground's tag and value first, its flags (faint: bit 2) at 12. */
function faint(d: DataView, p: number) {
  if (d.getUint16(p + 12, true) & 4) return true
  const tag = d.getUint8(p)
  if (tag === 1) { const v = d.getUint8(p + 1); return v === 8 || (v >= 237 && v <= 249) }
  if (tag !== 2) return false
  const r = d.getUint8(p + 1), g = d.getUint8(p + 2), b = d.getUint8(p + 3)
  return Math.max(r, g, b) - Math.min(r, g, b) < 16 && r >= 80 && r <= 170
}
