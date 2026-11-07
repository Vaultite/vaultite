// A page's terminal on libghostty-vt: what vt.ts keeps, plus what drawing and input need (its render state, the key,
// mouse, focus and paste encoders, selection gestures, search, the viewport). No DOM here: term.ts holds the page.
import { Vt, type VtOptions } from "./vt.ts"

type Field = { offset: number; size: number; type: string }
type TypeInfo = { kind: string; values?: Record<string, number>; fields?: Record<string, Field>; bits?: Record<string, { lsb: number; width: number }> }

/** One drawn row, as the renderers take it. Colours are 0xRRGGBB, -1: the terminal's own (fg or bg). */
export type Row = {
  /** Each column's text: " " for an empty cell, "" for a wide character's second half. */
  text: string[]
  fg: Int32Array; bg: Int32Array; ul: Int32Array
  /** Per column: F_* below. */
  flags: Uint16Array
  /** Its selected columns (inclusive), or null. */
  sel: [number, number] | null
  /** It goes on in the next row (soft wrap). */
  wrap: boolean
}
export const F_BOLD = 1, F_ITALIC = 2, F_FAINT = 4, F_BLINK = 8, F_INVERSE = 16, F_INVISIBLE = 32, F_STRIKE = 64, F_OVERLINE = 128
/** Underline style in bits 8-10 (GhosttySgrUnderline: 1 single, 2 double, 3 curly, 4 dotted, 5 dashed). */
export const F_UNDERLINE = 0x700, UL_SHIFT = 8
export const F_WIDE = 0x800, F_LINK = 0x1000

export type Cursor = { x: number; y: number; visible: boolean; style: "bar" | "block" | "underline" | "hollow"; blinking: boolean; wideTail: boolean } | null
export type Colors = { bg: number; fg: number; cursor: number | null; palette: Int32Array }
export type Match = { start: { x: number; y: number }; end: { x: number; y: number } }

/** GhosttyKey by KeyboardEvent.code: the names the module's own enum gives. */
const CODE_NAMES: Record<string, string> = {
  Backquote: "BACKQUOTE", Backslash: "BACKSLASH", BracketLeft: "BRACKET_LEFT", BracketRight: "BRACKET_RIGHT", Comma: "COMMA",
  Equal: "EQUAL", Minus: "MINUS", Period: "PERIOD", Quote: "QUOTE", Semicolon: "SEMICOLON", Slash: "SLASH", IntlBackslash: "INTL_BACKSLASH",
  Backspace: "BACKSPACE", Enter: "ENTER", Space: "SPACE", Tab: "TAB", Delete: "DELETE", End: "END", Home: "HOME", Insert: "INSERT",
  PageDown: "PAGE_DOWN", PageUp: "PAGE_UP", ArrowDown: "ARROW_DOWN", ArrowLeft: "ARROW_LEFT", ArrowRight: "ARROW_RIGHT", ArrowUp: "ARROW_UP",
  Escape: "ESCAPE", NumpadEnter: "NUMPAD_ENTER", NumpadAdd: "NUMPAD_ADD", NumpadSubtract: "NUMPAD_SUBTRACT", NumpadMultiply: "NUMPAD_MULTIPLY",
  NumpadDivide: "NUMPAD_DIVIDE", NumpadDecimal: "NUMPAD_DECIMAL", NumpadEqual: "NUMPAD_EQUAL",
  ShiftLeft: "SHIFT_LEFT", ShiftRight: "SHIFT_RIGHT", ControlLeft: "CONTROL_LEFT", ControlRight: "CONTROL_RIGHT", AltLeft: "ALT_LEFT",
  AltRight: "ALT_RIGHT", MetaLeft: "META_LEFT", MetaRight: "META_RIGHT", CapsLock: "CAPS_LOCK", ContextMenu: "CONTEXT_MENU",
}
export const MOD_SHIFT = 1, MOD_CTRL = 2, MOD_ALT = 4, MOD_SUPER = 8

const enc = new TextEncoder(), dec = new TextDecoder()

export class Screen extends Vt {
  private rs = 0; private rows_ = 0; private cells = 0
  private keyEnc = 0; private keyEv = 0
  private mouseEnc = 0; private mouseEv = 0
  private gesture = 0; private gestureEv: number[] = []
  private search_ = 0
  /** Scratch for bigger out-parameters (1 KB). */
  private big = 0
  private styleCache = new Map<number, number[]>()
  private keyNames: Record<string, number>
  onClipboard: ((text: string) => void) | null = null
  colors: Colors = { bg: 0, fg: 0xffffff, cursor: null, palette: new Int32Array(256) }
  /** Bold text in palette colours 0-7 draws in their bright ones (as xterm.js did). */
  boldBright = true

