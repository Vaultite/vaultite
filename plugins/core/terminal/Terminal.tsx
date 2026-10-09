// The terminal view: xterm.js on a WebSocket to the shell, its own chunk, coloured from the app's tokens. On phones a
// tap brings up the keyboard and a row of the keys a phone's lacks sits above it.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ClipboardPaste, Copy } from "lucide-react"
import { Terminal as XTerm, type ITheme } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { WebglAddon } from "@xterm/addon-webgl"
import "@xterm/xterm/css/xterm.css"
import { agentOfTerminal, appShortcut, closeView, cn, isMac, KeyBar, keyboardBusy, keyboardUp, mintedHere, notifyError, openMenu, textSize, usePane, useTextSize, useTextSizeWheel, useVisibleArea } from "@vaultite"
import { closedJustNow, parkTerminal, register, touch, unparkTerminal } from "./sessions"

type RGBA = [number, number, number, number]

/** A CSS colour token as RGBA (whatever it's written as: hex, rgb(), color-mix()...). */
function resolver() {
  const el = document.createElement("span")
  el.style.display = "none"
  document.body.appendChild(el)
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!
  ctx.canvas.width = ctx.canvas.height = 1
  const read = (token: string): RGBA => {
    el.style.color = ""
    el.style.color = `var(${token})`
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = getComputedStyle(el).color
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return [r, g, b, a / 255]
  }
  return { read, done: () => el.remove() }
}

const hex = ([r, g, b, a]: RGBA) => "#" + [r, g, b, ...(a < 1 ? [Math.round(a * 255)] : [])].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")
/** a toward b by t (0..1), opaque. */
const mix = (a: RGBA, b: RGBA, t: number): RGBA => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t).concat(1) as RGBA

function theme(): ITheme {
  const { read, done } = resolver()
  const dark = document.documentElement.classList.contains("dark")
  const bg = read("--background"), fg = read("--foreground"), gray = read("--gray")
  const bright = (c: RGBA) => mix(c, fg, 0.25) // lighter on dark, darker on light
  const colour = (token: string) => { const c = read(token); return [hex(c), hex(bright(c))] }
  const [red, brightRed] = colour("--red"), [green, brightGreen] = colour("--green"), [yellow, brightYellow] = colour("--yellow")
  const [blue, brightBlue] = colour("--blue"), [magenta, brightMagenta] = colour("--purple"), [cyan, brightCyan] = colour("--teal")
  const sel = read("--primary")
  const out: ITheme = {
    background: hex(bg), foreground: hex(fg), cursor: hex(fg), cursorAccent: hex(bg),
    selectionBackground: hex([sel[0], sel[1], sel[2], 0.3]), selectionInactiveBackground: hex([gray[0], gray[1], gray[2], 0.25]),
    scrollbarSliderBackground: hex([gray[0], gray[1], gray[2], 0.25]), scrollbarSliderHoverBackground: hex([gray[0], gray[1], gray[2], 0.4]),
    scrollbarSliderActiveBackground: hex([gray[0], gray[1], gray[2], 0.5]),
    // Black and white are the page's own ends; on a light page "white" text is a grey that still reads.
    black: hex(dark ? mix(bg, fg, 0.22) : fg), brightBlack: hex(gray),
    white: hex(dark ? mix(bg, fg, 0.82) : mix(bg, fg, 0.5)), brightWhite: hex(dark ? fg : mix(bg, fg, 0.35)),
    red, brightRed, green, brightGreen, yellow, brightYellow, blue, brightBlue, magenta, brightMagenta, cyan, brightCyan,
  }
  done()
  return out
}

/** Puts text on this device's clipboard. Safari only allows it during a tap or key press, and a program's copy arrives
 *  a moment after the selection ends: then it's kept and written on the next one. */
let pendingCopy: string | null = null
function copy(text: string) {
  pendingCopy = text
  navigator.clipboard?.writeText(text).then(() => { if (pendingCopy === text) pendingCopy = null }, () => {})
}
const flushCopy = () => { if (pendingCopy !== null) copy(pendingCopy) }

