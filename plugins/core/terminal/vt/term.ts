// A terminal in a page on libghostty-vt (screen.ts), xterm.js's shape for what Terminal.tsx uses: drawn by WebGL2 or
// Canvas2D (render/), typed in through [data-term-input]; all bound for the program goes to one `onBytes`.
import { CanvasRenderer } from "./render/canvas.ts"
import type { Frame, Mark, Renderer } from "./render/frame.ts"
import { measure, type Metrics } from "./render/glyphs.ts"
import { WebglRenderer } from "./render/webgl.ts"
import { keyBytes } from "./input.ts"
import { osc8At, webLinks, type Link, type LinkProvider } from "./links.ts"
import { wirePointer } from "./mouse.ts"
import { findAll, type FindSpec } from "./search.ts"
import { F_LINK, Screen, type Match, type Row } from "./screen.ts"

export type { Link, LinkProvider } from "./links.ts"
export type { FindSpec } from "./search.ts"

/** Colours as 0xRRGGBB. */
export type Theme = {
  foreground: number; background: number; cursor: number; cursorAccent: number
  /** The 16 named colours (black, red... bright white). */
  ansi: number[]
  selection: { color: number; alpha: number }; selectionInactive: { color: number; alpha: number }
  scrollbar: number
  /** Search: matches, the current one and its border, and their marks in the scrollbar. */
  find: { match: number; active: number; border: number; ruler: number; activeRuler: number }
  /** No ground drawn: the page shows through (translucent pages). */
  clear: boolean
}
export type CursorStyle = "block" | "bar" | "underline"
export type TermOptions = {
  fontFamily: string; fontSize: number; lineHeight: number
  cursorStyle: CursorStyle; cursorInactiveStyle: CursorStyle | "outline"; cursorBlink: boolean
  scrollback: number; theme: Theme
  /** A web or OSC 8 link clicked. */
  onLink: (e: MouseEvent, uri: string) => void
  /** A program copying (OSC 52). */
  onCopy: (text: string) => void
  mac: boolean
}
type Disposable = { dispose: () => void }
type Listener<T> = (v: T) => void

/** How long a piece of output is parsed for before the page gets a frame (ms). */
const SLICE_MS = 8
/** Output parsed at once at most (bytes). */
const PIECE = 64 << 10
/** Room at the right for the scrollbar, CSS px. */
export const GUTTER = 10

let wasm: WebAssembly.Module | null = null
/** The compiled module, given by whoever loaded it (index.tsx). */
export const setModule = (m: WebAssembly.Module) => { wasm = m }

export class Term {
  cols: number; rows: number
  s: Screen
  o: TermOptions
  element!: HTMLDivElement; textarea!: HTMLTextAreaElement; screenEl!: HTMLDivElement; canvas!: HTMLCanvasElement
  m!: Metrics
  r: Renderer | null = null
  /** Its last drawn rows, as the renderer has them. */
  view: Row[] = []
  focused = false
  composing = ""
  private queue: { data: Uint8Array | string; at: number; cb?: () => void }[] = []
  private pumping = 0
  private frame = 0
  private stale = true
  private allRows = true
  private holdSince = 0
  private blinkOn = true
  private blinkTimer = 0
  private lastOffset = -1
  private handlers = { render: new Set<Listener<void>>(), bytes: new Set<(v: string | Uint8Array, reply: boolean) => void>(), resize: new Set<Listener<{ cols: number; rows: number }>>(), scroll: new Set<Listener<number>>() }
  private keyHook: ((e: KeyboardEvent) => boolean) | null = null
  providers = new Set<LinkProvider>()
  /** The link under the pointer, underlined. */
  hovered: { link: Link; cells: { y: number; x1: number; x2: number }[] } | null = null
  private finding: { spec: FindSpec; matches: Match[]; current: number; max: number; onResults: (r: { index: number; count: number }) => void; timer: number } | null = null
  scrollbarShown = 0
  private scrollbarTimer = 0
  private off: (() => void)[] = []
  private wantGl: boolean
  private glLost = false
  private disposed = false
  /** Output came while it was parked (out of the page, its tab hidden): drawn at once when it's back. */
  private unseen = false