  constructor(module: WebAssembly.Module, o: VtOptions) {
    super(module, o)
    this.big = this.x.ghostty_wasm_alloc(1024)
    this.rs = this.make((slot) => this.x.ghostty_render_state_new(0, slot))
    this.rows_ = this.make((slot) => this.x.ghostty_render_state_row_iterator_new(0, slot))
    this.cells = this.make((slot) => this.x.ghostty_render_state_row_cells_new(0, slot))
    this.keyEnc = this.make((slot) => this.x.ghostty_key_encoder_new(0, slot))
    this.keyEv = this.make((slot) => this.x.ghostty_key_event_new(0, slot))
    this.mouseEnc = this.make((slot) => this.x.ghostty_mouse_encoder_new(0, slot))
    this.mouseEv = this.make((slot) => this.x.ghostty_mouse_event_new(0, slot))
    this.gesture = this.make((slot) => this.x.ghostty_selection_gesture_new(0, slot))
    for (const type of ["PRESS", "RELEASE", "DRAG"]) this.gestureEv.push(this.make((slot) => this.x.ghostty_selection_gesture_event_new(0, slot, this.e("GhosttySelectionGestureEventType", type))))
    this.keyNames = this.types.GhosttyKey?.values ?? {}
  }

  private t(name: string) { return this.types[name] as TypeInfo }
  private off(type: string, field: string) { return this.t(type).fields![field].offset }
  private sized(type: string, p: number) { const s = this.t(type) as unknown as { size: number }; this.u8.fill(0, p, p + s.size); this.dv.setUint32(p, s.size, true); return p }

  protected more() {
    return [{ opt: "CLIPBOARD_WRITE", sig: [3, false] as [number, boolean], fn: (_t: number, _u: number, w: number) => this.clipboardWrite(w) }]
  }
  /** OSC 52 (and the like): its text/plain written to this device's clipboard; granted, so the program hears it worked. */
  private clipboardWrite(w: number) {
    const d = this.dv, o = (f: string) => w + this.off("GhosttyClipboardWrite", f)
    const contents = d.getUint32(o("contents"), true), n = d.getUint32(o("contents_len"), true), reply = d.getUint32(o("reply"), true)
    for (let i = 0; i < n; i++) {
      const c = contents + i * 16, mime = this.str(c), data = this.str(c + 8)
      if (!mime || mime.startsWith("text/plain")) { this.onClipboard?.(data); break }
    }
    if (!reply) return
    const r = this.x.ghostty_wasm_alloc(16)
    this.sized("GhosttyClipboardWriteReply", r)
    this.dv.setInt32(r + 4, this.e("GhosttyClipboardWriteResult", "SUCCESS"), true)
    ;(this.x.__indirect_function_table.get(reply) as (a: number, b: number) => void)(w, r)
    this.x.ghostty_wasm_free(r, 16)
  }
  /** A GhosttyString at p. */
  private str(p: number) { const ptr = this.dv.getUint32(p, true), len = this.dv.getUint32(p + 4, true); return ptr ? dec.decode(this.u8.subarray(ptr, ptr + len)) : "" }

  /** Lines of history kept (about: whole pages go). */
  setScrollback(n: number) { this.scrollback = n; this.set("SCROLLBACK_MAX_LINES", this.size(n > 0 ? n + 1024 : 0)) }

  // ---------- colours

  /** The terminal's colours: default fg/bg and the 16 named ones (the rest of the 256 stay Ghostty's). */
  setColors(fg: number, bg: number, cursor: number | null, named: number[]) {
    const rgb = (v: number) => { const d = this.dv; d.setUint8(this.big, v >> 16 & 255); d.setUint8(this.big + 1, v >> 8 & 255); d.setUint8(this.big + 2, v & 255); return this.big }
    this.set("COLOR_FOREGROUND", rgb(fg))
    this.set("COLOR_BACKGROUND", rgb(bg))
    if (cursor !== null) this.set("COLOR_CURSOR", rgb(cursor))
    this.check(this.x.ghostty_terminal_get(this.h, this.e("GhosttyTerminalData", "COLOR_PALETTE_DEFAULT"), this.big), "palette")
    named.forEach((v, i) => { const d = this.dv; d.setUint8(this.big + i * 3, v >> 16 & 255); d.setUint8(this.big + i * 3 + 1, v >> 8 & 255); d.setUint8(this.big + i * 3 + 2, v & 255) })
    this.set("COLOR_PALETTE", this.big)
  }

