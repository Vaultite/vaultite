type Exports = Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory; __indirect_function_table: WebAssembly.Table }
type TypeInfo = { kind: string; values?: Record<string, number> }

/** What a terminal answers its program (xterm.js's own answers, which the app's pages give too): DA1 VT100 with
 *  advanced video, DA2 xterm.js' version. */
const DA1 = { level: 1, features: [2] }, DA2 = { type: 0, firmware: 276, rom: 0 }
/** Answers as xterm.js gave them (the server and the pages say the same): no kitty keyboard, XTVERSION or colors; no
 *  page in DECXCPR. Kitty graphics' (ESC _ G, a=q) are the one it never gave that go: these draw pictures. */
function asXterm(reply: string) {
  if (/^\x1b\[\?\d*u$/.test(reply) || reply.startsWith("\x1bP>|") || /^\x1b\](?:4;\d+|1[0-9]);/.test(reply)) return ""
  return reply.replace(/^(\x1b\[\?\d+;\d+);\d+R$/, "$1R")
}

const enc = new TextEncoder(), dec = new TextDecoder()
/** About the rows a page of history holds at most: kept beyond a scrollback, as history goes by the page. */
const PAGE_ROWS = 1024
const SLICE = 1 << 16

/** Bytes of kitty graphics pictures one terminal keeps, each of its screens (libghostty-vt drops the oldest past it). */
export const KITTY_STORAGE = 64 << 20

/** The WASI functions the module (wasm32-wasi: ghostty_update.ts) imports, stubs: no clock (eviction counts sends,
 *  animations take the caller's time), no files (termd reads pictures: kitty.ts). */
const WASI: Record<string, (mem: () => DataView) => (...a: never[]) => number> = {
  args_sizes_get: (mem) => (count: number, size: number) => { mem().setUint32(count, 0, true); mem().setUint32(size, 0, true); return 0 },
  args_get: () => () => 0,
  fd_write: (mem) => (_fd: number, iovs: number, n: number, written: number) => {
    const m = mem()
    let total = 0
    for (let i = 0; i < n; i++) total += m.getUint32(iovs + i * 8 + 4, true)
    m.setUint32(written, total, true)
    return 0
  },
  proc_exit: () => (code: number) => { throw new Error(`libghostty-vt exited (${code})`) },
}
export function wasiImports(module: WebAssembly.Module, memory: () => WebAssembly.Memory) {
  const out: Record<string, Record<string, WebAssembly.ImportValue>> = {}
  let view: DataView | null = null
  const mem = () => { const m = memory(); if (view?.buffer !== m.buffer) view = new DataView(m.buffer); return view }
  for (const i of WebAssembly.Module.imports(module)) {
    const make = i.module === "wasi_snapshot_preview1" && i.kind === "function" ? WASI[i.name] : undefined
    if (!make) throw new Error(`libghostty-vt imports ${i.module}.${i.name}, which vt.ts doesn't give`)
    ;(out[i.module] ??= {})[i.name] = make(mem) as WebAssembly.ImportValue
  }
  return out
}

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
  onReply?: (data: string) => void
  onTitle?: (title: string) => void
}

export type InputLine = { line: string; typed: string; suggested: string }

/** A kitty graphics picture as stored: decoded pixels, `format`'s channels a pixel. */
export type Picture = { id: number; number: number; width: number; height: number; format: "rgb" | "rgba" | "gray" | "gray_alpha"; generation: bigint; data: Uint8Array }
/** A picture placed: its image, placement id, cell (SCREEN coordinates; y -1 for a virtual one), offsets within it
 *  (px), the part of the picture it shows (0: all), the cells it covers (0: the picture's own size) and z-index. */
export type Placement = { image: number; id: number; virtual: boolean; x: number; y: number; xOffset: number; yOffset: number
  sourceX: number; sourceY: number; sourceWidth: number; sourceHeight: number; columns: number; rows: number; z: number
  /** The cells it covers as the terminal works them out (0 when it can't: a virtual one's are its placeholders). */
  gridColumns: number; gridRows: number }

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
  "GhosttyKittyGraphicsPlacementRenderInfo.grid_cols": 12, "GhosttyKittyGraphicsPlacementRenderInfo.grid_rows": 16,
  "GhosttyPointCoordinate.y": 4,
}