  constructor(o: TermOptions & { cols?: number; rows?: number; webgl: boolean }) {
    if (!wasm) throw new Error("libghostty-vt isn't loaded")
    this.o = o
    this.cols = o.cols ?? 80; this.rows = o.rows ?? 24
    this.wantGl = o.webgl
    this.s = new Screen(wasm, { cols: this.cols, rows: this.rows, scrollback: o.scrollback, onReply: (r) => this.emit(r, true) })
    this.s.onClipboard = (t) => o.onCopy(t)
    this.applyTheme()
  }

  // ---------- the page

  open(parent: HTMLElement) {
    const root = this.element = document.createElement("div")
    root.dataset.term = ""
    root.style.cssText = "position:relative;width:100%;height:100%;overflow:hidden;cursor:text"
    const viewport = document.createElement("div")
    viewport.dataset.termViewport = ""; viewport.dataset.termGround = ""
    viewport.style.cssText = "position:absolute;inset:0"
    const screen = this.screenEl = document.createElement("div")
    screen.dataset.termScreen = ""
    screen.style.cssText = "position:absolute;left:0;top:0"
    const ta = this.textarea = document.createElement("textarea")
    ta.dataset.termInput = ""
    ta.setAttribute("aria-label", "Terminal input")
    ta.setAttribute("autocorrect", "off"); ta.setAttribute("autocapitalize", "off"); ta.setAttribute("spellcheck", "false")
    ta.setAttribute("autocomplete", "off"); ta.tabIndex = 0
    ta.style.cssText = "position:absolute;left:0;top:0;width:1px;height:1px;padding:0;border:0;margin:0;opacity:0;resize:none;overflow:hidden;white-space:nowrap;z-index:-5;caret-color:transparent;color:transparent;background:transparent"
    viewport.appendChild(screen)
    root.append(viewport, ta)
    parent.appendChild(root)
    this.applyTheme()
    this.measure()
    this.makeRenderer()
    this.wireInput()
    this.off.push(wirePointer(this))
    // (another display's density: measured again)
    const dpr = () => {
      const q = matchMedia(`(resolution: ${devicePixelRatio}dppx)`)
      const on = () => { this.measure(); this.fit(); dpr() }
      q.addEventListener("change", on, { once: true })
      this.off.push(() => q.removeEventListener("change", on))
    }
    dpr()
  }
  private makeRenderer() {
    this.r?.dispose()
    this.canvas?.remove()
    const c = this.canvas = document.createElement("canvas")
    c.style.cssText = "position:absolute;left:0;top:0;display:block"
    this.screenEl.appendChild(c)
    this.r = null
    if (this.wantGl && !this.glLost && !this.o.theme.clear) try {
      // Its context lost (the GPU reset, too many contexts): Canvas2D from then on.
      this.r = new WebglRenderer(c, () => { this.glLost = true; queueMicrotask(() => { if (!this.disposed) { this.makeRenderer(); this.fit(); this.renderNow() } }) })
    } catch { this.glLost = true }
    if (!this.r) {
      // (a canvas that had a WebGL context can't give a 2D one)
      if (c.getContext("webgl2") && this.glLost) { c.remove(); const n = this.canvas = document.createElement("canvas"); n.style.cssText = c.style.cssText; this.screenEl.appendChild(n) }
      this.r = new CanvasRenderer(this.canvas)
    }
    this.element.dataset.termRenderer = this.r.kind
    this.allRows = true; this.stale = true
  }
  /** WebGL wanted or not (translucent pages draw with Canvas2D); a lost context stays Canvas2D. */
  setWebgl(on: boolean) {
    if (on === this.wantGl && this.r) return
    this.wantGl = on
    if (this.element) { this.makeRenderer(); this.fit(); this.renderNow() }
  }
  get renderer() { return this.r?.kind ?? "canvas" }