  // ---------- drawing

  /** Takes the terminal's state for a frame: "none", "some" rows or "all" changed. */
  update(): "none" | "some" | "all" {
    this.check(this.x.ghostty_render_state_update(this.rs, this.h), "render update")
    const dirty = this.rsGet("DIRTY", (d, p) => d.getInt32(p, true))
    if (dirty === 0) return "none"
    const p = this.sized("GhosttyRenderStateColors", this.big)
    this.check(this.x.ghostty_render_state_get(this.rs, this.e("GhosttyRenderStateData", "COLORS"), p), "colors")
    const d = this.dv, c = (o: number) => (d.getUint8(p + o) << 16) | (d.getUint8(p + o + 1) << 8) | d.getUint8(p + o + 2)
    const palette = this.colors.palette, at = this.off("GhosttyRenderStateColors", "palette")
    for (let i = 0; i < 256; i++) palette[i] = c(at + i * 3)
    this.colors.bg = c(this.off("GhosttyRenderStateColors", "background"))
    this.colors.fg = c(this.off("GhosttyRenderStateColors", "foreground"))
    this.colors.cursor = d.getUint8(p + this.off("GhosttyRenderStateColors", "cursor_has_value")) ? c(this.off("GhosttyRenderStateColors", "cursor")) : null
    return dirty === 2 ? "all" : "some"
  }
  private rsGet(data: string, read: (d: DataView, p: number) => number) {
    this.check(this.x.ghostty_render_state_get(this.rs, this.e("GhosttyRenderStateData", data), this.scratch), `render ${data}`)
    return read(this.dv, this.scratch)
  }
  /** The frame's rows into `rows` (the dirty ones, or all), then marked clean. */
  readRows(rows: Row[], all: boolean) {
    const x = this.x, cols = this.rsGet("COLS", (d, p) => d.getUint16(p, true)), n = this.rsGet("ROWS", (d, p) => d.getUint16(p, true))
    rows.length = n
    // (the row iterator we made, pointed at this frame's rows)
    const it = this.rows_
    this.dv.setUint32(this.scratch + 32, it, true)
    this.check(x.ghostty_render_state_get(this.rs, this.e("GhosttyRenderStateData", "ROW_ITERATOR"), this.scratch + 32), "rows")
    const RAW = this.e("GhosttyRenderStateRowData", "CELLS_RAW"), CELLS = this.e("GhosttyRenderStateRowData", "CELLS")
    const SEL = this.e("GhosttyRenderStateRowData", "SELECTION"), RROW = this.e("GhosttyRenderStateRowData", "RAW")
    const STYLE = this.e("GhosttyRenderStateRowCellsData", "STYLE"), GLEN = this.e("GhosttyRenderStateRowCellsData", "GRAPHEMES_UTF8")
    const pal = this.colors.palette
    let y = -1
    while (x.ghostty_render_state_row_iterator_next(it)) {
      y++
      let row = rows[y]
      if (!row || row.text.length !== cols) row = rows[y] = { text: Array(cols).fill(" "), fg: new Int32Array(cols), bg: new Int32Array(cols), ul: new Int32Array(cols), flags: new Uint16Array(cols), sel: null, wrap: false }
      else if (!all) {
        if (x.ghostty_render_state_row_get(it, this.e("GhosttyRenderStateRowData", "DIRTY"), this.scratch) === 0 && !this.dv.getUint8(this.scratch)) continue
      }
      // Its cells, raw (one call): the content and style id of each; a style read once per id.
      this.check(x.ghostty_render_state_row_get(it, RAW, this.scratch), "cells")
      this.dv.setUint32(this.scratch + 16, this.cells, true)
      this.check(x.ghostty_render_state_row_get(it, CELLS, this.scratch + 16), "cells")
      x.ghostty_render_state_row_get(it, RROW, this.scratch + 24)
      const rawRow = this.dv.getUint32(this.scratch + 24, true)
      row.wrap = !!(rawRow & 1)
      const ptr = this.dv.getUint32(this.scratch, true), len = Math.min(cols, this.dv.getUint32(this.scratch + 4, true))
      const ss = this.sized("GhosttyRenderStateRowSelection", this.scratch + 48)
      row.sel = x.ghostty_render_state_row_get(it, SEL, ss) === 0 ? [this.dv.getUint16(ss + 4, true), this.dv.getUint16(ss + 6, true)] : null
      this.styleCache.clear()
      const { text, fg, bg, ul, flags } = row
      for (let c = 0; c < cols; c++) {
        let d = this.dv
        if (c >= len || !ptr) { text[c] = " "; fg[c] = -1; bg[c] = -1; ul[c] = -1; flags[c] = 0; continue }
        const lo = d.getUint32(ptr + c * 8, true), hi = d.getUint32(ptr + c * 8 + 4, true)
        const tag = lo & 3, content = (lo >>> 2) & 0xffffff, styleId = ((lo >>> 26) | (hi << 6)) & 0xffff, wide = (hi >>> 10) & 3
        let f = (hi >>> 13) & 1 ? F_LINK : 0
        let ch = " "
        let cbg = -1
        if (tag === 0) ch = content & 0x1fffff ? String.fromCodePoint(content & 0x1fffff) : " "
        else if (tag === 1) {
          x.ghostty_render_state_row_cells_select(this.cells, c)
          d = this.dv
          d.setUint32(this.big, this.big + 64, true); d.setUint32(this.big + 4, 256, true); d.setUint32(this.big + 8, 0, true)
          if (x.ghostty_render_state_row_cells_get(this.cells, GLEN, this.big) === 0) { d = this.dv; ch = dec.decode(this.u8.subarray(this.big + 64, this.big + 64 + d.getUint32(this.big + 8, true))) }
        } else if (tag === 2) cbg = pal[content & 255]
        else if (tag === 3) cbg = ((content & 255) << 16) | (content & 0xff00) | ((content >>> 16) & 255)
        if (wide === 1) f |= F_WIDE
        if (wide >= 2) ch = ""
        text[c] = ch
        let cfg = -1, cul = -1
        if (styleId) {
          let s = this.styleCache.get(styleId)
          if (!s) {
            x.ghostty_render_state_row_cells_select(this.cells, c)
            x.ghostty_render_state_row_cells_get(this.cells, STYLE, this.big + 512)
            d = this.dv
            // GhosttyStyle: fg, bg and underline colours (a tag, then a palette index or r, g, b), then its flags
            const b = this.big + 512, tagAt = (o: number) => d.getUint8(b + o)
            const color = (o: number) => tagAt(o) === 1 ? pal[d.getUint8(b + o + 1)] : tagAt(o) === 2 ? (d.getUint8(b + o + 1) << 16) | (d.getUint8(b + o + 2) << 8) | d.getUint8(b + o + 3) : -1
            s = [color(0), color(4), color(8), d.getUint16(b + 12, true), tagAt(0) === 1 ? d.getUint8(b + 1) : -1]
            this.styleCache.set(styleId, s)
          }
          const fl = s[3]
          cfg = s[0]; if (cbg === -1) cbg = s[1]; cul = s[2]
          if (fl & 1) { f |= F_BOLD; if (this.boldBright && s[4] >= 0 && s[4] < 8) cfg = pal[s[4] + 8] }
          f |= (fl & 2 ? F_ITALIC : 0) | (fl & 4 ? F_FAINT : 0) | (fl & 8 ? F_BLINK : 0) | (fl & 16 ? F_INVERSE : 0) | (fl & 32 ? F_INVISIBLE : 0)
            | (fl & 64 ? F_STRIKE : 0) | (fl & 128 ? F_OVERLINE : 0) | (((fl >> 8) & 7) << UL_SHIFT)
        }
        fg[c] = cfg; bg[c] = cbg; ul[c] = cul; flags[c] = f
      }
      // (its row read: clean, as the renderer has it now)
      this.dv.setUint8(this.scratch, 0)
      x.ghostty_render_state_row_set(it, this.e("GhosttyRenderStateRowOption", "DIRTY"), this.scratch)
    }
    x.ghostty_render_state_clean(this.rs)
  }
  /** Where the cursor is drawn (null: not in the viewport, or hidden). */
  cursorState(): Cursor {
    const p = this.sized("GhosttyRenderStateCursor", this.big)
    this.check(this.x.ghostty_render_state_get(this.rs, this.e("GhosttyRenderStateData", "CURSOR"), p), "cursor")
    const d = this.dv, o = (f: string) => p + this.off("GhosttyRenderStateCursor", f)
    if (!d.getUint8(o("viewport_has_value"))) return null
    const styles = ["bar", "block", "underline", "hollow"] as const
    return { x: d.getUint16(o("viewport_x"), true), y: d.getUint16(o("viewport_y"), true), visible: !!d.getUint8(o("visible")), blinking: !!d.getUint8(o("blinking")),
      wideTail: !!d.getUint8(o("wide_tail")), style: styles[d.getInt32(o("visual_style"), true)] ?? "block" }
  }

