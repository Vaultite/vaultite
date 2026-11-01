// The terminal view: xterm.js on a WebSocket to the shell, its own chunk, coloured from the app's tokens. On phones a
// tap brings up the keyboard and a row of the keys a phone's lacks sits above it.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ClipboardPaste, Copy, TextSelect } from "lucide-react"
import { Terminal as XTerm, type ITheme } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { WebglAddon } from "@xterm/addon-webgl"
import "@xterm/xterm/css/xterm.css"
import { agentOfTerminal, appShortcut, askedAt, closeView, cn, isMac, isWindows, KeyBar, keyboardBusy, keyboardUp, keyHint, linkClick, mintedHere, notifyError, offerPicture, onLook, openMenu, openPermissions, openWebLink, pastedFiles, pluginSettings, span, textSize, usePane, useTextSize, useTextSizeWheel, useVisibleArea } from "@vaultite"
import { countText, FindField, FindTools, floatingBar, MAX, type FindOptions } from "@plugins/find/tools"
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

/** Translucent pages (appearance `translucentPages`): the terminal draws no ground, the pane's glass shows through. */
const glassy = () => { const r = document.documentElement; return r.hasAttribute("data-translucent") && r.hasAttribute("data-translucent-pages") }

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
    background: glassy() ? "#00000000" : hex(bg), foreground: hex(fg), cursor: hex(fg), cursorAccent: hex(bg),
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

/** How a find in the terminal lights its matches: as a note's find bar does, in the app's yellow, the current one
 *  orange (opaque: the search addon wants #RRGGBB). */