  private measure() {
    this.m = measure(this.o.fontFamily, this.o.fontSize, this.o.lineHeight, devicePixelRatio || 1)
    const ta = this.textarea
    if (ta) { ta.style.lineHeight = `${this.m.cssH}px`; ta.style.fontFamily = this.o.fontFamily; ta.style.fontSize = `${this.o.fontSize}px` }
  }
  /** Columns and rows for its box (none while it isn't laid out); the canvas fills the box. */
  fit() {
    const el = this.element
    if (!el || !el.clientWidth || !el.clientHeight) return false
    const W = el.clientWidth, H = el.clientHeight, m = this.m
    const cols = Math.max(2, Math.floor((W - GUTTER) / m.cssW)), rows = Math.max(1, Math.floor(H / m.cssH))
    this.screenEl.style.width = `${cols * m.cssW}px`; this.screenEl.style.height = `${rows * m.cssH}px`
    this.canvas.style.width = `${W}px`; this.canvas.style.height = `${H}px`
    const w = Math.round(W * m.dpr), h = Math.round(H * m.dpr), cleared = this.canvas.width !== w || this.canvas.height !== h
    this.r?.resize(w, h, m)
    if (cols !== this.cols || rows !== this.rows) this.resize(cols, rows)
    this.allRows = true; this.stale = true
    // (a new size clears the canvas, and one back from parking shows what it missed: drawn at once, never blank or old)
    if (cleared || this.unseen) this.renderNow(); else this.requestRender()
    return true
  }
  resize(cols: number, rows: number) {
    if (cols === this.cols && rows === this.rows) return
    this.cols = cols; this.rows = rows
    this.s.resize(cols, rows, this.m?.w ?? 8, this.m?.h ?? 16)
    this.view = []
    this.allRows = true; this.stale = true
    for (const fn of this.handlers.resize) fn({ cols, rows })
    this.requestRender()
  }

  // ---------- options

  setFont(family: string, size: number) {
    if (family === this.o.fontFamily && size === this.o.fontSize) return
    this.o.fontFamily = family; this.o.fontSize = size
    if (!this.element) return
    this.measure(); this.fit()
  }
  setTheme(t: Theme) {
    const clear = t.clear !== this.o.theme.clear
    this.o.theme = t
    this.applyTheme()
    if (clear && this.element) this.makeRenderer()
    if (this.element) { this.fit(); this.requestRender(true) }
  }
  private applyTheme() {
    const t = this.o.theme
    this.s.setColors(t.foreground, t.background, t.cursor, t.ansi)
    this.allRows = true
    // (its ground behind the canvas too: the margin round the grid, and what scripts read)
    const ground = this.element?.querySelector<HTMLElement>("[data-term-ground]")
    if (ground) ground.style.backgroundColor = t.clear ? "transparent" : `#${t.background.toString(16).padStart(6, "0")}`
  }
  setCursor(c: { style: CursorStyle; inactive: CursorStyle | "outline"; blink: boolean }) {
    this.o.cursorStyle = c.style; this.o.cursorInactiveStyle = c.inactive; this.o.cursorBlink = c.blink
    this.blink(); this.requestRender(true)
  }
  setScrollback(n: number) { this.o.scrollback = n; this.s.setScrollback(n) }

  // ---------- output