  // ---------- the viewport

  /** Rows of history and screen, where the viewport's top is in them, and its rows. */
  scrollbar() {
    this.check(this.x.ghostty_terminal_get(this.h, this.e("GhosttyTerminalData", "SCROLLBAR"), this.big), "scrollbar")
    const d = this.dv, n = (o: number) => d.getUint32(this.big + o, true) + d.getUint32(this.big + o + 4, true) * 2 ** 32
    return { total: n(0), offset: n(8), len: n(16) }
  }
  /** Moves the viewport: by `delta` rows, to the top, the bottom, or a row of its history. */
  scroll(to: { delta: number } | "top" | "bottom" | { row: number }) {
    const p = this.big, d = this.dv
    this.u8.fill(0, p, p + 24)
    const tag = to === "top" ? "TOP" : to === "bottom" ? "BOTTOM" : "delta" in to ? "DELTA" : "ROW"
    d.setInt32(p, this.e("GhosttyTerminalScrollViewportTag", tag), true)
    if (typeof to === "object") { const v = "delta" in to ? to.delta : to.row; d.setInt32(p + 8, v, true); d.setInt32(p + 12, v < 0 ? -1 : 0, true) }
    this.x.ghostty_terminal_scroll_viewport(this.h, p)
  }
  /** A program asked for the mouse (any tracking mode). */
  get mouseTracking() { return this.get("MOUSE_TRACKING", (d, p) => d.getUint8(p)) !== 0 }

