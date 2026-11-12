import { agentOfTerminal, appShortcut, askedAt, closeView, isMac, isWindows, linkClick, mintedHere, offerPicture, onLook, openWebLink, pastedFiles, span, textSize } from "@vaultite"
import type { FindOptions } from "@plugins/find/tools"
import { copy, flushCopy, pasteClipboard } from "./clipboard"
import { fileLinks } from "./fileLinks"
import { closedJustNow, parkTerminal, touch, unparkTerminal } from "./sessions"
import { codeFont, cursor, fontSize, glassy, settings, theme } from "./theme"
import { Term } from "./vt/term"

const ACK = 128 << 10
const PIECE = 1 << 20

const base64 = (f: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(",") + 1))
  r.onerror = () => reject(r.error)
  r.readAsDataURL(f)
})

export const touchScreen = () => matchMedia("(pointer: coarse)").matches

const RESIZE_SETTLE = 120

const EXITED = 4000
const REFUSED = 4003
const GONE = 4004

export type Status = { kind: "live"; blocked?: boolean } | { kind: "connecting"; tries: number } | { kind: "exited"; code: number; signal: number }
  | { kind: "ended" }
  | { kind: "refused"; reason: string }
  | { kind: "away"; label: string; reason: string; in?: boolean }

export type Live = {
  id: string; t: Term; box: HTMLDivElement
  find: { text: string } & FindOptions
  status: Status; mounted: boolean; ended: boolean
  view: { status: (s: Status) => void; close: () => void } | null
  open: () => void; refit: () => void; send: (data: string | Uint8Array<ArrayBuffer>) => void
  claim: () => void
  sendFiles: (files: File[]) => void; restart: () => void; dispose: () => void
}

const PARKED = 4
const parked = new Map<string, Live>()

function letGo(l: Live) {
  if (parked.get(l.id) === l) { parked.delete(l.id); unparkTerminal(l.id) }
  l.dispose()
}

export function acquire(id: string): Live {
  const l = parked.get(id)
  if (!l) return create(id)
  parked.delete(id)
  unparkTerminal(id)
  return l
}

export function release(l: Live) {
  l.mounted = false
  l.view = null
  if (l.ended || closedJustNow(l.id) || parked.has(l.id)) return l.dispose()
  parked.set(l.id, l)
  parkTerminal(l.id, () => letGo(l))
  for (const old of parked.values()) if (parked.size > PARKED) letGo(old)
}