  /** Output to parse, in ≤8 ms slices between frames; `cb` once it's parsed. */
  write(data: Uint8Array | string, cb?: () => void) {
    this.queue.push({ data, at: 0, cb })
    if (!this.pumping) this.pump()
  }
  private pump = () => {
    this.pumping = 0
    const t0 = performance.now()
    while (this.queue.length) {
      const q = this.queue[0], len = q.data.length
      const end = Math.min(len, q.at + PIECE)
      const piece = typeof q.data === "string" ? q.data.slice(q.at, end) : q.data.subarray(q.at, end)
      try { this.s.write(piece) } catch (e) { console.error("terminal:", e) }
      q.at = end
      if (q.at >= len) { this.queue.shift(); q.cb?.() }
      if (performance.now() - t0 > SLICE_MS) break
    }
    this.stale = true
    this.blinkOn = true
    this.requestRender()
    if (this.finding) this.refind()
    if (this.queue.length) this.pumping = window.setTimeout(this.pump, 0)
  }
  /** A blank screen; output still queued from before is dropped (a reconnect replays it, or it was the old shell's). */
  reset() {
    this.queue.length = 0
    this.s.reset()
    this.s.clearSelection()
    this.allRows = true; this.stale = true
    this.requestRender()
  }

  // ---------- drawing