  // ---------- reading rows (links, text)

  /** A grid ref at (x, y) of `tag`'s coordinates (SCREEN: history then screen; VIEWPORT), at p (8 bytes); false if none. */
  private ref(tag: "SCREEN" | "VIEWPORT" | "ACTIVE", x: number, y: number, out: number) {
    const p = this.big + 128, d = this.dv
    this.u8.fill(0, p, p + 24)
    d.setInt32(p, this.e("GhosttyPointTag", tag), true)
    d.setUint16(p + 8, x, true); d.setUint32(p + 12, y, true)
    return this.x.ghostty_terminal_grid_ref(this.h, p, out) === 0
  }
  /** A row of history and screen (`y` from the top of all) as text and each character's column; and whether it wraps. */
  line(y: number, tag: "SCREEN" | "VIEWPORT" = "SCREEN") {
    const out = this.big + 160, cols = this.cols
    let text = ""
    const at: number[] = [], widths: number[] = []
    if (!this.ref(tag, 0, y, out)) return null
    this.x.ghostty_grid_ref_row(out, this.big + 176)
    const wrap = !!(this.dv.getUint32(this.big + 176, true) & 1), cont = !!(this.dv.getUint32(this.big + 176, true) & 2)
    for (let x = 0; x < cols; x++) {
      this.dv.setUint16(out + 4, x, true)
      if (this.x.ghostty_grid_ref_cell(out, this.big + 184) !== 0) { text += " "; at.push(x); widths.push(1); continue }
      const d = this.dv, lo = d.getUint32(this.big + 184, true), hi = d.getUint32(this.big + 188, true), tag2 = lo & 3, wide = (hi >>> 10) & 3
      if (wide >= 2) continue
      let ch = tag2 <= 1 && (lo >>> 2) & 0x1fffff ? String.fromCodePoint((lo >>> 2) & 0x1fffff) : " "
      if (tag2 === 1) {
        this.x.ghostty_grid_ref_graphemes(out, this.big + 256, 32, this.big + 192)
        const n = Math.min(32, this.dv.getUint32(this.big + 192, true))
        ch = ""
        for (let i = 0; i < n; i++) ch += String.fromCodePoint(this.dv.getUint32(this.big + 256 + i * 4, true))
      }
      for (let k = 0; k < ch.length; k++) at.push(x)
      widths.push(wide === 1 ? 2 : 1)
      text += ch
    }
    return { text, at, wrap, cont }
  }
  /** An OSC 8 link's URI at a cell of the viewport. */
  hyperlink(x: number, y: number) {
    const out = this.big + 160
    if (!this.ref("VIEWPORT", x, y, out)) return ""
    const r = this.x.ghostty_grid_ref_hyperlink_uri(out, this.big + 256, 700, this.big + 192)
    if (r !== 0) return ""
    return dec.decode(this.u8.subarray(this.big + 256, this.big + 256 + this.dv.getUint32(this.big + 192, true)))
  }
  /** Text of its whole history and screen, or from row `from`. */
  textFrom(from: number, unwrap: boolean) { return this.format("PLAIN", from, { unwrap, trim: true }) }