function findLook(): NonNullable<ISearchOptions["decorations"]> {
  const { read, done } = resolver()
  const bg = read("--background"), yellow = read("--yellow"), orange = read("--orange")
  const out = { matchBackground: hex(mix(bg, yellow, 0.32)), matchOverviewRuler: hex(yellow),
    activeMatchBackground: hex(mix(bg, orange, 0.5)), activeMatchBorder: hex(orange), activeMatchColorOverviewRuler: hex(orange) }
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

/** How much drawn output a page tells the server about at once (plugin.ts paces the shell by it). */
const ACK = 128 << 10

/** How much of a pasted file goes in one message. */
const PIECE = 1 << 20

/** A file (or a piece of one) as base64 (for the socket). */
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

/** The app's monospace font (Settings' Monospace font, else the app's default), which terminals share with code. */
const codeFont = () => getComputedStyle(document.documentElement).getPropertyValue("--font-code").trim() || "monospace"

const settings = pluginSettings<{ cursor?: string; cursorBlink?: boolean }>("terminal")
/** The cursor as the plugin's settings have it. Without the keyboard a block is an outline, the others keep their shape
 *  (so the palette's picker shows them on a terminal behind it). */
function cursor() {
  const s = settings.get()
  const style = s.cursor === "bar" || s.cursor === "underline" ? s.cursor : "block"
  return { cursorStyle: style, cursorInactiveStyle: style === "block" ? "outline" : style, cursorBlink: s.cursorBlink !== false } as const
}
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

type Status = { kind: "live"; /** macOS keeps it from its agent's folder (the server checked). */ blocked?: boolean } | { kind: "connecting"; tries: number } | { kind: "exited"; code: number; signal: number }
  /** An agent's session that ended by itself (or after its report): the tab stays, with Restart. */
  | { kind: "ended" }
  | { kind: "refused"; reason: string }
  /** Another machine's shell, and that machine doesn't answer (or has no terminal): tried again, never started here. */
  | { kind: "away"; label: string; reason: string }

/** A terminal and its socket kept apart from its tab's view: a hidden tab's is parked still connected, so it comes back
 *  at once as it was. The last PARKED stay; the shell keeps running on the server either way. */
type Live = {
  id: string; t: XTerm; box: HTMLDivElement; search: SearchAddon
  /** What its find bar looked for last: shown again when it's opened again. */
  find: { text: string } & FindOptions
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
  // How long it took to show its shell, from when it was asked for (else from now: a tab put back), part by part.
  const asked = askedAt(id), opening = span("terminal.open", { agent: agentOfTerminal(id)?.name ?? "shell", how: asked === undefined ? "shown" : "asked" }, asked)
  if (asked !== undefined) opening.mark("tab")
  const t = new XTerm({
    fontFamily: codeFont(), fontSize: fontSize(textSize("terminal")), lineHeight: 1.15,
    // (the search addon lights matches with decorations, still a proposed API)
    ...cursor(), scrollback: 10000, allowProposedApi: true, theme: theme(),
    // Links go where notes' do (the Browser when it's on, ⌘-click the system browser); OSC 8 ones (ls, gh) too.
    linkHandler: { activate: (e, uri) => { if (/^https?:/i.test(uri)) openWebLink(uri, linkClick(e)) } },
  })
  const fit = new FitAddon()
  t.loadAddon(fit)
  t.loadAddon(new WebLinksAddon((e, uri) => openWebLink(uri, linkClick(e))))
  const search = new SearchAddon({ highlightLimit: MAX })
  t.loadAddon(search)
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
    // Windows, as Windows Terminal: Ctrl+C copies a selection (else it's ^C) and Ctrl+V pastes.
    if (isWindows && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && (e.code === "KeyV" || (e.code === "KeyC" && t.hasSelection()))) {
      if (e.type === "keydown") {
        e.stopPropagation()
        if (e.code === "KeyC") { e.preventDefault(); copy(t.getSelection()); t.clearSelection() }
      }
      return false
    }
    // Off a Mac ⌃⇧ + a letter types nothing in a shell, so the app may have it (⌃⇧F finds in the terminal).
    return e.type !== "keydown" || !(e.ctrlKey || e.metaKey || e.altKey)
      || (e.ctrlKey && !e.metaKey && /^Key[A-Z]$/.test(e.code) && (isMac || !e.shiftKey)) || !appShortcut(e)
  })
  // Recolour with the app (its scheme, light or dark, a theme or snippet), and take its monospace font.
  const offLook = onLook(() => {
    t.options.theme = theme()
    if (t.options.fontFamily !== codeFont()) { t.options.fontFamily = codeFont(); try { fit.fit() } catch { /* not laid out */ } }
    renderer()
  })
  const offSettings = settings.onChange(() => Object.assign(t.options, cursor()))

  let ws: WebSocket | null = null, timer = 0, tries = 0, gone = false, exited = false, refused = false, opened = false
  // WebGL: the DOM renderer lays out the whole app per new glyph (a first screen 150-500 ms late). The DOM one without
  // WebGL, after a lost context, and under translucent pages (WebGL draws text on a see-through ground thin and ragged).
  let gl: WebglAddon | null = null, glLost = false
  const renderer = () => {
    if (!opened || (glassy() ? !gl : gl || glLost)) return
    if (gl) { gl.dispose(); gl = null } else try {
      const g = new WebglAddon()
      g.onContextLoss(() => { glLost = true; g.dispose(); if (gl === g) gl = null })
      t.loadAddon(g)
      gl = g
    } catch { glLost = true /* no WebGL here */ }
    try { fit.fit() } catch { /* not laid out */ } // (their cells may differ by a fraction)
  }
  // What it shows, for a closing pane's fade or a dragged card: WebGL's canvas reads back empty once shown, so it's
  // drawn again now (xterm.js's own render, not public: if it moves, the copy shows the ground as before).
  const picture = (screen: HTMLElement) => {
    if (!gl) return null
    const rs = (t as unknown as { _core?: { _renderService?: { _renderRows?: (a: number, b: number) => void } } })._core?._renderService
    const layers = [...screen.querySelectorAll("canvas")]
    if (!rs?._renderRows || !layers[0]?.width) return null
    rs._renderRows(0, t.rows - 1)
    const c = document.createElement("canvas")
    c.width = layers[0].width; c.height = layers[0].height
    const g = c.getContext("2d")
    for (const layer of layers) g?.drawImage(layer, 0, 0, c.width, c.height)
    return c
  }
  // Only the tab that made this id starts its session; one put back (a reload, the app reopened) only attaches, so an
  // agent whose session is gone isn't started again by itself (the server says "gone"; Restart starts it).
  let attachOnly = !mintedHere(id), sessionGone = false
  let away: { label: string; reason: string } | null = null
  const enc = new TextEncoder()
  const setStatus = (st: Status) => { l.status = st; l.view?.status(st) }
  /** Its shell ended or it was refused while no view shows it: nothing to keep it for. */
  const over = () => { l.ended = true; if (!l.mounted) letGo(l) }
  /** Its shell exited cleanly or was ended for good (End session, its tab closed): its tab closes, shown or not. */
  const closeIt = () => { l.ended = true; if (l.view) return l.view.close(); closeView(`terminal/${id}`); over() }
  // The replay after a reattach holds programs' old questions to the terminal; answered again, the answers would reach
  // the shell as typing and swallow keys until Enter, so replies aren't sent while it's drawn.
  let replayNext = false, replaying = false
  // The shell's size, as the server last said: another device (the phone) may have made it its own.
  let shell = { cols: 0, rows: 0 }

  let shown = false
  const firstOutput = () => { if (shown) return; shown = true; opening.mark("first output"); opening.end() }

  const connect = () => {
    exited = false; refused = false; sessionGone = false; away = null; l.ended = false
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminal/${encodeURIComponent(id)}?cols=${t.cols}&rows=${t.rows}&dark=${document.documentElement.classList.contains("dark") ? 1 : 0}${attachOnly ? "&attach=1" : ""}`
    const sock = new WebSocket(url)
    sock.binaryType = "arraybuffer"
    ws = sock
    sock.onopen = () => opening.mark("socket")
    // What it has drawn, told back a piece at a time: the server holds the shell's output while this page is far behind,
    // so a flood stays a screenful away from ⌃C rather than megabytes.
    let drawn = 0
    const parsed = (n: number) => () => {
      if ((drawn += n) < ACK || ws !== sock) return
      send(JSON.stringify({ t: "ack", n: drawn }))
      drawn = 0
    }
    sock.onmessage = (e) => {
      if (typeof e.data !== "string") {
        const bytes = new Uint8Array(e.data as ArrayBuffer), done = parsed(bytes.length)
        if (!replayNext) return t.write(bytes, shown ? done : () => { firstOutput(); done() })
        replayNext = false; replaying = true
        return t.write(bytes, () => { replaying = false; firstOutput(); done() })
      }
      let msg: { t?: string; fresh?: boolean; tmux?: boolean; started?: string; code?: number; signal?: number; reason?: string; path?: string; machine?: string; label?: string; cols?: number; rows?: number; ended?: boolean
        scrollback?: number }
      try { msg = JSON.parse(e.data) } catch { return }
      if (msg.t === "size") {
        shell = { cols: msg.cols ?? 0, rows: msg.rows ?? 0 }
      } else if (msg.t === "uploaded" && msg.path) {
        // A pasted or dropped file, now on the server's machine: its path, as if pasted (Claude Code attaches images).
        t.paste(`${msg.path} `)
      } else if (msg.t === "attached") {
        opening.mark("attached")
        if (msg.started) opening.tags.server = msg.started
        tries = 0
        attachOnly = true // reconnecting (the server restarted) never starts it again
        // (as many lines as its shell keeps, the setting on the machine it runs on: the replay is all of them)
        if (msg.scrollback && msg.scrollback !== t.options.scrollback) t.options.scrollback = msg.scrollback
        t.reset() // what the shell printed comes again (the replay), or it's a new shell
        replayNext = !msg.fresh
        l.tmuxScroll = !!msg.tmux
        setStatus({ kind: "live" })
      } else if (msg.t === "blocked") {
        setStatus({ kind: "live", blocked: true })
      } else if (msg.t === "unreachable") {
        away = { label: msg.label || msg.machine || "another machine", reason: msg.reason || "isn't answering" }
      } else if (msg.t === "refused") {
        refused = true
        setStatus({ kind: "refused", reason: msg.reason ?? "" })
        over()
      } else if (msg.t === "gone") {
        // An agent's session that ended while this tab was away: ended for good, its tab closes; ended by itself (died,
        // the machine restarted), the tab stays saying so, with Restart.
        sessionGone = true
        if (msg.ended) return closeIt()
        setStatus({ kind: "ended" })
        over()
      } else if (msg.t === "exit") {
        exited = true
        // Ended for good (End session, vau terminal end) or a clean exit (exit, ⌃D; an agent's too) closes the tab; an
        // agent's session that died stays, saying so, and a shell's failure with its output, both with Restart.
        if (msg.ended || (!msg.code && !msg.signal)) return closeIt()
        setStatus(agentOfTerminal(id) ? { kind: "ended" } : { kind: "exited", code: msg.code ?? 0, signal: msg.signal ?? 0 })
        over()
      }
    }
    sock.onclose = (e) => {
      if (ws !== sock || gone) return
      ws = null
      // Refused: retrying won't help, so it stops and says why.
      if (refused || e.code === REFUSED) { if (!refused) { setStatus({ kind: "refused", reason: "" }); over() } return }
      if (sessionGone || e.code === GONE) { if (!sessionGone) { setStatus({ kind: "ended" }); over() } return }
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

  // Files pasted or dropped (a screenshot) go to the server, since the shell there can't read this device's clipboard: a
  // piece at a time, any size, each sent once the socket has room (a big file never sits in memory whole).
  let sending = Promise.resolve()
  const sendFiles = (files: File[]) => {
    for (const f of files) sending = sending.then(async () => {
      const id = Math.random().toString(36).slice(2), name = f.name || `pasted.${f.type.split("/")[1] || "png"}`
      for (let at = 0; at < f.size || at === 0; at += PIECE) {
        while (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount > PIECE * 4) await new Promise((r) => setTimeout(r, 50))
        if (ws?.readyState !== WebSocket.OPEN) { t.write(`\r\n${name}: not sent (the connection dropped)\r\n`); return }
        send(JSON.stringify({ t: "upload", id, name, data: await base64(f.slice(at, at + PIECE)), last: at + PIECE >= f.size }))
      }
    }, () => {})
  }
  const onPaste = (e: ClipboardEvent) => {
    const files = pastedFiles(e.clipboardData)
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
  // A key or a click claims it only when another device's size is on it: measuring the box on every key forced a layout
  // of the page per keystroke (the box's own resizes are the ResizeObserver's).
  const claimIfTaken = () => { if (shell.cols && (shell.cols !== t.cols || shell.rows !== t.rows)) claim() }
  const onFocus = () => { touch(id); claim() }
  box.addEventListener("wheel", onWheel, { capture: true, passive: false })
  box.addEventListener("paste", onPaste, true)
  // (marked so the desktop app's window doesn't take the drop first and open the file in a tab: core/desktop.ts)
  box.dataset.fileDrop = ""
  // Windows: a right-click copies the selection, else pastes, as Windows Terminal's does.
  const onRightClick = (e: MouseEvent) => {
    if (!isWindows || touchScreen()) return
    e.preventDefault(); e.stopPropagation()
    if (t.hasSelection()) { copy(t.getSelection()); t.clearSelection() } else void readClipboard(t, sendFiles).catch((err) => { if ((err as Error)?.name !== "NotAllowedError") notifyError(err, "Couldn't paste") })
    t.focus()
  }
  box.addEventListener("contextmenu", onRightClick, true)
  box.addEventListener("dragover", onDragOver)
  box.addEventListener("drop", onDrop)
  box.addEventListener("pointerdown", flushCopy, true)
  box.addEventListener("keydown", flushCopy, true)
  box.addEventListener("pointerdown", claimIfTaken, true)
  box.addEventListener("keydown", claimIfTaken, true)
  // Back to this window (another app, the phone put down) or this tab of the browser: what it shows takes its size.
  const onShown = () => { if (document.visibilityState === "visible") claim() }
  window.addEventListener("focus", onShown)
  document.addEventListener("visibilitychange", onShown)

  const l: Live = {
    id, t, box, search, find: { text: "", caseSensitive: false, wholeWord: false, regexp: false }, status: { kind: "connecting", tries: 0 }, mounted: false, ended: false, tmuxScroll: false, view: null, send, sendFiles, claim,
    // Once its box is in the page (xterm.js measures its cells there).
    open: () => {
      if (opened) return
      opened = true
      opening.mark("view")
      t.open(box)
      renderer()
      const screen = t.element?.querySelector<HTMLElement>(".xterm-screen")
      if (screen) offerPicture(screen, () => picture(screen))
      t.textarea?.addEventListener("focus", onFocus)
      l.refit()
      opening.mark("xterm")
      connect()
    },
    refit: () => { try { fit.fit() } catch { /* not laid out */ } },
    // Restart, Try again, Start a new one: the user asks for it, so it may start the session.
    restart: () => { clearTimeout(timer); attachOnly = false; t.reset(); setStatus({ kind: "connecting", tries: 0 }); connect(); t.focus() },
    dispose: () => {
      if (gone) return
      gone = true
      clearTimeout(timer); cancelAnimationFrame(wheelFrame)
      offLook(); offSettings(); osc.dispose(); onData.dispose(); onBinary.dispose(); onResize.dispose()
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

/** Each terminal view's way to open its find bar, by its element ([data-terminal-view]). */
const finders = new WeakMap<Element, () => void>()
/** The terminal find command (index.tsx): open the find bar of this view, or put the keyboard back in it. */
export const openFind = (view: Element) => finders.get(view)?.()

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
  // Its own text size, apart from the app's zoom: ⌘ (or ⌃) and the wheel, or a pinch, over it (quick text size on),
  // before the terminal scrolls with it.
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
    // What it shows (`all`: its whole history too), as text, for scripts (web/qa): with WebGL the screen is a canvas.
    Object.defineProperty(el, "terminalText", { configurable: true, value: (all = false) => {
      const b = t.buffer.active, lines: string[] = []
      for (let y = all ? 0 : b.viewportY, end = all ? b.length : b.viewportY + t.rows; y < end; y++) lines.push(b.getLine(y)?.translateToString(true) ?? "")
      return lines.join("\n")
    } })
    let frame = 0
    // (while the panes slide to a sidebar's new edge, once they stop: its shell redraws for every size it's given)
    const refit = () => { frame = requestAnimationFrame(() => (document.documentElement.hasAttribute("data-panes-sliding") ? refit() : l.refit())) }
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      refit()
    })
    ro.observe(el)

    // Touch: xterm.js neither scrolls nor focuses on a touch, so it's done here: a tap focuses (during the touch, the only
    // time iOS shows the keyboard), a long press opens the menu, a swipe scrolls like a wheel and glides on.
    let start: { x: number; y: number } | null = null, press = 0, pressed = false
    let swiping = false, lastY = 0, lastT = 0, speed = 0, glide = 0
    // (the keys only with a keyboard: off a Mac ⌃C and ⌃V are the shell's, so it's ⌃⇧C and ⌃⇧V)
    const hint = (k: string) => (touchUi ? undefined : keyHint(isMac ? `Mod+${k}` : `Ctrl+Shift+${k}`))
    const menu = (at: { x: number; y: number }) => openMenu(at, [
      ...(t.hasSelection() ? [{ label: "Copy", icon: Copy, hint: hint("C"), run: () => { copy(t.getSelection()); t.focus() } }] : []),
      { label: "Paste", icon: ClipboardPaste, hint: hint("V"), run: () => { touchActions.current.paste(); if (!touchUi) t.focus() } },
      { label: "Select all", icon: TextSelect, run: () => { t.selectAll(); if (!touchUi) t.focus() } },
    ])
    // A right-click is the app's menu, never the browser's (Windows': copy or paste at once, above).
    const onContextMenu = (e: MouseEvent) => {
      if (isWindows || touchUi) return
      e.preventDefault(); e.stopPropagation()
      menu({ x: e.clientX, y: e.clientY })
    }
    el.addEventListener("contextmenu", onContextMenu, true)
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
      el.removeEventListener("contextmenu", onContextMenu, true)
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

  // Its find bar: open while `finding` isn't 0, bumped by each ask to put the keyboard back in it.
  const view = useRef<HTMLDivElement>(null)
  const [finding, setFinding] = useState(0)
  useEffect(() => {
    const el = view.current!
    finders.set(el, () => setFinding((n) => n + 1))
    return () => { finders.delete(el) }
  }, [])
  const closeFind = () => { setFinding(0); live.current?.t.focus() }

  const restart = () => { live.current?.restart(); setRestarts((n) => n + 1) }
  return (
    <div ref={view} data-terminal-view className={cn("flex flex-col bg-background", full ? "fixed inset-x-0 z-40 pt-[env(safe-area-inset-top)]" : "relative h-full min-h-[240px] w-full",
      full && !area.keyboard && "pb-[env(safe-area-inset-bottom)]")}
      style={full ? { top: area.top, height: area.height } : undefined}>
      {status.kind === "live" && status.blocked && (
        <div role="alert" data-terminal-blocked className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-2 text-[13px]">
          <span className="min-w-0 text-muted-foreground">
            macOS blocked access to the vault folder{openPermissions ? "" : ": allow Vaultite in System Settings, Privacy and security, Files and folders"}
          </span>
          {openPermissions && <button type="button" onClick={openPermissions} className="shrink-0 cursor-pointer rounded-[6px] bg-primary px-2.5 py-1 text-[13px] font-medium text-primary-foreground hover:opacity-90">Permissions</button>}
        </div>
      )}
      {/* (isolate: xterm.js's layers' z-indexes stay inside, under the bars below; WebGL's canvases would cover them) */}
      <div className="relative isolate min-h-0 flex-1 pl-3 pr-1 pt-2 pb-1">
        {/* Touch: no browser text selection or callout on a long press (the terminal's menu opens instead), and the
            keyboard's hidden field at 16px, or iOS zooms the page in when it's focused. */}
        <div ref={host} data-terminal={id} className={cn("h-full w-full", touchUi && "select-none [-webkit-touch-callout:none] [&_.xterm-helper-textarea]:!text-[16px]")} />
        {finding > 0 && live.current && <FindBar l={live.current} ask={finding} close={closeFind} />}
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
      {status.kind === "ended" && <EndBar onRestart={restart} action="Restart">Session ended</EndBar>}
      {status.kind === "exited" && (
        <EndBar onRestart={restart} action="Restart">
          {status.code === -1 ? "The shell couldn't start" : `Process exited${status.signal ? ` (signal ${status.signal})` : status.code ? ` with code ${status.code}` : ""}`}
        </EndBar>
      )}
    </div>
  )
}

const regexOk = (s: string) => { try { new RegExp(s); return true } catch { return false } }

/** Find in the terminal, over its top right corner: the search addon looks through the scrollback, as you type from the
 *  newest line up; ↵ goes to the next match down, ⇧↵ up. */
function FindBar({ l, ask, close }: { l: Live; ask: number; close: () => void }) {
  const [spec, setSpec] = useState(l.find)
  const [found, setFound] = useState({ current: -1, total: 0 })
  const ref = useRef<HTMLInputElement>(null)
  const look = useRef<ISearchOptions["decorations"]>(undefined)
  /** `by` 0: found again from the match it's on (typed, an option changed); else the next match down (1) or up (-1). */
  const run = (s: Live["find"], by: 0 | 1 | -1) => {
    l.find = s
    if (!s.text || (s.regexp && !regexOk(s.text))) { l.search.clearDecorations(); setFound({ current: -1, total: 0 }); return }
    const o: ISearchOptions = { caseSensitive: s.caseSensitive, wholeWord: s.wholeWord, regex: s.regexp, decorations: look.current }
    if (!by) l.search.clearDecorations() // (a new search: it stays on the selected match if that still matches)
    if (by > 0) l.search.findNext(s.text, o); else l.search.findPrevious(s.text, o)
  }
  const latest = useRef(run)
  latest.current = run
  useEffect(() => {
    const results = l.search.onDidChangeResults((r) => setFound({ current: r.resultIndex, total: r.resultCount }))
    // The current match is also the terminal's selection, drawn over its highlight: while the bar has the keyboard, the
    // selection (the terminal's inactive one) takes the current match's colour.
    const paint = () => {
      look.current = findLook()
      l.t.options.theme = { ...l.t.options.theme, selectionInactiveBackground: look.current.activeMatchBackground }
    }
    const offLook = onLook(() => { paint(); latest.current(l.find, 0) })
    paint()
    latest.current(l.find, 0) // (opened again: what it found last, lit again)
    return () => { results.dispose(); offLook(); l.search.clearDecorations(); l.t.options.theme = theme() }
  }, [l])
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [ask])

  const set = (o: Partial<Live["find"]>) => { const s = { ...spec, ...o }; setSpec(s); run(s, 0) }
  const keys = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return }
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return
    e.preventDefault()
    run(spec, e.shiftKey ? -1 : 1)
  }
  const valid = !spec.regexp || regexOk(spec.text)
  const bad = !!spec.text && (!valid || !found.total)
  const status = countText({ search: spec.text, valid, total: found.total, current: found.current, more: found.total >= MAX })
  return (
    <div data-terminal-find data-overlay className={cn("absolute top-2 right-3 z-10 w-[min(440px,calc(100%-24px))]", floatingBar)}>
      <FindField inputRef={ref} value={spec.text} placeholder="Find in terminal" status={status} bad={bad} onChange={(text) => set({ text })} onKeyDown={keys} />
      <FindTools spec={spec} set={set} total={found.total} step={(by) => run(spec, by)} close={close} />
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