  /** A frame soon (`force`: drawn even if the screen didn't change: the cursor, a link, the scrollbar). */
  requestRender(force = false) {
    if (force) this.stale = true
    if (this.frame || this.disposed) return
    // (parked: no frames woken for a page that can't show it)
    if (this.element && !this.element.isConnected) { this.stale = true; this.unseen = true; return }
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.render() })
  }
  /** Drawn now, not at the next frame (a picture of it, a new size). */
  renderNow() { cancelAnimationFrame(this.frame); this.frame = 0; this.stale = true; this.render() }
  /** Its rows read from the terminal, as they are now. */
  private sync() {
    // (synchronized output, mode 2026: what's on screen holds till the program's frame is whole, a second at most)
    if (this.s.mode(2026)) {
      if (!this.holdSince) this.holdSince = performance.now()
      if (performance.now() - this.holdSince < 1000) { this.requestRender(); return false }
    } else this.holdSince = 0
    const changed = this.s.update()
    if (changed !== "none" || this.allRows || this.view.length !== this.rows) this.s.readRows(this.view, this.allRows || changed === "all")
    this.allRows = false
    const sb = this.s.scrollbar()
    if (sb.offset !== this.lastOffset) {
      const was = this.lastOffset
      this.lastOffset = sb.offset
      if (was >= 0) { for (const fn of this.handlers.scroll) fn(sb.offset); if (sb.offset + sb.len < sb.total) this.showScrollbar() }
    }
    return true
  }
  private render() {
    if (this.disposed || !this.r || !this.element?.isConnected) return
    if (!this.stale) return
    this.unseen = false
    if (!this.sync()) return
    this.stale = false
    this.r.draw(this.frameOf())
    if (this.focused) this.placeInput()
    for (const fn of this.handlers.render) fn()
  }
  private frameOf(): Frame {
    const t = this.o.theme, cur = this.s.cursorState(), sb = this.s.scrollbar(), c = this.s.colors
    const style = this.focused ? this.o.cursorStyle : this.o.cursorInactiveStyle
    const shown = cur && cur.visible && (!this.focused || !this.o.cursorBlink || this.blinkOn)
    const marks: Mark[] = []
    const top = sb.offset
    if (this.finding) this.finding.matches.forEach((m, i) => {
      for (let y = Math.max(m.start.y, top); y <= Math.min(m.end.y, top + this.rows - 1); y++) {
        const x1 = y === m.start.y ? m.start.x : 0, x2 = y === m.end.y ? m.end.x : this.cols - 1
        marks.push(i === this.finding!.current ? { y: y - top, x1, x2, color: t.find.active, alpha: 1, border: t.find.border } : { y: y - top, x1, x2, color: t.find.match, alpha: 1 })
      }
    })
    const rulerMarks = this.finding && sb.total > sb.len ? this.finding.matches.map((m, i) => ({ at: m.start.y / sb.total, color: i === this.finding!.current ? t.find.activeRuler : t.find.ruler })) : []
    const scrolled = sb.total > sb.len
    return {
      rows: this.view, cols: this.cols, fg: c.fg, bg: c.bg, clear: t.clear,
      selection: this.focused || !this.s.hasSelection() ? t.selection : t.selectionInactive,
      cursor: shown && cur ? { x: cur.x, y: cur.y, style: style === "block" && !this.focused ? "outline" : style, color: c.cursor ?? t.cursor, accent: t.cursorAccent } : null,
      marks, links: this.hovered?.cells ?? [],
      scrollbar: scrolled && (this.scrollbarShown > 0 || rulerMarks.length) ? { top: sb.offset / sb.total, height: sb.len / sb.total, alpha: this.scrollbarShown, color: t.scrollbar, marks: rulerMarks } : null,
      preedit: this.composing,
    }
  }
  /** The scrollbar shows while it scrolls (and a moment after), as macOS's do. */
  showScrollbar() {
    this.scrollbarShown = 0.5
    clearTimeout(this.scrollbarTimer)
    this.scrollbarTimer = window.setTimeout(() => { this.scrollbarShown = 0; this.requestRender(true) }, 1200)
    this.requestRender(true)
  }
  /** The input field at the cursor: an input method's candidates show there. */
  private placeInput() {
    const cur = this.s.cursorState()
    if (!cur) return
    // (only when it moved: a style changed is a layout of the page at the next frame)
    const left = `${cur.x * this.m.cssW}px`, top = `${cur.y * this.m.cssH}px`
    if (this.textarea.style.left !== left) this.textarea.style.left = left
    if (this.textarea.style.top !== top) this.textarea.style.top = top
  }
  private blink() {
    clearInterval(this.blinkTimer)
    this.blinkOn = true
    if (!this.o.cursorBlink || !this.focused) return
    this.blinkTimer = window.setInterval(() => { this.blinkOn = !this.blinkOn; this.requestRender(true) }, 600)
  }

  // ---------- input

  /** Bytes for the program: typed, pasted, the mouse; `reply`, the terminal's own answer to what it was sent. */
  onBytes(fn: (v: string | Uint8Array, reply: boolean) => void): Disposable { this.handlers.bytes.add(fn); return { dispose: () => this.handlers.bytes.delete(fn) } }
  /** After each frame drawn (what sits over the screen follows it: dictation's words). */
  onRender(fn: Listener<void>): Disposable { this.handlers.render.add(fn); return { dispose: () => this.handlers.render.delete(fn) } }
  onResize(fn: Listener<{ cols: number; rows: number }>): Disposable { this.handlers.resize.add(fn); return { dispose: () => this.handlers.resize.delete(fn) } }
  onScroll(fn: Listener<number>): Disposable { this.handlers.scroll.add(fn); return { dispose: () => this.handlers.scroll.delete(fn) } }
  emit(data: string | Uint8Array, reply = false) { if (data.length) for (const fn of this.handlers.bytes) fn(data, reply) }
  /** Bytes as if typed (the phone's key row); the view goes to the end, as typing does. */
  input(data: string) { this.toBottom(); this.emit(data) }
  /** Text pasted: bracketed when the program asked, unsafe control characters dropped. */
  paste(text: string) { this.toBottom(); this.emit(this.s.paste(text.replace(/\r?\n/g, "\r"))) }
  /** Sees a key before the terminal does: false keeps it from the terminal. */
  attachCustomKeyEventHandler(fn: (e: KeyboardEvent) => boolean) { this.keyHook = fn }
  /** Pastes bracketed (mode 2004). */
  get bracketedPaste() { return this.s.mode(2004) }
  /** The cursor's cell of the viewport, as it is now (null: scrolled off or hidden). */
  cursor() { if (this.stale) this.sync(); const c = this.s.cursorState(); return c ? { x: c.x, y: c.y } : null }
  /** A viewport row's text, its first `upTo` columns. */
  rowText(y: number, upTo: number) { const l = this.s.line(y, "VIEWPORT"); if (!l) return ""; let i = 0; while (i < l.at.length && l.at[i] < upTo) i++; return l.text.slice(0, i) }
  /** Cursor keys in application mode (DECCKM). */
  get applicationCursor() { return this.s.mode(1) }
  focus() { this.textarea?.focus({ preventScroll: true }) }
  blur() { this.textarea?.blur() }
  private toBottom() { if (this.s.scrollbar().offset + this.rows < this.s.scrollbar().total) { this.s.scroll("bottom"); this.requestRender(true) } }

  private wireInput() {
    const ta = this.textarea
    let typedByKey = false, composedNow = ""
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts)
      this.off.push(() => el.removeEventListener(type, fn as EventListener, opts))
    }
    on(ta, "keydown", (e) => {
      typedByKey = false
      if (this.keyHook && this.keyHook(e) === false) return
      // ⌘C with a selection copies it (the field itself has nothing selected for the browser's copy).
      if (this.o.mac && e.metaKey && !e.ctrlKey && !e.altKey && e.code === "KeyC" && this.hasSelection()) { e.preventDefault(); this.o.onCopy(this.getSelection()); return }
      const out = keyBytes(this.s, e, this.o.mac)
      if (out === null) return
      e.preventDefault()
      typedByKey = true
      if (this.s.hasSelection()) this.s.clearSelection()
      this.input(out)
      this.blink()
    })
    on(ta, "keyup", (e) => { if (this.keyHook) this.keyHook(e) })
    // iOS's keyboard (keyCode 229) deletes and breaks lines by beforeinput, even in an empty field.
    on(ta, "beforeinput", (e) => {
      if (e.isComposing || typedByKey) return
      const t = e.inputType
      const out = t === "deleteContentBackward" ? (this.s.mode(67) ? "\b" : "\x7f") : t === "insertLineBreak" || t === "insertParagraph" ? "\r" : null
      if (out === null) return
      e.preventDefault()
      this.input(out)
    })
    on(ta, "input", (e) => {
      const ev = e as InputEvent
      if (ev.isComposing) return
      const data = ev.data ?? ta.value
      ta.value = ""
      if (!data || (composedNow && data === composedNow)) { composedNow = ""; return }
      if (ev.inputType === "insertText" || ev.inputType === "insertReplacementText" || ev.inputType === "insertFromDrop" || !ev.inputType) {
        this.s.clearSelection()
        this.input(data)
      }
    })
    on(ta, "compositionstart", () => { this.composing = ""; this.requestRender(true) })
    on(ta, "compositionupdate", (e) => { this.composing = e.data ?? ""; this.requestRender(true) })
    on(ta, "compositionend", (e) => {
      this.composing = ""
      ta.value = ""
      if (e.data) { composedNow = e.data; this.input(e.data); setTimeout(() => { composedNow = "" }, 0) }
      this.requestRender(true)
    })
    on(ta, "paste", (e) => {
      const text = e.clipboardData?.getData("text/plain")
      if (e.defaultPrevented || !text) return
      e.preventDefault()
      this.paste(text)
    })
    on(ta, "copy", (e) => {
      if (!this.hasSelection()) return
      e.preventDefault()
      e.clipboardData?.setData("text/plain", this.getSelection())
    })
    on(ta, "focus", () => { this.focused = true; this.emit(this.s.focus(true)); this.blink(); this.requestRender(true) })
    on(ta, "blur", () => { this.focused = false; this.emit(this.s.focus(false)); this.blink(); this.requestRender(true) })
  }

  // ---------- selection

  hasSelection() { return this.s.hasSelection() && !!this.s.selectionText() }
  getSelection() { return this.s.selectionText() }
  clearSelection() { this.s.clearSelection(); this.requestRender(true) }
  selectAll() { this.s.selectAll(); this.requestRender(true) }

  // ---------- the viewport

  /** Rows above the screen (history), the viewport's top among them and all of history and screen. */
  get viewport() { const b = this.s.scrollbar(); return { y: b.offset, base: Math.max(0, b.total - b.len), length: b.total } }
  scrollLines(n: number) { if (n) { this.s.scroll({ delta: n }); this.showScrollbar() } }
  scrollToBottom() { this.s.scroll("bottom"); this.requestRender(true) }
  scrollToRow(row: number) { this.s.scroll({ row }); this.requestRender(true) }
  private wheelRest = 0
  /** A wheel's or a swipe's movement (CSS px; `lines`: in rows): reported to a program that asked for the mouse, as
   *  arrow keys on the alternate screen (mode 1007), else the history scrolls. */
  wheel(delta: number, at: { x: number; y: number } | null, unit: "px" | "lines" = "px", shift = false) {
    this.wheelRest += unit === "lines" ? delta : delta / this.m.cssH
    const n = Math.trunc(this.wheelRest)
    if (!n) return
    this.wheelRest -= n
    if (this.s.mouseTracking && !shift && at) {
      for (let i = 0; i < Math.min(Math.abs(n), 10); i++) this.emit(this.s.mouse("press", n < 0 ? 4 : 5, 0, { x: at.x * this.m.dpr, y: at.y * this.m.dpr }, this.surface(), false))
      return
    }
    if (this.s.alternate && this.s.mode(1007)) {
      const seq = this.applicationCursor ? (n < 0 ? "\x1bOA" : "\x1bOB") : (n < 0 ? "\x1b[A" : "\x1b[B")
      this.emit(seq.repeat(Math.min(Math.abs(n), 10)))
      return
    }
    this.scrollLines(n)
  }
  /** The grid in device pixels, for the mouse encoder. */
  surface() { return { width: this.cols * this.m.w, height: this.rows * this.m.h, cellWidth: this.m.w, cellHeight: this.m.h } }
  /** A point of the page (client px) as a viewport cell, clamped; and the point in the grid (CSS px). */
  cellAt(clientX: number, clientY: number) {
    const r = this.screenEl.getBoundingClientRect(), px = clientX - r.left, py = clientY - r.top
    const x = Math.min(this.cols - 1, Math.max(0, Math.floor(px / this.m.cssW))), y = Math.min(this.rows - 1, Math.max(0, Math.floor(py / this.m.cssH)))
    return { x, y, px, py, inside: px >= 0 && py >= 0 && px < this.cols * this.m.cssW && py < this.rows * this.m.cssH }
  }

  // ---------- links

  registerLinkProvider(p: LinkProvider): Disposable { this.providers.add(p); return { dispose: () => this.providers.delete(p) } }
  /** The link at a viewport cell: OSC 8, then the providers', then a web address. */
  linkAt(x: number, vy: number): { link: Link; cells: { y: number; x1: number; x2: number }[] } | null {
    const top = this.s.scrollbar().offset, y = top + vy, row = this.view[vy]
    if (row) {
      const h = osc8At(this.s, row, x, vy, F_LINK)
      if (h) return { link: { text: h.uri, range: { start: { x: h.x1 + 1, y: y + 1 }, end: { x: h.x2 + 1, y: y + 1 } }, activate: (e) => this.o.onLink(e, h.uri) }, cells: [{ y: vy, x1: h.x1, x2: h.x2 }] }
    }
    const found: Link[] = []
    for (const p of this.providers) p.provideLinks(y + 1, (ls) => { if (ls) found.push(...ls) })
    found.push(...webLinks(this.s, y, (e, uri) => this.o.onLink(e, uri)))
    const hit = found.find((l) => {
      const a = l.range.start, b = l.range.end, cx = x + 1, cy = y + 1
      return (cy > a.y || (cy === a.y && cx >= a.x)) && (cy < b.y || (cy === b.y && cx <= b.x))
    })
    if (!hit) return null
    const cells: { y: number; x1: number; x2: number }[] = []
    for (let r = hit.range.start.y; r <= hit.range.end.y; r++) {
      const v = r - 1 - top
      if (v < 0 || v >= this.rows) continue
      cells.push({ y: v, x1: r === hit.range.start.y ? hit.range.start.x - 1 : 0, x2: r === hit.range.end.y ? hit.range.end.x - 1 : this.cols - 1 })
    }
    return { link: hit, cells }
  }

  // ---------- find

  /** Finds `spec` in its history and screen: `by` 0 looks again from the current match (else the newest), 1 the next one
   *  down, -1 up. The results go to `onResults`. */
  find(spec: FindSpec, by: 0 | 1 | -1, max: number, onResults: (r: { index: number; count: number }) => void) {
    const was = this.finding
    const same = was && was.spec.text === spec.text && was.spec.caseSensitive === spec.caseSensitive && was.spec.wholeWord === spec.wholeWord && was.spec.regexp === spec.regexp
    const matches = same && by ? was.matches : findAll(this.s, spec, max)
    let current = -1
    if (matches.length) {
      const prev = was?.matches[was.current]
      const kept = prev ? matches.findIndex((m) => m.start.x === prev.start.x && m.start.y === prev.start.y) : -1
      current = by === 0 ? (kept >= 0 ? kept : matches.length - 1) : ((kept >= 0 ? kept : by > 0 ? -1 : matches.length) + by + matches.length) % matches.length
    }
    clearTimeout(was?.timer)
    this.finding = { spec, matches, current, max, onResults, timer: 0 }
    if (current >= 0) this.reveal(matches[current])
    onResults({ index: current, count: matches.length })
    this.requestRender(true)
  }
  /** The terminal changed while finding: its matches again, soon. */
  private refind() {
    const f = this.finding!
    if (f.timer) return
    f.timer = window.setTimeout(() => {
      if (this.finding !== f) return
      f.timer = 0
      const prev = f.matches[f.current]
      f.matches = findAll(this.s, f.spec, f.max)
      const kept = prev ? f.matches.findIndex((m) => m.start.x === prev.start.x && m.end.y === prev.end.y) : -1
      f.current = kept >= 0 ? kept : f.matches.length ? f.matches.length - 1 : -1
      f.onResults({ index: f.current, count: f.matches.length })
      this.requestRender(true)
    }, 200)
  }
  private reveal(m: Match) {
    const b = this.s.scrollbar()
    if (m.start.y >= b.offset && m.end.y < b.offset + b.len) return
    this.s.scroll({ row: Math.max(0, m.start.y - Math.floor(b.len / 2)) })
  }
  clearFind() {
    if (!this.finding) return
    clearTimeout(this.finding.timer)
    this.finding = null
    this.s.searchFor(null)
    this.requestRender(true)
  }

  // ---------- for scripts and the app

  /** What it shows as text (`all`: its whole history too). */
  text(all = false) {
    if (all) return this.s.textFrom(0, false)
    if (this.stale) this.sync()
    return this.view.map((r) => r.text.join("").trimEnd()).join("\n")
  }
  /** What it shows, drawn now into a new canvas (a closing pane's fade, a dragged card). */
  picture() {
    if (!this.canvas?.width) return null
    this.renderNow()
    const c = document.createElement("canvas")
    c.width = this.canvas.width; c.height = this.canvas.height
    c.getContext("2d")?.drawImage(this.canvas, 0, 0)
    return c
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frame); clearTimeout(this.pumping); clearInterval(this.blinkTimer); clearTimeout(this.scrollbarTimer)
    if (this.finding) clearTimeout(this.finding.timer)
    for (const f of this.off) f()
    this.r?.dispose()
    this.element?.remove()
    this.s.dispose()
  }
}