  // ---------- selection

  private selectionPtr() { return this.big + 320 }
  hasSelection() { return this.x.ghostty_terminal_get(this.h, this.e("GhosttyTerminalData", "SELECTION"), this.selectionPtr()) === 0 }
  /** The selection's text (wrapped lines joined), "" for none. */
  selectionText() {
    if (!this.hasSelection()) return ""
    try { return this.format("PLAIN", 0, { unwrap: true, trim: true, selection: this.selectionPtr() }) } catch { return "" }
  }
  clearSelection() { this.x.ghostty_terminal_set(this.h, this.e("GhosttyTerminalOption", "SELECTION"), 0) }
  selectAll() {
    if (this.x.ghostty_terminal_select_all(this.h, this.selectionPtr()) === 0) this.set("SELECTION", this.selectionPtr())
  }
  /** Viewport cells from (x1, y1) to (x2, y2), inclusive, selected. */
  selectRange(x1: number, y1: number, x2: number, y2: number, tag: "VIEWPORT" | "SCREEN" = "VIEWPORT") {
    const s = this.selectionPtr()
    this.u8.fill(0, s, s + 20)
    if (!this.ref(tag, x1, y1, s) || !this.ref(tag, x2, y2, s + 8)) return
    this.set("SELECTION", s)
  }
  /** A mouse press, drag or release over the viewport, as Ghostty selects: a click, a double click's word, a triple's
   *  line, a drag between. `px`: surface pixels. */
  gestureEvent(kind: "press" | "drag" | "release", cell: { x: number; y: number } | null, px: { x: number; y: number }, geo: { cols: number; cellWidth: number; height: number }, timeMs: number, rect = false) {
    const ev = this.gestureEv[kind === "press" ? 0 : kind === "release" ? 1 : 2], opt = (n: string) => this.e("GhosttySelectionGestureEventOption", n)
    const p = this.big + 400, d = this.dv
    const set = (o: string, ptr: number) => this.x.ghostty_selection_gesture_event_set(ev, opt(o), ptr)
    if (cell && this.ref("VIEWPORT", cell.x, cell.y, p)) set("REF", p); else set("REF", 0)
    if (kind !== "release") {
      d.setFloat64(p + 16, px.x, true); d.setFloat64(p + 24, px.y, true); set("POSITION", p + 16)
    }
    if (kind === "press") {
      d.setBigUint64(p + 32, BigInt(Math.round(timeMs * 1e6)), true); set("TIME_NS", p + 32)
      d.setBigUint64(p + 40, 500_000_000n, true); set("REPEAT_INTERVAL_NS", p + 40)
      d.setFloat64(p + 48, 6, true); set("REPEAT_DISTANCE", p + 48)
    }
    if (kind === "drag") {
      d.setUint32(p + 56, geo.cols, true); d.setUint32(p + 60, Math.max(1, Math.round(geo.cellWidth)), true); d.setUint32(p + 64, 0, true); d.setUint32(p + 68, Math.max(1, Math.round(geo.height)), true)
      set("GEOMETRY", p + 56)
      d.setUint8(p + 72, rect ? 1 : 0); set("RECTANGLE", p + 72)
    }
    const out = this.selectionPtr()
    const r = this.x.ghostty_selection_gesture_event(this.gesture, this.h, ev, out)
    if (r === 0) this.set("SELECTION", out)
    else if (kind === "press") this.clearSelection()
    return this.gestureData()
  }
  gestureData() {
    const g = (n: string, p: number) => this.x.ghostty_selection_gesture_get(this.gesture, this.h, this.e("GhosttySelectionGestureData", n), p)
    const p = this.big + 480
    g("CLICK_COUNT", p); g("DRAGGED", p + 1); g("AUTOSCROLL", p + 4)
    return { clicks: this.dv.getUint8(p), dragged: !!this.dv.getUint8(p + 1), autoscroll: this.dv.getInt32(p + 4, true) }
  }

  // ---------- input