/** OSC 52 (a program copying, like Claude Code's "copied to clipboard"): "c;<base64>". "?" asks to read it: ignored. */
function osc52(data: string) {
  const b64 = data.slice(data.indexOf(";") + 1)
  if (!b64 || b64 === "?") return true
  try { copy(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))) } catch { /* not base64 */ }
  return true
}

/** A file as base64 (for the socket). */
const base64 = (f: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(",") + 1))
  r.onerror = () => reject(r.error)
  r.readAsDataURL(f)
})

/** This device's clipboard, pasted into the terminal: an image goes to the server as a file (like a pasted screenshot),
 *  text is typed. iOS asks first (its own small Paste button); dismissed, nothing happens. */
async function readClipboard(t: XTerm, sendFiles: (files: File[]) => void) {
  const clip = navigator.clipboard
  if (!clip?.read) { const text = await clip?.readText(); if (text) t.paste(text); return }
  const files: File[] = []
  let text = ""
  for (const item of await clip.read()) {
    const image = item.types.find((type) => type.startsWith("image/"))
    if (image) files.push(new File([await item.getType(image)], `pasted.${image.split("/")[1] || "png"}`, { type: image }))
    else if (item.types.includes("text/plain")) text += await (await item.getType("text/plain")).text()
  }
  if (files.length) sendFiles(files)
  else if (text) t.paste(text)
}

const touchScreen = () => matchMedia("(pointer: coarse)").matches
/** The keys a phone's keyboard lacks, as the terminal sends them. Arrows follow the program's cursor-keys mode. */
const arrow = (t: XTerm, k: string) => (t.modes.applicationCursorKeysMode ? `\x1bO${k}` : `\x1b[${k}`)
const KEYS: { label: ReactNode; name: string; send: (t: XTerm) => string }[] = [
  { label: "esc", name: "Escape", send: () => "\x1b" },
  { label: "tab", name: "Tab", send: () => "\t" },
  { label: "⇧tab", name: "Shift Tab", send: () => "\x1b[Z" },
  { label: "⌃C", name: "Control C", send: () => "\x03" },
  { label: <ArrowLeft className="size-[17px]" strokeWidth={2} />, name: "Left", send: (t) => arrow(t, "D") },
  { label: <ArrowUp className="size-[17px]" strokeWidth={2} />, name: "Up", send: (t) => arrow(t, "A") },
  { label: <ArrowDown className="size-[17px]" strokeWidth={2} />, name: "Down", send: (t) => arrow(t, "B") },
  { label: <ArrowRight className="size-[17px]" strokeWidth={2} />, name: "Right", send: (t) => arrow(t, "C") },
]

/** The terminal's font size at 100% (its text size, Settings > Appearance, scales it: ⌘+scroll over it). */
const FONT = 13
const fontSize = (percent: number) => Math.max(6, Math.round(FONT * percent / 100))

const EXITED = 4000 // the server's close code: the shell ended
const REFUSED = 4003 // the server's close code: no shell for this page (it said why first)
const GONE = 4004 // the server's close code: asked only to attach, and the agent's session is gone

type Status = { kind: "live" } | { kind: "connecting"; tries: number } | { kind: "exited"; code: number; signal: number }
  | { kind: "refused"; reason: string }
  /** Another machine's shell, and that machine doesn't answer (or has no terminal): tried again, never started here. */
  | { kind: "away"; label: string; reason: string }

/** A terminal and its socket kept apart from its tab's view: a hidden tab's is parked still connected, so it comes back
 *  at once as it was. The last PARKED stay; the shell keeps running on the server either way. */
type Live = {
  id: string; t: XTerm; box: HTMLDivElement
  status: Status; mounted: boolean; ended: boolean; tmuxScroll: boolean
  /** The view showing it: its status, and closing its tab when the shell exits cleanly. */
  view: { status: (s: Status) => void; close: () => void } | null
  open: () => void; refit: () => void; send: (data: string | Uint8Array<ArrayBuffer>) => void
  /** Used here (focused, clicked, typed in, its window back in front): the shell takes this view's size again. */
  claim: () => void
  sendFiles: (files: File[]) => void; restart: () => void; dispose: () => void
}