/** One terminal, in a WebAssembly instance of its own: memory a terminal grew goes back when it ends. */
export class Vt {
  protected x: Exports
  protected types: Record<string, TypeInfo>
  protected h = 0
  private fmt = 0
  protected o: VtOptions
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
    const inst = new WebAssembly.Instance(module, wasiImports(module, () => this.x.memory))
    this.x = inst.exports as unknown as Exports
    if (!typesOf.has(module)) typesOf.set(module, JSON.parse(this.cstr(this.x.ghostty_type_json())).types)
    this.types = typesOf.get(module)!
    this.scratch = this.x.ghostty_wasm_alloc(64)
    this.h = this.make((slot) => this.x.ghostty_terminal_new(0, slot, o.cols, o.rows))
    // (a cell's size in pixels: a picture's cells are worked out from it, none without one)
    this.check(this.x.ghostty_terminal_resize(this.h, o.cols, o.rows, 8, 16), "resize")
    this.set("SCROLLBACK_MAX_BYTES", this.size(0xffffffff))
    // (history goes by the page: at least as many lines kept)
    this.set("SCROLLBACK_MAX_LINES", this.size(o.scrollback > 0 ? o.scrollback + PAGE_ROWS : 0))
    // (graphemes as one character, emoji sequences two columns: the server and the pages count widths alike)
    this.setMode(2027, true)
    // Kitty graphics: direct pictures only (file and temporary-file pictures are read by termd and sent direct, as the
    // pages can't read the files of the machine the pty is on: termd/kitty.ts).
    this.dv.setBigUint64(this.scratch, BigInt(KITTY_STORAGE), true)
    this.set("KITTY_IMAGE_STORAGE_LIMIT", this.scratch)
    this.callbacks()
    this.fmt = this.make((slot) => this.x.ghostty_formatter_terminal_new(0, slot, this.h))
  }

  protected e(type: string, name: string) {
    const v = this.types[type]?.values?.[name]
    if (v === undefined) throw new Error(`libghostty-vt has no ${type} ${name}`)
    return v
  }
  protected get u8() { return new Uint8Array(this.x.memory.buffer) }
  protected get dv() { return new DataView(this.x.memory.buffer) }
  protected cstr(p: number) { const b = this.u8; let n = p; while (b[n]) n++; return dec.decode(b.subarray(p, n)) }
  protected check(r: number, what: string) { if (r !== 0) throw new Error(`libghostty-vt: ${what} failed (${r})`); return r }
  protected make(fn: (slot: number) => number) {
    const slot = this.x.ghostty_wasm_alloc_opaque()
    try { this.check(fn(slot), "new"); return this.x.ghostty_wasm_take_opaque(slot) } finally { this.x.ghostty_wasm_free_opaque(slot) }
  }
  protected size(v: number) { this.dv.setUint32(this.scratch, v >>> 0, true); return this.scratch }
  protected set(opt: string, ptr: number) { this.check(this.x.ghostty_terminal_set(this.h, this.e("GhosttyTerminalOption", opt), ptr), `set ${opt}`) }
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

  private cell = "8x16"
  /** A new size; `cellWidth` and `cellHeight` (px) are what pixel mouse reports and size queries tell, and the cells a
   *  picture covers when its program doesn't say. */
  resize(cols: number, rows: number, cellWidth = 8, cellHeight = 16) {
    const cell = `${cellWidth}x${cellHeight}`
    if (cols === this.cols && rows === this.rows && cell === this.cell) return
    this.cell = cell
    this.check(this.x.ghostty_terminal_resize(this.h, cols, rows, cellWidth, cellHeight), "resize")
    if (this.replies.length) { const r = this.replies.join(""); this.replies = []; this.o.onReply?.(r) }
  }
  reset() { this.x.ghostty_terminal_reset(this.h) }

  get cols() { return this.u16("COLS") }
  get rows() { return this.u16("ROWS") }
  /** Where the cursor is on its screen; past the last column with a wrap pending (as xterm.js tells it). */
  get cursor() { return { x: this.u16("CURSOR_X") + (this.get("CURSOR_PENDING_WRAP", (d, p) => d.getUint8(p)) ? 1 : 0), y: this.u16("CURSOR_Y") } }
  get alternate() { return this.u32("ACTIVE_SCREEN") === this.e("GhosttyTerminalScreen", "ALTERNATE") }
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

  protected format(emit: "PLAIN" | "VT" | "HTML", from: number, o: { unwrap: boolean; trim: boolean; extras?: number; selection?: number }) {
    this.fset("EMIT", this.e("GhosttyFormatterFormat", emit))
    this.fset("UNWRAP", o.unwrap ? 1 : 0)
    this.fset("TRIM", o.trim ? 1 : 0)
    this.fset("EXTRAS", o.extras ?? 0)
    const opt = this.e("GhosttyFormatterOption", "SELECTION")
    const sel = o.selection ?? (from > 0 ? this.selection(from) : 0)
    try {
      this.check(this.x.ghostty_formatter_set(this.fmt, opt, sel), "select")
      const pp = this.scratch + 32, lp = this.scratch + 40
      this.check(this.x.ghostty_formatter_format_alloc(this.fmt, 0, pp, lp), "format")
      const ptr = this.dv.getUint32(pp, true), len = this.dv.getUint32(lp, true)
      const out = dec.decode(this.u8.subarray(ptr, ptr + len))
      this.x.ghostty_free(0, ptr, len)
      return out
    } finally {
      if (sel) { this.x.ghostty_formatter_set(this.fmt, opt, 0); if (!o.selection) this.x.ghostty_wasm_free(sel, 64) }
    }
  }
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
    return this.format("HTML", Math.max(0, this.length - this.rows - above), { unwrap: false, trim: true, extras: PALETTE })
  }
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

  continued(from: number) {
    const n = this.length, out: boolean[] = [], p = this.x.ghostty_wasm_alloc(48)
    try {
      for (let y = from; y < n; y++) {
        const d = this.dv
        d.setInt32(p, this.e("GhosttyPointTag", "SCREEN"), true)
        d.setUint16(p + 8, 0, true); d.setUint32(p + 12, y, true)
        out.push(this.x.ghostty_terminal_grid_ref(this.h, p, p + 24) === 0 && this.x.ghostty_grid_ref_row(p + 24, p + 40) === 0 && !!(this.dv.getUint32(p + 40, true) & 2))
      }
    } finally { this.x.ghostty_wasm_free(p, 48) }
    return out
  }

  protected graphics() { return this.x.ghostty_terminal_get(this.h, this.e("GhosttyTerminalData", "KITTY_GRAPHICS"), this.scratch) === 0 ? this.dv.getUint32(this.scratch, true) : 0 }
  get picturesGeneration() {
    const g = this.graphics()
    if (!g || this.x.ghostty_kitty_graphics_get(g, this.e("GhosttyKittyGraphicsData", "GENERATION"), this.scratch) !== 0) return 0n
    return this.dv.getBigUint64(this.scratch, true)
  }
  /** A picture's pixels as stored (decoded: RGB, RGBA, gray or gray and alpha), a copy; null when it's not (yet) there. */
  picture(id: number): Picture | null {
    const g = this.graphics(), img = g ? this.x.ghostty_kitty_graphics_image(g, id) : 0
    if (!img) return null
    const get = (k: string, p: number) => this.x.ghostty_kitty_graphics_image_get(img, this.e("GhosttyKittyGraphicsImageData", k), p) === 0
    const p = this.scratch
    if (!get("WIDTH", p) || !get("HEIGHT", p + 4) || !get("FORMAT", p + 8) || !get("NUMBER", p + 12) || !get("GENERATION", p + 16) || !get("PIXELS", p + 24)) return null
    const d = this.dv, f = d.getInt32(p + 8, true), fmt = this.types.GhosttyKittyImageFormat.values!
    const format = f === fmt.RGBA ? "rgba" : f === fmt.RGB ? "rgb" : f === fmt.GRAY_ALPHA ? "gray_alpha" : "gray"
    const ptr = d.getUint32(p + 24, true), len = d.getUint32(p + 28, true)
    return { id, number: d.getUint32(p + 12, true), width: d.getUint32(p, true), height: d.getUint32(p + 4, true), format, generation: d.getBigUint64(p + 16, true), data: this.u8.slice(ptr, ptr + len) }
  }
  /** Where its pictures are placed on its active screen: each placement, and its top-left cell (SCREEN coordinates:
   *  history then screen) unless it's virtual (shown by placeholder cells, which carry it). */
  placements(): Placement[] {
    const g = this.graphics()
    if (!g) return []
    const x = this.x, it = this.make((slot) => x.ghostty_kitty_graphics_placement_iterator_new(0, slot)), out: Placement[] = []
    try {
      this.dv.setUint32(this.scratch + 32, it, true)
      this.check(x.ghostty_kitty_graphics_get(g, this.e("GhosttyKittyGraphicsData", "PLACEMENT_ITERATOR"), this.scratch + 32), "placements")
      const buf = x.ghostty_wasm_alloc(64)
      try {
        while (x.ghostty_kitty_graphics_placement_next(it)) {
          const v = (k: string, read: (d: DataView, p: number) => number) => {
            x.ghostty_kitty_graphics_placement_get(it, this.e("GhosttyKittyGraphicsPlacementData", k), buf)
            return read(this.dv, buf)
          }
          const u32 = (k: string) => v(k, (d, p) => d.getUint32(p, true))
          const pl: Placement = { image: u32("IMAGE_ID"), id: u32("PLACEMENT_ID"), virtual: v("IS_VIRTUAL", (d, p) => d.getUint8(p)) === 1,
            x: 0, y: -1, xOffset: u32("X_OFFSET"), yOffset: u32("Y_OFFSET"), sourceX: u32("SOURCE_X"), sourceY: u32("SOURCE_Y"),
            sourceWidth: u32("SOURCE_WIDTH"), sourceHeight: u32("SOURCE_HEIGHT"), columns: u32("COLUMNS"), rows: u32("ROWS"), z: v("Z", (d, p) => d.getInt32(p, true)),
            gridColumns: 0, gridRows: 0 }
          const img = x.ghostty_kitty_graphics_image(g, pl.image)
          // (the cells it covers, as this terminal works them out: GhosttyKittyGraphicsPlacementRenderInfo)
          const info = this.x.ghostty_wasm_alloc(48)
          this.u8.fill(0, info, info + 48); this.dv.setUint32(info, 48, true)
          if (img && x.ghostty_kitty_graphics_placement_render_info(it, img, this.h, info) === 0) { pl.gridColumns = this.dv.getUint32(info + 12, true); pl.gridRows = this.dv.getUint32(info + 16, true) }
          x.ghostty_wasm_free(info, 48)
          // (its rectangle's first grid ref, as a point of history and screen)
          if (!pl.virtual && img && x.ghostty_kitty_graphics_placement_rect(it, img, this.h, buf) === 0
            && x.ghostty_terminal_point_from_grid_ref(this.h, buf, this.e("GhosttyPointTag", "SCREEN"), buf + 32) === 0) {
            pl.x = this.dv.getUint16(buf + 32, true); pl.y = this.dv.getUint32(buf + 36, true)
          }
          out.push(pl)
        }
      } finally { x.ghostty_wasm_free(buf, 64) }
    } finally { x.ghostty_kitty_graphics_placement_iterator_free(it) }
    return out
  }

  /** Bytes its instance holds (WebAssembly memory only grows). */
  get memory() { return this.x.memory.buffer.byteLength }

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