  /** A key as the program wants it (its modes: cursor keys, keypad, modifyOtherKeys), "" when it sends nothing. */
  key(e: { code: string; key: string; action: "press" | "repeat" | "release"; mods: number; text: string; composing?: boolean }) {
    const x = this.x, ev = this.keyEv
    x.ghostty_key_encoder_set_from_terminal(this.keyEnc, this.h)
    // (kitty keyboard stays off: the app's terminals have never spoken it)
    this.dv.setUint32(this.scratch, 0, true)
    x.ghostty_key_encoder_set(this.keyEnc, this.e("GhosttyKeyEncoderOption", "KITTY_FLAGS"), this.scratch)
    x.ghostty_key_event_set_action(ev, this.e("GhosttyKeyAction", e.action.toUpperCase()))
    x.ghostty_key_event_set_key(ev, this.keyOf(e.code))
    x.ghostty_key_event_set_mods(ev, e.mods)
    x.ghostty_key_event_set_consumed_mods(ev, e.text && e.mods & MOD_SHIFT ? MOD_SHIFT : 0)
    x.ghostty_key_event_set_composing(ev, e.composing ? 1 : 0)
    const unshifted = /^Key[A-Z]$/.test(e.code) ? e.code.charCodeAt(3) + 32 : /^Digit\d$/.test(e.code) ? e.code.charCodeAt(5) : e.code === "Space" ? 32 : 0
    x.ghostty_key_event_set_unshifted_codepoint(ev, unshifted)
    const t = enc.encode(e.text), tp = this.big + 512
    this.u8.set(t.subarray(0, 256), tp + 16)
    this.dv.setUint32(tp, t.length ? tp + 16 : 0, true); this.dv.setUint32(tp + 4, Math.min(256, t.length), true)
    x.ghostty_key_event_set_utf8(ev, tp)
    const out = this.big + 800, wp = this.big + 796
    if (x.ghostty_key_encoder_encode(this.keyEnc, ev, out, 200, wp) !== 0) return ""
    return dec.decode(this.u8.subarray(out, out + this.dv.getUint32(wp, true)))
  }
  private keyOf(code: string) {
    const name = /^Key[A-Z]$/.test(code) ? code[3] : /^Digit\d$/.test(code) ? `DIGIT_${code[5]}` : /^F\d+$/.test(code) ? code
      : /^Numpad\d$/.test(code) ? `NUMPAD_${code[6]}` : CODE_NAMES[code]
    return (name && (this.keyNames[name] ?? this.keyNames[name.replace("BACKQUOTE", "GRAVE")])) || 0
  }
  /** A mouse event as the program's mouse mode reports it (nothing when it doesn't: no mode, or motion it didn't ask for).
   *  Positions are surface pixels. */
  mouse(action: "press" | "release" | "motion", button: number, mods: number, px: { x: number; y: number }, size: { width: number; height: number; cellWidth: number; cellHeight: number }, anyPressed: boolean) {
    const x = this.x, ev = this.mouseEv, e = this.mouseEnc
    x.ghostty_mouse_encoder_set_from_terminal(e, this.h)
    const sz = this.sized("GhosttyMouseEncoderSize", this.big + 512), d = this.dv
    d.setUint32(sz + 4, Math.round(size.width), true); d.setUint32(sz + 8, Math.round(size.height), true)
    d.setUint32(sz + 12, Math.max(1, Math.round(size.cellWidth)), true); d.setUint32(sz + 16, Math.max(1, Math.round(size.cellHeight)), true)
    x.ghostty_mouse_encoder_set(e, this.e("GhosttyMouseEncoderOption", "SIZE"), sz)
    d.setUint8(this.big + 560, anyPressed ? 1 : 0)
    x.ghostty_mouse_encoder_set(e, this.e("GhosttyMouseEncoderOption", "ANY_BUTTON_PRESSED"), this.big + 560)
    x.ghostty_mouse_event_set_action(ev, this.e("GhosttyMouseAction", action.toUpperCase()))
    if (button) x.ghostty_mouse_event_set_button(ev, button); else x.ghostty_mouse_event_clear_button(ev)
    x.ghostty_mouse_event_set_mods(ev, mods)
    this.dv.setFloat32(this.big + 568, px.x, true); this.dv.setFloat32(this.big + 572, px.y, true)
    x.ghostty_mouse_event_set_position(ev, this.big + 568)
    const out = this.big + 800, wp = this.big + 796
    // (bytes: X10's coordinates go past 127, not UTF-8)
    if (x.ghostty_mouse_encoder_encode(e, ev, out, 200, wp) !== 0) return new Uint8Array(0)
    return this.u8.slice(out, out + this.dv.getUint32(wp, true))
  }
  /** Focus in or out, when the program asked (mode 1004). */
  focus(on: boolean) {
    if (!this.mode(1004)) return ""
    const out = this.big + 800, wp = this.big + 796
    if (this.x.ghostty_focus_encode(this.e("GhosttyFocusEvent", on ? "GAINED" : "LOST"), out, 16, wp) !== 0) return ""
    return dec.decode(this.u8.subarray(out, out + this.dv.getUint32(wp, true)))
  }
  /** Pasted text as it's sent: unsafe control bytes dropped, bracketed when the program asked (mode 2004). */
  paste(text: string) {
    const t = enc.encode(text), n = t.length, x = this.x
    const src = x.ghostty_wasm_alloc(n + 1), cap = n * 2 + 16, out = x.ghostty_wasm_alloc(cap), wp = this.big + 796
    try {
      this.u8.set(t, src)
      if (x.ghostty_paste_encode(src, n, this.mode(2004) ? 1 : 0, out, cap, wp) !== 0) return text
      return dec.decode(this.u8.subarray(out, out + this.dv.getUint32(wp, true)))
    } finally { x.ghostty_wasm_free(src, n + 1); x.ghostty_wasm_free(out, cap) }
  }