const PARKED = 4
const parked = new Map<string, Live>() // oldest first

function letGo(l: Live) {
  if (parked.get(l.id) === l) { parked.delete(l.id); unparkTerminal(l.id) }
  l.dispose()
}

/** A parked terminal for this session, or a new one. */
function acquire(id: string): Live {
  const l = parked.get(id)
  if (!l) return create(id)
  parked.delete(id)
  unparkTerminal(id)
  return l
}

/** Its view is gone: parked, unless its tab closed, its shell ended or another one for this session is parked. */
function release(l: Live) {
  l.mounted = false
  l.view = null
  if (l.ended || closedJustNow(l.id) || parked.has(l.id)) return l.dispose()
  parked.set(l.id, l)
  parkTerminal(l.id, () => letGo(l))
  for (const old of parked.values()) if (parked.size > PARKED) letGo(old)
}

function create(id: string): Live {
  const t = new XTerm({
    fontFamily: "'SF Mono', ui-monospace, Menlo, 'DejaVu Sans Mono', 'Noto Sans Mono', 'Liberation Mono', 'Ubuntu Mono', monospace", fontSize: fontSize(textSize("terminal")), lineHeight: 1.15,
    cursorBlink: true, scrollback: 10000, allowProposedApi: false, theme: theme(),
  })
  const fit = new FitAddon()
  t.loadAddon(fit)
  t.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, "_blank", "noopener")))
  const box = document.createElement("div")
  box.style.width = box.style.height = "100%"
  const osc = t.parser.registerOscHandler(52, osc52)
  // The app's shortcuts win over the shell, except ⌃ + a letter (⌃C, ⌃R): let through, the key reaches the app.
  // ⇧↩ is a new line in an agent's prompt: ESC + return, as a terminal set up for Claude Code sends it.
  t.attachCustomKeyEventHandler((e) => {
    if (e.key === "Enter" && e.shiftKey && !(e.ctrlKey || e.metaKey || e.altKey)) {
      if (e.type === "keydown") { e.preventDefault(); if (!replaying) send(enc.encode("\x1b\r")) }
      return false
    }
    // Off a Mac, ⌃⇧C copies and ⌃⇧V pastes (the browser's paste event, which xterm.js takes), as terminals there do.
    if (!isMac && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && (e.code === "KeyC" || e.code === "KeyV")) {
      if (e.type === "keydown") {
        e.stopPropagation()
        if (e.code === "KeyC") { e.preventDefault(); if (t.hasSelection()) copy(t.getSelection()) }
      }
      return false
    }
    return e.type !== "keydown" || !(e.ctrlKey || e.metaKey || e.altKey)
      || (e.ctrlKey && !e.metaKey && /^Key[A-Z]$/.test(e.code)) || !appShortcut(e)
  })
  // Recolour with the app: the theme is the .dark class, the scheme data-scheme, both on <html>.
  const mo = new MutationObserver(() => { t.options.theme = theme() })
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-scheme"] })

  let ws: WebSocket | null = null, timer = 0, tries = 0, gone = false, exited = false, refused = false, opened = false
  // Only the tab that made this id starts its session; one put back (a reload, the app reopened) only attaches, so an
  // agent whose session is gone isn't started again by itself (the server says "gone"; Start a new one starts it).
  let attachOnly = !mintedHere(id), sessionGone = false
  let away: { label: string; reason: string } | null = null
  const enc = new TextEncoder()
  const setStatus = (st: Status) => { l.status = st; l.view?.status(st) }
  /** Its shell ended or it was refused while no view shows it: nothing to keep it for. */
  const over = () => { l.ended = true; if (!l.mounted) letGo(l) }
  /** Its shell exited cleanly or was ended for good: its tab closes, shown or not. */
  const closeIt = () => { l.ended = true; if (l.view) return l.view.close(); closeView(`terminal/${id}`); over() }
  // The replay after a reattach holds programs' old questions to the terminal; answered again, the answers would reach
  // the shell as typing and swallow keys until Enter, so replies aren't sent while it's drawn.
  let replayNext = false, replaying = false
  // The shell's size, as the server last said: another device (the phone) may have made it its own.
  let shell = { cols: 0, rows: 0 }

  const connect = () => {
    exited = false; refused = false; sessionGone = false; away = null; l.ended = false
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminal/${encodeURIComponent(id)}?cols=${t.cols}&rows=${t.rows}${attachOnly ? "&attach=1" : ""}`
    const sock = new WebSocket(url)
    sock.binaryType = "arraybuffer"
    ws = sock
    sock.onmessage = (e) => {
      if (typeof e.data !== "string") {
        if (!replayNext) return t.write(new Uint8Array(e.data as ArrayBuffer))
        replayNext = false; replaying = true
        return t.write(new Uint8Array(e.data as ArrayBuffer), () => { replaying = false })
      }
      let msg: { t?: string; fresh?: boolean; tmux?: boolean; code?: number; signal?: number; reason?: string; path?: string; machine?: string; label?: string; cols?: number; rows?: number; ended?: boolean }
      try { msg = JSON.parse(e.data) } catch { return }
      if (msg.t === "size") {
        shell = { cols: msg.cols ?? 0, rows: msg.rows ?? 0 }
      } else if (msg.t === "uploaded" && msg.path) {
        // A pasted or dropped file, now on the server's machine: its path, as if pasted (Claude Code attaches images).
        t.paste(`${msg.path} `)
      } else if (msg.t === "attached") {
        tries = 0
        attachOnly = true // reconnecting (the server restarted) never starts it again
        t.reset() // what the shell printed comes again (the replay), or it's a new shell
        replayNext = !msg.fresh
        l.tmuxScroll = !!msg.tmux
        setStatus({ kind: "live" })
      } else if (msg.t === "unreachable") {
        away = { label: msg.label || msg.machine || "another machine", reason: msg.reason || "isn't answering" }
      } else if (msg.t === "refused") {
        refused = true
        setStatus({ kind: "refused", reason: msg.reason ?? "" })
        over()
      } else if (msg.t === "gone") {
        // An agent's session that ended while this tab was away (ended for good, died, the machine restarted): its tab
        // closes, there's nothing in it to see.
        sessionGone = true
        return closeIt()
      } else if (msg.t === "exit") {
        exited = true
        // A clean exit (exit, ⌃D), one ended for good (End session, vau terminal end) or an agent's that died closes
        // the tab; a plain shell's failure stays, with its output and Restart.
        if (msg.ended || (!msg.code && !msg.signal) || agentOfTerminal(id)) return closeIt()
        setStatus({ kind: "exited", code: msg.code ?? 0, signal: msg.signal ?? 0 })
        over()
      }
    }
    sock.onclose = (e) => {
      if (ws !== sock || gone) return
      ws = null
      // Refused: retrying won't help, so it stops and says why.
      if (refused || e.code === REFUSED) { if (!refused) { setStatus({ kind: "refused", reason: "" }); over() } return }
      if (sessionGone || e.code === GONE) { if (!sessionGone) closeIt(); return }
      if (exited || e.code === EXITED) { if (!exited) { setStatus({ kind: "exited", code: -1, signal: 0 }); over() } return }
      // Dropped (the server restarted, the machine slept), or its machine isn't answering: try again, slower each time.
      tries++
      setStatus(away ? { kind: "away", ...away } : { kind: "connecting", tries })
      timer = window.setTimeout(connect, Math.min(away ? 15000 : 10000, 400 * 2 ** Math.min(tries, 5)))
    }
  }

  const send = (data: string | Uint8Array<ArrayBuffer>) => { if (ws?.readyState === WebSocket.OPEN) ws.send(data) }
  const onData = t.onData((d) => { if (!replaying) send(enc.encode(d)) })
  const onBinary = t.onBinary((d) => { if (!replaying) send(Uint8Array.from(d, (c) => c.charCodeAt(0) & 255)) })
  const onResize = t.onResize(() => send(JSON.stringify({ t: "resize", cols: t.cols, rows: t.rows })))

  // Files pasted or dropped (a screenshot) go to the server, since the shell there can't read this device's clipboard.
  const sendFiles = (files: File[]) => {
    for (const f of files) {
      if (f.size > 20 << 20) { t.write(`\r\n${f.name}: over 20 MB, not sent\r\n`); continue }
      base64(f).then((data) => send(JSON.stringify({ t: "upload", name: f.name || `pasted.${f.type.split("/")[1] || "png"}`, data })), () => {})
    }
  }
  const onPaste = (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files ?? [])
    if (!files.length) return // text: xterm.js pastes it
    e.preventDefault(); e.stopImmediatePropagation()
    sendFiles(files)
  }
  const onDragOver = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault() }
  const onDrop = (e: DragEvent) => {
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (!files.length) return
    e.preventDefault()
    sendFiles(files)
    t.focus()
  }
  // A shell in tmux only ever sees tmux redraw its screen, so xterm.js's scrollback is near empty: the wheel is taken
  // before xterm.js sees it and sent to tmux as whole lines, once a frame.
  let wheelRest = 0, wheelLines = 0, wheelFrame = 0
  const onWheel = (e: WheelEvent) => {
    if (!l.tmuxScroll || e.ctrlKey) return // ⌃ + wheel: the browser's zoom
    e.preventDefault(); e.stopPropagation()
    const cell = box.clientHeight / t.rows || 16
    wheelRest += e.deltaMode === 1 ? e.deltaY : e.deltaMode === 2 ? e.deltaY * t.rows : e.deltaY / cell
    const n = Math.trunc(wheelRest)
    if (!n) return
    wheelRest -= n; wheelLines -= n // down the page is up the history
    wheelFrame ||= requestAnimationFrame(() => {
      wheelFrame = 0
      if (wheelLines) send(JSON.stringify({ t: "scroll", lines: wheelLines }))
      wheelLines = 0
    })
  }
  // One shell, one size, the last device's: drawn for the phone, it's garbled here until this view sends its own back.
  const claim = () => {
    if (!l.mounted || !box.clientWidth || ws?.readyState !== WebSocket.OPEN) return
    l.refit()
    if (shell.cols && (shell.cols !== t.cols || shell.rows !== t.rows)) send(JSON.stringify({ t: "resize", cols: t.cols, rows: t.rows }))
  }
  const onFocus = () => { touch(id); claim() }
  box.addEventListener("wheel", onWheel, { capture: true, passive: false })
  box.addEventListener("paste", onPaste, true)
  // (marked so the desktop app's window doesn't take the drop first and open the file in a tab: core/desktop.ts)
  box.dataset.fileDrop = ""
  box.addEventListener("dragover", onDragOver)
  box.addEventListener("drop", onDrop)
  box.addEventListener("pointerdown", flushCopy, true)
  box.addEventListener("keydown", flushCopy, true)
  box.addEventListener("pointerdown", claim, true)
  box.addEventListener("keydown", claim, true)
  // Back to this window (another app, the phone put down) or this tab of the browser: what it shows takes its size.
  const onShown = () => { if (document.visibilityState === "visible") claim() }
  window.addEventListener("focus", onShown)
  document.addEventListener("visibilitychange", onShown)

  const l: Live = {
    id, t, box, status: { kind: "connecting", tries: 0 }, mounted: false, ended: false, tmuxScroll: false, view: null, send, sendFiles, claim,
    // Once its box is in the page (xterm.js measures its cells there).
    open: () => {
      if (opened) return
      opened = true
      t.open(box)
      // WebGL: the DOM renderer measures each new glyph in the page (a whole-app layout each time), holding a first screen
      // back 150-500 ms. Without WebGL, or when its context is lost, it falls back to the DOM renderer.
      try {
        const gl = new WebglAddon()
        gl.onContextLoss(() => gl.dispose())
        t.loadAddon(gl)
      } catch { /* no WebGL here: the DOM renderer */ }
      t.textarea?.addEventListener("focus", onFocus)
      l.refit()
      connect()
    },
    refit: () => { try { fit.fit() } catch { /* not laid out */ } },
    // Restart, Try again, Start a new one: the user asks for it, so it may start the session.
    restart: () => { clearTimeout(timer); attachOnly = false; t.reset(); setStatus({ kind: "connecting", tries: 0 }); connect(); t.focus() },
    dispose: () => {
      if (gone) return
      gone = true
      clearTimeout(timer); cancelAnimationFrame(wheelFrame)
      mo.disconnect(); osc.dispose(); onData.dispose(); onBinary.dispose(); onResize.dispose()
      t.textarea?.removeEventListener("focus", onFocus)
      window.removeEventListener("focus", onShown)
      document.removeEventListener("visibilitychange", onShown)
      ws?.close() // the shell keeps running: reopening the tab reattaches
      t.dispose()
      box.remove()
    },
  }
  return l
}

export default function TerminalView({ id, focused, close }: { id: string; focused: boolean; close: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const live = useRef<Live | null>(null)
  const [status, setStatus] = useState<Status>({ kind: "connecting", tries: 0 })
  const [restarts, setRestarts] = useState(0)
  const closeTab = useRef(close)
  closeTab.current = close
  // Touch screens; phones (no pane) also fill the visible part of the screen while the terminal has the keyboard.
  const [touchUi] = useState(touchScreen)
  const inPane = usePane().group !== ""
  const phone = touchUi && !inPane
  const [typing, setTyping] = useState(false)
  const area = useVisibleArea(phone && typing)
  const pageAt = useRef(0) // where the page was scrolled before the keyboard came up
  const touchActions = useRef({ key: (_send: (t: XTerm) => string) => {}, paste: () => {}, hide: () => {} })
  // Its own text size, apart from the app's zoom: ⌘ (or ⌃) and the wheel, or a pinch, over it, before the terminal
  // scrolls with it.
  const size = useTextSize("terminal")
  useTextSizeWheel(host, "terminal", true)
  useEffect(() => {
    const l = live.current
    if (!l || l.t.options.fontSize === fontSize(size)) return
    l.t.options.fontSize = fontSize(size)
    l.refit()
  }, [size])

  // The session's terminal: a parked one comes back as it was, else a new one connects.
  useEffect(() => {
    const el = host.current!
    const l = acquire(id)
    live.current = l
    const t = l.t
    el.appendChild(l.box)
    l.mounted = true
    l.view = { status: setStatus, close: () => closeTab.current() }
    setStatus(l.status)
    if (t.options.fontSize !== fontSize(textSize("terminal"))) t.options.fontSize = fontSize(textSize("terminal"))
    l.open()
    l.refit() // this pane may be another size than where it was parked
    // What it shows, as text, for scripts (web/qa): with WebGL the screen is a canvas, not rows of text.
    Object.defineProperty(el, "terminalText", { configurable: true, value: () => {
      const b = t.buffer.active, lines: string[] = []
      for (let y = 0; y < t.rows; y++) lines.push(b.getLine(b.viewportY + y)?.translateToString(true) ?? "")
      return lines.join("\n")
    } })
    let frame = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => l.refit())
    })
    ro.observe(el)

    // Touch: xterm.js neither scrolls nor focuses on a touch, so it's done here: a tap focuses (during the touch, the only
    // time iOS shows the keyboard), a long press opens the menu, a swipe scrolls like a wheel and glides on.
    let start: { x: number; y: number } | null = null, press = 0, pressed = false
    let swiping = false, lastY = 0, lastT = 0, speed = 0, glide = 0
    const menu = (at: { x: number; y: number }) => openMenu(at, [
      { label: "Paste", icon: ClipboardPaste, run: () => touchActions.current.paste() },
      ...(t.hasSelection() ? [{ label: "Copy", icon: Copy, run: () => copy(t.getSelection()) }] : []),
    ])
    const wheel = (deltaY: number, x: number, y: number) => t.element?.querySelector(".xterm-screen")
      ?.dispatchEvent(new WheelEvent("wheel", { deltaY, deltaMode: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }))
    const onTouchStart = (e: TouchEvent) => {
      clearTimeout(press); cancelAnimationFrame(glide)
      pressed = false; swiping = false
      if (e.touches.length !== 1) { start = null; return }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      lastY = start.y; lastT = e.timeStamp; speed = 0
      press = window.setTimeout(() => { if (start) { pressed = true; menu(start) } }, 500)
    }
    const onTouchMove = (e: TouchEvent) => {
      const p = e.touches[0]
      if (!p || e.touches.length !== 1) return
      if (start && Math.hypot(p.clientX - start.x, p.clientY - start.y) > 10) {
        swiping = Math.abs(p.clientY - start.y) > Math.abs(p.clientX - start.x)
        start = null; clearTimeout(press)
      }
      if (!swiping) return
      if (e.cancelable) e.preventDefault() // the terminal scrolls, not the page
      const dy = lastY - p.clientY, dt = Math.max(1, e.timeStamp - lastT)
      speed = 0.8 * (dy / dt) + 0.2 * speed
      lastY = p.clientY; lastT = e.timeStamp
      if (dy) wheel(dy, p.clientX, p.clientY)
    }
    const onTouchCancel = () => { start = null; swiping = false; clearTimeout(press) }
    const onTouchEnd = (e: TouchEvent) => {
      clearTimeout(press)
      if (swiping) {
        swiping = false
        const x = e.changedTouches[0]?.clientX ?? 0, y = lastY
        let v = speed * 16 // px per frame
        const step = () => { if (Math.abs(v) < 0.5) return; wheel(v, x, y); v *= 0.95; glide = requestAnimationFrame(step) }
        if (e.timeStamp - lastT < 80) glide = requestAnimationFrame(step)
        return
      }
      if (!start) return
      start = null
      if (e.cancelable) e.preventDefault() // no mouse events or double-tap zoom after it (they'd close the menu)
      if (pressed) return
      const ta = t.textarea
      if (document.activeElement !== ta) pageAt.current = scrollY
      else if (!keyboardUp()) ta?.blur()
      t.focus()
    }
    // While it has the keyboard (phones: fills the screen). A blur that's only the tap above refocusing doesn't count.
    let blurTimer = 0
    const onTyping = () => { clearTimeout(blurTimer); setTyping(true) }
    const onStopTyping = () => { clearTimeout(blurTimer); blurTimer = window.setTimeout(() => setTyping(document.activeElement === t.textarea), 60) }
    touchActions.current = {
      key: (seq) => t.input(seq(t)),
      paste: () => void readClipboard(t, l.sendFiles).catch((e) => { if ((e as Error)?.name !== "NotAllowedError") notifyError(e, "Couldn't paste") }),
      hide: () => t.blur(),
    }
    if (touchUi) {
      el.addEventListener("touchstart", onTouchStart, { capture: true, passive: true })
      el.addEventListener("touchmove", onTouchMove, { capture: true, passive: false })
      el.addEventListener("touchend", onTouchEnd, { capture: true, passive: false })
      el.addEventListener("touchcancel", onTouchCancel, { capture: true, passive: true })
      t.textarea?.addEventListener("focus", onTyping)
      t.textarea?.addEventListener("blur", onStopTyping)
    }
    const unregister = register({ id, end: () => l.send(JSON.stringify({ t: "close" })) })

    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect(); unregister()
      el.removeEventListener("touchstart", onTouchStart, true)
      el.removeEventListener("touchmove", onTouchMove, true)
      el.removeEventListener("touchend", onTouchEnd, true)
      el.removeEventListener("touchcancel", onTouchCancel, true)
      t.textarea?.removeEventListener("focus", onTyping)
      t.textarea?.removeEventListener("blur", onStopTyping)
      clearTimeout(press); clearTimeout(blurTimer); cancelAnimationFrame(glide)
      if (t.textarea === document.activeElement) t.blur()
      l.box.remove()
      live.current = null
      release(l)
    }
  }, [id])

  // Touch screens don't focus it by themselves (iOS wouldn't show a keyboard), and it never takes the keyboard from
  // someone else's: a late-attaching terminal would swallow what's typed into a palette.
  useEffect(() => {
    if (!focused) return
    const l = live.current
    if (!touchUi && l && !keyboardBusy(l.box)) l.t.focus()
    l?.claim(); touch(id)
  }, [focused, id, restarts, touchUi])

  // Phones: when the keyboard goes, the page goes back to where it was before it came up (Safari scrolls it to show
  // what has the focus).
  const full = phone && typing && !!area
  useLayoutEffect(() => (full ? () => scrollTo(0, pageAt.current) : undefined), [full])

  const restart = () => { live.current?.restart(); setRestarts((n) => n + 1) }
  return (
    <div className={cn("flex flex-col bg-background", full ? "fixed inset-x-0 z-40 pt-[env(safe-area-inset-top)]" : "relative h-full min-h-[240px] w-full",
      full && !area.keyboard && "pb-[env(safe-area-inset-bottom)]")}
      style={full ? { top: area.top, height: area.height } : undefined}>
      {/* (isolate: xterm.js's layers' z-indexes stay inside, under the bars below; WebGL's canvases would cover them) */}
      <div className="isolate min-h-0 flex-1 pl-3 pr-1 pt-2 pb-1">
        {/* Touch: no browser text selection or callout on a long press (the terminal's menu opens instead), and the
            keyboard's hidden field at 16px, or iOS zooms the page in when it's focused. */}
        <div ref={host} data-terminal={id} className={cn("h-full w-full", touchUi && "select-none [-webkit-touch-callout:none] [&_.xterm-helper-textarea]:!text-[16px]")} />
      </div>
      {full && <KeyBar label="Terminal keys" hide={() => touchActions.current.hide()} keys={[
        ...KEYS.map((k) => ({ name: k.name, label: k.label, run: () => touchActions.current.key(k.send) })),
        { name: "Paste", label: <ClipboardPaste className="size-[17px]" strokeWidth={2} />, run: () => touchActions.current.paste() },
      ]} />}
      {status.kind === "connecting" && status.tries > 0 && (
        <div className="pointer-events-none absolute top-2 right-4 rounded-[6px] border border-border bg-card px-2 py-1 text-[12px] text-muted-foreground">
          Reconnecting…
        </div>
      )}
      {status.kind === "away" && (
        <EndBar role="status" away onRestart={restart} action="Try now">This terminal runs on {status.label}, which {status.reason}. Trying again…</EndBar>
      )}
      {status.kind === "refused" && <EndBar role="alert" onRestart={restart} action="Try again">No shell here: {status.reason || "the server refused this page"}.</EndBar>}
      {status.kind === "exited" && (
        <EndBar onRestart={restart} action="Restart">
          {status.code === -1 ? "The shell couldn't start" : `Process exited${status.signal ? ` (signal ${status.signal})` : status.code ? ` with code ${status.code}` : ""}`}
        </EndBar>
      )}
    </div>
  )
}

/** The bar at a terminal's foot when its shell isn't running: why, and the way on. */
function EndBar({ role, away, action, onRestart, children }: { role?: "status" | "alert"; away?: boolean; action: string; onRestart: () => void; children: ReactNode }) {
  return (
    <div role={role} data-terminal-away={away || undefined} className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t border-border bg-card px-4 py-2 text-[13px]">
      <span className="min-w-0 text-muted-foreground">{children}</span>
      <button type="button" onClick={onRestart} className="shrink-0 cursor-pointer rounded-[6px] bg-primary px-2.5 py-1 text-[13px] font-medium text-primary-foreground hover:opacity-90">{action}</button>
    </div>
  )
}
