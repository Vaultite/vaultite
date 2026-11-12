import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ClipboardPaste, Copy, TextSelect } from "lucide-react"
import { cn, isMac, isWindows, KeyBar, keyboardBusy, keyboardUp, keyHint, keysText, onResized, openMenu, openPermissions, resizing, textSize, usePane, useTextSize, useTextSizeWheel, useVisibleArea } from "@vaultite"
import { countText, FindField, FindTools, floatingBar, floatingSpot, MAX } from "@plugins/find/tools"
import { copy, pasteClipboard } from "./clipboard"
import { acquire, release, touchScreen, type Live, type Status } from "./live"
import { register, touch } from "./sessions"
import { fontSize } from "./theme"
import { setModule, type Term } from "./vt/term"
import { vtModule } from "./vt/wasm"

setModule(await vtModule())

function dictationInput(t: Term) {
  let words = "", shown: HTMLElement | null = null, follow: { dispose: () => void } | null = null
  const text = document.createElement("span")
  const cell = () => {
    const screen = t.screenEl, cur = t.cursor()
    if (!screen || !t.cols || !cur) return null
    return { screen, x: cur.x, row: cur.y, w: screen.clientWidth / t.cols, h: screen.clientHeight / t.rows }
  }
  const draw = () => {
    const c = words ? cell() : null
    if (!c) { shown?.remove(); return }
    if (!shown) {
      shown = document.createElement("div")
      shown.dataset.termPending = ""
      shown.setAttribute("aria-hidden", "true")
      Object.assign(shown.style, { position: "absolute", left: "0", right: "0", zIndex: "8", pointerEvents: "none", whiteSpace: "pre-wrap",
        wordBreak: "break-all", color: "var(--muted-foreground)" })
      shown.append(text)
    }
    if (shown.parentElement !== c.screen) c.screen.append(shown)
    Object.assign(shown.style, { top: `${c.row * c.h}px`, textIndent: `${c.x * c.w}px`, lineHeight: `${c.h}px`, fontFamily: t.o.fontFamily,
      fontSize: `${t.o.fontSize}px` })
    text.style.background = t.o.theme.clear ? "" : `#${t.o.theme.background.toString(16).padStart(6, "0")}`
    text.textContent = words
  }
  return {
    send: (data: string) => t.input(data),
    bracketed: () => t.bracketedPaste,
    caret: () => {
      const c = cell()
      if (!c) return null
      const r = c.screen.getBoundingClientRect(), w = r.width / t.cols, h = r.height / t.rows
      return { rect: new DOMRect(r.left + c.x * w, r.top + c.row * h, 0, h), before: t.rowText(c.row, c.x) }
    },
    pending: (text: string) => {
      words = text
      if (words && !follow) follow = t.onRender(draw)
      if (!words) { follow?.dispose(); follow = null }
      draw()
    },
  }
}

const arrow = (t: Term, k: string) => (t.applicationCursor ? `\x1bO${k}` : `\x1b[${k}`)
const KEYS: { label: ReactNode; name: string; send: (t: Term) => string }[] = [
  { label: "esc", name: "Escape", send: () => "\x1b" },
  { label: "tab", name: "Tab", send: () => "\t" },
  { label: "⇧tab", name: "Shift Tab", send: () => "\x1b[Z" },
  { label: "⌃C", name: "Control C", send: () => "\x03" },
  { label: <ArrowLeft className="size-[17px]" strokeWidth={2} />, name: "Left", send: (t) => arrow(t, "D") },
  { label: <ArrowUp className="size-[17px]" strokeWidth={2} />, name: "Up", send: (t) => arrow(t, "A") },
  { label: <ArrowDown className="size-[17px]" strokeWidth={2} />, name: "Down", send: (t) => arrow(t, "B") },
  { label: <ArrowRight className="size-[17px]" strokeWidth={2} />, name: "Right", send: (t) => arrow(t, "C") },
]

const finders = new WeakMap<Element, () => void>()
export const openFind = (view: Element) => finders.get(view)?.()