  // ---------- search (literal: Ghostty's own, case-insensitive for ASCII)

  /** Looks for `needle` (""/null: stops). */
  searchFor(needle: string | null) {
    if (!this.search_) this.search_ = this.make((slot) => this.x.ghostty_search_new(0, slot, this.h))
    const opt = this.e("GhosttySearchOption", "NEEDLE")
    if (!needle) { this.x.ghostty_search_set(this.search_, opt, 0); return }
    const t = enc.encode(needle), p = this.big + 512
    this.u8.set(t.subarray(0, 200), p + 16)
    this.dv.setUint32(p, p + 16, true); this.dv.setUint32(p + 4, Math.min(200, t.length), true)
    this.x.ghostty_search_set(this.search_, opt, p)
    this.dv.setInt32(p + 300, this.e("GhosttySearchScroll", "NONE"), true)
    this.x.ghostty_search_set(this.search_, this.e("GhosttySearchOption", "SELECT_SCROLL"), p + 300)
  }
  /** Its matches (SCREEN coordinates), all of them, after catching up. */
  searchMatches(max: number): Match[] {
    if (!this.search_) return []
    this.x.ghostty_search_run(this.search_)
    const g = (n: string, p: number) => this.x.ghostty_search_get(this.search_, this.e("GhosttySearchData", n), p)
    const p = this.big + 512
    g("TOTAL_MATCHES", p)
    const total = Math.min(max, this.dv.getUint32(p, true))
    if (!total) return []
    const buf = this.x.ghostty_wasm_alloc(total * 20)
    try {
      this.dv.setUint32(p, buf, true); this.dv.setUint32(p + 4, total, true); this.dv.setUint32(p + 8, 0, true)
      g("MATCHES", p)
      const n = Math.min(total, this.dv.getUint32(p + 8, true)), out: Match[] = []
      for (let i = 0; i < n; i++) {
        const a = this.point(buf + i * 20), b = this.point(buf + i * 20 + 8)
        if (a && b) out.push({ start: a, end: b })
      }
      return out
    } finally { this.x.ghostty_wasm_free(buf, total * 20) }
  }
  /** A grid ref's SCREEN coordinates. */
  private point(ref: number) {
    const p = this.big + 600
    if (this.x.ghostty_terminal_point_from_grid_ref(this.h, ref, this.e("GhosttyPointTag", "SCREEN"), p) !== 0) return null
    return { x: this.dv.getUint16(p, true), y: this.dv.getUint32(p + 4, true) }
  }

  // ---------- snapshots

  /** Its state as GHOSTSNP bytes (history, screen, modes). */
  snapshot() {
    const pp = this.scratch + 32, lp = this.scratch + 40
    this.check(this.x.ghostty_snapshot_encode_alloc(this.h, 0, pp, lp), "snapshot")
    const ptr = this.dv.getUint32(pp, true), len = this.dv.getUint32(lp, true)
    const out = this.u8.slice(ptr, ptr + len)
    this.x.ghostty_free(0, ptr, len)
    return out
  }

  dispose() {
    if (!this.h) return
    const x = this.x
    if (this.search_) x.ghostty_search_free(this.search_)
    x.ghostty_selection_gesture_free(this.gesture, this.h)
    for (const ev of this.gestureEv) x.ghostty_selection_gesture_event_free(ev)
    x.ghostty_mouse_event_free(this.mouseEv); x.ghostty_mouse_encoder_free(this.mouseEnc)
    x.ghostty_key_event_free(this.keyEv); x.ghostty_key_encoder_free(this.keyEnc)
    x.ghostty_render_state_row_cells_free(this.cells); x.ghostty_render_state_row_iterator_free(this.rows_)
    x.ghostty_render_state_free(this.rs)
    super.dispose()
  }
}