function create(id: string): Live {
  const asked = askedAt(id), opening = span("terminal.open", { agent: agentOfTerminal(id)?.name ?? "shell", how: asked === undefined ? "shown" : "asked" }, asked)
  if (asked !== undefined) opening.mark("tab")
  const c = cursor()
  // WebGL draws text on a see-through ground thin and ragged: Canvas2D under translucent pages.
  const t = new Term({
    fontFamily: codeFont(), fontSize: fontSize(textSize("terminal")), lineHeight: 1.15, mac: isMac,
    cursorStyle: c.style, cursorInactiveStyle: c.inactive, cursorBlink: c.blink, scrollback: 10000, theme: theme(), webgl: !glassy(),
    onLink: (e, uri) => { if (/^https?:/i.test(uri)) openWebLink(uri, linkClick(e)) },
    onCopy: copy,
  })
  const files = t.registerLinkProvider({ provideLinks: (y, done) => done(fileLinks(t, y)) })
  const box = document.createElement("div")
  box.style.width = box.style.height = "100%"
  // ⇧↩ is ESC + return, as a terminal set up for Claude Code sends it.
  t.attachCustomKeyEventHandler((e) => {
    if (e.key === "Enter" && e.shiftKey && !(e.ctrlKey || e.metaKey || e.altKey)) {
      if (e.type === "keydown") { e.preventDefault(); if (!replaying) send(enc.encode("\x1b\r")) }
      return false
    }
    // Off a Mac, ⌃⇧C copies and ⌃⇧V pastes (the browser's paste event, which the terminal takes), as terminals there do.
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
  const offLook = onLook(() => {
    t.setTheme(theme())
    t.setFont(codeFont(), t.o.fontSize)
    if (opened) t.setWebgl(!glassy())
  })
  const offSettings = settings.onChange(() => t.setCursor(cursor()))

  let ws: WebSocket | null = null, timer = 0, tries = 0, gone = false, exited = false, refused = false, opened = false
  let attachOnly = !mintedHere(id), sessionGone = false
  let away: { label: string; reason: string; in?: boolean } | null = null
  const enc = new TextEncoder()
  const setStatus = (st: Status) => { l.status = st; l.view?.status(st) }
  const over = () => { l.ended = true; if (!l.mounted) letGo(l) }
  const closeIt = () => { l.ended = true; if (l.view) return l.view.close(); closeView(`terminal/${id}`); over() }
  // The replay after a reattach holds programs' old questions to the terminal; answered again, the answers would reach
  // the shell as typing and swallow keys until Enter, so its replies (not what's typed) aren't sent while it's drawn.
  let replayNext = false, replaying = false
  let shell = { cols: 0, rows: 0 }

  let shown = false
  const firstOutput = () => { if (shown) return; shown = true; opening.mark("first output"); opening.end() }

  const connect = () => {
    exited = false; refused = false; sessionGone = false; away = null; l.ended = false
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminal/${encodeURIComponent(id)}?cols=${t.cols}&rows=${t.rows}&cw=${t.cellPixels.cw}&ch=${t.cellPixels.ch}&dark=${document.documentElement.classList.contains("dark") ? 1 : 0}${attachOnly ? "&attach=1" : ""}`
    const sock = new WebSocket(url)
    sock.binaryType = "arraybuffer"
    ws = sock
    sock.onopen = () => opening.mark("socket")
    let drawn = 0
    const parsed = (n: number) => () => {
      if ((drawn += n) < ACK || ws !== sock) return
      send(JSON.stringify({ t: "ack", n: drawn }))
      drawn = 0
    }
    sock.onmessage = (e) => {
      if (ws !== sock) return
      if (e.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(e.data), done = parsed(bytes.length)
        if (!replayNext) return t.write(bytes, shown ? done : () => { firstOutput(); done() })
        replayNext = false; replaying = true
        return t.write(bytes, () => { if (ws === sock) replaying = false; firstOutput(); done() })
      }
      let msg: { t?: string; fresh?: boolean; started?: string; code?: number; signal?: number; reason?: string; path?: string; machine?: string; label?: string; backend?: string; cols?: number; rows?: number; ended?: boolean; lost?: boolean
        scrollback?: number }
      try { msg = JSON.parse(e.data) } catch { return }
      if (msg.t === "size") {
        shell = { cols: msg.cols ?? 0, rows: msg.rows ?? 0 }
      } else if (msg.t === "uploaded" && msg.path) {
        // Claude Code attaches an image whose path is pasted.
        t.paste(`${msg.path} `)
      } else if (msg.t === "attached") {
        opening.mark("attached")
        if (msg.started) opening.tags.server = msg.started
        tries = 0
        attachOnly = true
        if (msg.scrollback && msg.scrollback !== t.o.scrollback) t.setScrollback(msg.scrollback)
        t.reset()
        replaying = false
        replayNext = !msg.fresh
        setStatus({ kind: "live" })
      } else if (msg.t === "blocked") {
        setStatus({ kind: "live", blocked: true })
      } else if (msg.t === "unreachable") {
        away = { label: msg.label || msg.machine || "another machine", reason: msg.reason || "isn't answering", in: !!msg.backend }
      } else if (msg.t === "refused") {
        refused = true
        setStatus({ kind: "refused", reason: msg.reason ?? "" })
        over()
      } else if (msg.t === "gone") {
        sessionGone = true
        if (msg.ended) return closeIt()
        setStatus({ kind: "ended" })
        over()
      } else if (msg.t === "exit") {
        exited = true
        if (msg.ended || (!msg.code && !msg.signal && !msg.lost)) return closeIt()
        setStatus(agentOfTerminal(id) || msg.lost ? { kind: "ended" } : { kind: "exited", code: msg.code ?? 0, signal: msg.signal ?? 0 })
        over()
      }
    }
    sock.onclose = (e) => {
      if (ws !== sock || gone) return
      ws = null
      if (refused || e.code === REFUSED) { if (!refused) { setStatus({ kind: "refused", reason: "" }); over() } return }
      if (sessionGone || e.code === GONE) { if (!sessionGone) { setStatus({ kind: "ended" }); over() } return }
      if (exited || e.code === EXITED) { if (!exited) { setStatus({ kind: "exited", code: -1, signal: 0 }); over() } return }
      tries++
      setStatus(away ? { kind: "away", ...away } : { kind: "connecting", tries })
      timer = window.setTimeout(connect, Math.min(away ? 15000 : 10000, 400 * 2 ** Math.min(tries, 5)))
    }
  }

  const send = (data: string | Uint8Array<ArrayBuffer>) => { if (ws?.readyState === WebSocket.OPEN) ws.send(data) }
  const onBytes = t.onBytes((d, reply) => { if (!replaying || !reply) send(typeof d === "string" ? enc.encode(d) : d) })
  // A program redraws its whole screen for every size it's given: a run of sizes (a window dragged) is told once it settles.
  let resizing = 0, lastResize = -Infinity
  const onResize = t.onResize(() => {
    clearTimeout(resizing)
    const tell = () => send(JSON.stringify({ t: "resize", cols: t.cols, rows: t.rows, ...t.cellPixels }))
    const now = performance.now(), lone = now - lastResize > RESIZE_SETTLE
    lastResize = now
    if (lone) tell(); else resizing = window.setTimeout(tell, RESIZE_SETTLE)
  })

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
    if (!files.length) return
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
  const claim = () => {
    if (!l.mounted || !box.clientWidth || ws?.readyState !== WebSocket.OPEN) return
    l.refit()
    if (shell.cols && (shell.cols !== t.cols || shell.rows !== t.rows)) send(JSON.stringify({ t: "resize", cols: t.cols, rows: t.rows, ...t.cellPixels }))
  }
  // Measuring the box on every key forced a layout of the page per keystroke.
  const claimIfTaken = () => { if (shell.cols && (shell.cols !== t.cols || shell.rows !== t.rows)) claim() }
  const onFocus = () => { touch(id); claim() }
  box.addEventListener("paste", onPaste, true)
  box.dataset.fileDrop = ""
  // Windows: a right-click copies the selection, else pastes, as Windows Terminal's does.
  const onRightClick = (e: MouseEvent) => {
    if (!isWindows || touchScreen()) return
    e.preventDefault(); e.stopPropagation()
    if (t.hasSelection()) { copy(t.getSelection()); t.clearSelection() } else pasteClipboard(t, sendFiles)
    t.focus()
  }
  box.addEventListener("contextmenu", onRightClick, true)
  box.addEventListener("dragover", onDragOver)
  box.addEventListener("drop", onDrop)
  box.addEventListener("pointerdown", flushCopy, true)
  box.addEventListener("keydown", flushCopy, true)
  box.addEventListener("pointerdown", claimIfTaken, true)
  box.addEventListener("keydown", claimIfTaken, true)
  const onShown = () => { if (document.visibilityState === "visible") claim() }
  window.addEventListener("focus", onShown)
  document.addEventListener("visibilitychange", onShown)

  const l: Live = {
    id, t, box, find: { text: "", caseSensitive: false, wholeWord: false, regexp: false }, status: { kind: "connecting", tries: 0 }, mounted: false, ended: false, view: null, send, sendFiles, claim,
    open: () => {
      if (opened) return
      opened = true
      opening.mark("view")
      t.open(box)
      offerPicture(t.screenEl, () => t.picture())
      t.textarea.addEventListener("focus", onFocus)
      l.refit()
      opening.mark("terminal")
      connect()
    },
    refit: () => { t.fit() },
    restart: () => { clearTimeout(timer); attachOnly = false; t.reset(); setStatus({ kind: "connecting", tries: 0 }); connect(); t.focus() },
    dispose: () => {
      if (gone) return
      gone = true
      clearTimeout(timer); clearTimeout(resizing)
      offLook(); offSettings(); files.dispose(); onBytes.dispose(); onResize.dispose()
      t.textarea?.removeEventListener("focus", onFocus)
      window.removeEventListener("focus", onShown)
      document.removeEventListener("visibilitychange", onShown)
      ws?.close()
      t.dispose()
      box.remove()
    },
  }
  return l
}