export default function TerminalView({ id, focused, close }: { id: string; focused: boolean; close: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const live = useRef<Live | null>(null)
  const [status, setStatus] = useState<Status>({ kind: "connecting", tries: 0 })
  const [restarts, setRestarts] = useState(0)
  const closeTab = useRef(close)
  closeTab.current = close
  const [touchUi] = useState(touchScreen)
  const inPane = usePane().pane !== ""
  const phone = touchUi && !inPane
  const [typing, setTyping] = useState(false)
  const [up, setUp] = useState(false)
  const area = useVisibleArea(phone && typing)
  const pageAt = useRef(0)
  const touchActions = useRef({ key: (_send: (t: Term) => string) => {}, paste: () => {}, hide: () => {} })
  const size = useTextSize("terminal")
  useTextSizeWheel(host, "terminal", true)
  useEffect(() => {
    const l = live.current
    if (!l || l.t.o.fontSize === fontSize(size)) return
    l.t.setFont(l.t.o.fontFamily, fontSize(size))
  }, [size])

  useEffect(() => {
    const el = host.current!
    const l = acquire(id)
    live.current = l
    const t = l.t
    el.appendChild(l.box)
    l.mounted = true
    l.view = { status: setStatus, close: () => closeTab.current() }
    setStatus(l.status)
    t.setFont(t.o.fontFamily, fontSize(textSize("terminal")))
    l.open()
    l.refit()
    Object.defineProperty(el, "terminalText", { configurable: true, value: (all = false) => t.text(all) })
    Object.defineProperty(el, "terminalCell", { configurable: true, value: () => {
      const r = el.querySelector("[data-term-screen]")?.getBoundingClientRect()
      return r ? { x: r.left, y: r.top, width: r.width / t.cols, height: r.height / t.rows } : null
    } })
    const dictation = dictationInput(t)
    Object.defineProperty(el, "terminalInput", { configurable: true, value: dictation })
    // A ResizeObserver runs before the paint: the new size and what it draws show in the same frame.
    const refit = () => { if (!resizing()) l.refit() }
    const ro = new ResizeObserver(refit)
    ro.observe(el)
    const offResized = onResized(refit)

    // iOS shows the keyboard only for a focus during a touch: a tap focuses in touchend.
    let start: { x: number; y: number } | null = null, press = 0, pressed = false
    let swiping = false, lastY = 0, lastT = 0, speed = 0, glide = 0
    // Off a Mac ⌃C and ⌃V are the shell's.
    const hint = (k: string) => (touchUi ? undefined : keyHint(isMac ? `Mod+${k}` : `Ctrl+Shift+${k}`))
    const menu = (at: { x: number; y: number }) => openMenu(at, [
      ...(t.hasSelection() ? [{ label: "Copy", icon: Copy, hint: hint("C"), run: () => { copy(t.getSelection()); t.focus() } }] : []),
      { label: "Paste", icon: ClipboardPaste, hint: hint("V"), run: () => { touchActions.current.paste(); if (!touchUi) t.focus() } },
      { label: "Select all", icon: TextSelect, run: () => { t.selectAll(); if (!touchUi) t.focus() } },
    ])
    const onContextMenu = (e: MouseEvent) => {
      if (isWindows || touchUi) return
      e.preventDefault(); e.stopPropagation()
      menu({ x: e.clientX, y: e.clientY })
    }
    el.addEventListener("contextmenu", onContextMenu, true)
    const wheel = (deltaY: number, x: number, y: number) => { const c = t.cellAt(x, y); t.wheel(deltaY, { x: c.px, y: c.py }) }
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
      if (e.cancelable) e.preventDefault()
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
        let v = speed * 16
        const step = () => { if (Math.abs(v) < 0.5) return; wheel(v, x, y); v *= 0.95; glide = requestAnimationFrame(step) }
        if (e.timeStamp - lastT < 80) glide = requestAnimationFrame(step)
        return
      }
      if (!start) return
      start = null
      // No mouse events or double-tap zoom follow a touchend whose default is prevented.
      if (e.cancelable) e.preventDefault()
      if (pressed) return
      const ta = t.textarea
      if (document.activeElement !== ta) pageAt.current = scrollY
      else if (!keyboardUp()) ta?.blur()
      t.focus()
    }
    let blurTimer = 0
    const onTyping = () => { clearTimeout(blurTimer); setTyping(true) }
    const onStopTyping = () => { clearTimeout(blurTimer); blurTimer = window.setTimeout(() => setTyping(document.activeElement === t.textarea), 60) }
    touchActions.current = {
      key: (seq) => t.input(seq(t)),
      paste: () => pasteClipboard(t, l.sendFiles),
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
    const scrolled = () => { const v = t.viewport; setUp(v.y < v.base) }
    const onScroll = t.onScroll(scrolled)
    scrolled()

    return () => {
      ro.disconnect(); offResized(); unregister(); onScroll.dispose(); dictation.pending("")
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

  // iOS shows no keyboard for a focus outside a touch.
  useEffect(() => {
    if (!focused) return
    const l = live.current
    if (!touchUi && l && !keyboardBusy(l.box)) l.t.focus()
    l?.claim(); touch(id)
  }, [focused, id, restarts, touchUi])

  // Safari scrolls the page to show what has the focus: when the keyboard goes, the page goes back.
  const full = phone && typing && !!area
  useLayoutEffect(() => (full ? () => scrollTo(0, pageAt.current) : undefined), [full])

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
      <div className="relative isolate min-h-0 flex-1 pl-3 pr-1 pt-2 pb-1">
        {/* iOS zooms the page in on a focused field under 16px. */}
        <div ref={host} data-terminal={id} className={cn("h-full w-full overflow-hidden", touchUi && "select-none [-webkit-touch-callout:none] [&_[data-term-input]]:!text-[16px]")} />
        {finding > 0 && live.current && <FindBar l={live.current} ask={finding} close={closeFind} />}
        {up && (
          <button type="button" aria-label="Scroll to the end" data-tip="Scroll to the end" data-terminal-end
            onClick={() => { const t = live.current?.t; t?.scrollToBottom(); if (!touchUi) t?.focus() }}
            className={cn("absolute right-5 bottom-3 z-10 flex cursor-pointer items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md hover:text-foreground",
              touchUi ? "size-11" : "size-8")}>
            <ArrowDown className={touchUi ? "size-5" : "size-4"} strokeWidth={2} />
          </button>
        )}
      </div>
      {full && <KeyBar label="Terminal keys" hide={() => touchActions.current.hide()} keys={[
        ...KEYS.map((k) => ({ name: k.name, label: typeof k.label === "string" ? keysText(k.label) : k.label, run: () => touchActions.current.key(k.send) })),
        { name: "Paste", label: <ClipboardPaste className="size-[17px]" strokeWidth={2} />, run: () => touchActions.current.paste() },
      ]} />}
      {status.kind === "connecting" && status.tries > 0 && (
        <div className="pointer-events-none absolute top-2 right-4 rounded-[6px] border border-border bg-card px-2 py-1 text-[12px] text-muted-foreground">
          Reconnecting…
        </div>
      )}
      {status.kind === "away" && (
        <EndBar role="status" away onRestart={restart} action="Try now">This terminal runs {status.in ? "in" : "on"} {status.label}, which {status.reason}. Trying again…</EndBar>
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

function FindBar({ l, ask, close }: { l: Live; ask: number; close: () => void }) {
  const [spec, setSpec] = useState(l.find)
  const [found, setFound] = useState({ current: -1, total: 0 })
  const ref = useRef<HTMLInputElement>(null)
  const run = (s: Live["find"], by: 0 | 1 | -1) => {
    l.find = s
    if (!s.text || (s.regexp && !regexOk(s.text))) { l.t.clearFind(); setFound({ current: -1, total: 0 }); return }
    l.t.find(s, by, MAX, (r) => setFound({ current: r.index, total: r.count }))
  }
  const latest = useRef(run)
  latest.current = run
  useEffect(() => {
    latest.current(l.find, 0)
    return () => l.t.clearFind()
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
    <div data-terminal-find data-overlay className={cn("top-2", floatingSpot, floatingBar)}>
      <FindField inputRef={ref} value={spec.text} placeholder="Find in terminal" status={status} bad={bad} onChange={(text) => set({ text })} onKeyDown={keys} />
      <FindTools spec={spec} set={set} total={found.total} step={(by) => run(spec, by)} close={close} />
    </div>
  )
}

function EndBar({ role, away, action, onRestart, children }: { role?: "status" | "alert"; away?: boolean; action: string; onRestart: () => void; children: ReactNode }) {
  return (
    <div role={role} data-terminal-away={away || undefined} className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t border-border bg-card px-4 py-2 text-[13px]">
      <span className="min-w-0 text-muted-foreground">{children}</span>
      <button type="button" onClick={onRestart} className="shrink-0 cursor-pointer rounded-[6px] bg-primary px-2.5 py-1 text-[13px] font-medium text-primary-foreground hover:opacity-90">{action}</button>
    </div>
  )
}