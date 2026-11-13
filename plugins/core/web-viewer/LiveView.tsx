import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react"
import { createPortal } from "react-dom"
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bot, ChevronLeft, ClipboardPaste, Copy, Globe, Keyboard, MousePointer2, Pause, Play } from "lucide-react"
import { Button, closePane, cn, copyText, dateText, errorText, get, haptic, KeyBar, keysText, LoadingSidebarRows, notify, notifyError, onMachine, openInSplit, PaneControls, post, selectPane, SidebarHeading, SidebarRow, splitMachine, useChosen, useKeptCount, usePane, usePaneTopBar, useScopedState, useVisibleArea, webPages, coarse, type BarKey } from "@vaultite"
import { hostOf } from "./address"
import { argOf, colorOf, containerById } from "./containers"
import type { LiveStep, LiveTab, LiveTabs } from "./livetabs"
import { keepTitle } from "./livetitles"

const idOf = (t: Pick<LiveTab, "tab" | "machine">) => onMachine(String(t.tab), t.machine)
const find = (r: LiveTabs, tab: number, machine: string) => r.tabs.find((x) => x.tab === tab && (x.machine ?? "") === (machine || r.self || ""))

export function showAppTab(t: Pick<LiveTab, "appTab" | "url" | "container">) {
  if (!selectPane(t.appTab)) openInSplit(`view:web/${argOf(t.url, t.container)}`, "right", true, t.appTab)
}

const TIME = { hour: "numeric", minute: "2-digit" } as const
const whose = (t: Pick<LiveTab, "by" | "task">) => (t.by ? [t.by, t.task].filter(Boolean).join("/") : "Yours")

function useOnScreen() {
  const [on, setOn] = useState(document.visibilityState === "visible")
  useEffect(() => {
    const f = () => setOn(document.visibilityState === "visible")
    document.addEventListener("visibilitychange", f)
    return () => document.removeEventListener("visibilitychange", f)
  }, [])
  return on
}

function useTabs(on: boolean) {
  const [tabs, setTabs] = useState<LiveTab[] | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    if (!on) return
    let stop = false
    const read = () => void get<LiveTabs>("web-viewer/tabs").then((r) => {
      if (stop) return
      setTabs(r.tabs)
      setError("")
      for (const t of r.tabs) keepTitle(idOf(t), t.title)
    }, (e) => { if (!stop) setError(errorText(e, "Couldn't reach the desktop app's browser")) })
    read()
    const timer = setInterval(read, 2000)
    return () => { stop = true; clearInterval(timer) }
  }, [on])
  return { tabs, error }
}

export function LiveView({ arg, setArg }: { arg: string; setArg: (arg: string) => void }) {
  const [n, machine] = splitMachine(arg)
  const tab = Number(n)
  return tab > 0 ? <Watch key={arg} tab={tab} machine={machine} back={() => setArg("")} /> : <Tabs open={(t) => setArg(idOf(t))} />
}

function Container({ id }: { id: string | null }) {
  const c = containerById(id)
  if (!c) return null
  return (
    <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground">
      <span className="size-2 rounded-full" style={{ background: colorOf(c) }} />{c.name}
    </span>
  )
}

function Tabs({ open }: { open: (t: LiveTab) => void }) {
  const { hidden } = usePane()
  const onScreen = useOnScreen()
  const { tabs, error } = useTabs(!hidden && onScreen)
  const asking = (tabs ?? []).filter((t) => t.asking)
  const agents = (tabs ?? []).filter((t) => !t.asking && t.by)
  const yours = (tabs ?? []).filter((t) => !t.asking && !t.by)
  const machines = new Set((tabs ?? []).map((t) => t.machine ?? "")).size > 1
  const kept = useKeptCount("web-viewer:live-tabs", tabs?.length)
  const rows = (list: LiveTab[]) => (
    <div className="flex flex-col gap-px" data-size-up>
      {list.map((t) => (
        <SidebarRow key={idOf(t)} icon={t.by ? Bot : Globe} tint={t.by ? "var(--purple)" : undefined} badge={t.asking ? "ask" : undefined} open
          onClick={() => open(t)} data-web-live-tab={idOf(t)} tip={null}
          label={<span className="flex min-w-0 items-baseline gap-1.5"><span className="min-w-0 shrink truncate">{t.title || hostOf(t.url)}</span>
            <span className="min-w-0 shrink-[2] truncate text-[12px] text-muted-foreground">{t.asking ?? (t.by ? whose(t) : hostOf(t.url))}</span></span>}>
          <span className="mr-1 flex shrink-0 items-center gap-2">
            {t.paused && <span className="text-[12px] text-muted-foreground">Paused</span>}
            <Container id={t.container} />
            {machines && t.machineLabel && <span className="shrink-0 text-[12px] text-muted-foreground" data-web-live-machine>{t.machineLabel}</span>}
          </span>
        </SidebarRow>
      ))}
    </div>
  )
  return (
    <div className="h-full overflow-y-auto overscroll-contain"><div className="mx-auto max-w-[760px] px-4 pt-4 pb-10" data-web-live-list>
      <h1 className="mb-1 text-[20px] font-semibold">Browser tabs</h1>
      <p className="mb-4 text-[15px] text-muted-foreground md:text-[13px]">The web pages open in your desktop apps. Open one to watch it, tap and type in it, or stop the agent working there.</p>
      {error ? <p className="text-[15px] text-muted-foreground md:text-[13px]">{error}</p>
        : !tabs ? <section className="mb-4"><div className="mt-2 h-7" /><LoadingSidebarRows count={kept} data-size-up data-web-live-loading="" /></section>
        : !tabs.length ? <p className="text-[15px] text-tertiary md:text-[13px]">No web pages are open in your desktop apps.</p> : null}
      {asking.length > 0 && <section className="mb-4"><SidebarHeading title="Needs you" open />{rows(asking)}</section>}
      {agents.length > 0 && <section className="mb-4"><SidebarHeading title="Agents" open />{rows(agents)}</section>}
      {yours.length > 0 && <section className="mb-4"><SidebarHeading title="Yours" open />{rows(yours)}</section>}
    </div></div>
  )
}

type State = Partial<LiveTab> & { tab: number; w?: number; h?: number }
type View = { s: number; x: number; y: number }
type Point = { clientX: number; clientY: number }
type Gesture = { start: Point; last: Point; t: number; moved: boolean; hold: number
  two: { from: View; fromAt: Point; d: number; last: Point; kind: "pinch" | "scroll" | null } | null }
const MAX_ZOOM = 4, SHARP_AT = 1.3
const SLOP = 8, HOLD_MS = 450, DOUBLE_MS = 350
const TRACKPAD_SPEED = 1.5, EDGE = 24
const SPECIAL = new Set(["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"])
const BUTTON = ["left", "middle", "right"]
const mods = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
  (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)

function Watch({ tab, machine, back }: { tab: number; machine: string; back: () => void }) {
  const id = onMachine(String(tab), machine)
  const { hidden, tab: own } = usePane()
  const onScreen = useOnScreen()
  const [info, setInfo] = useState<State>({ tab })
  const [status, setStatus] = useState<"connecting" | "live" | "gone" | "error">("connecting")
  const [error, setError] = useState("")
  const [framed, setFramed] = useState(false)
  const [steps, setSteps] = useState<LiveStep[]>([])
  const [kept, setKept] = useState(true)
  const img = useRef<HTMLImageElement>(null)
  const keys = useRef<HTMLTextAreaElement>(null)
  const sock = useRef<WebSocket | null>(null)
  const bar = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const pointer = useRef<HTMLDivElement>(null)
  usePaneTopBar(bar)
  const live = !hidden && onScreen

  useEffect(() => {
    if (!webPages?.engine || !own) return
    void get<LiveTabs>("web-viewer/tabs").then((r) => {
      const t = find(r, tab, machine)
      if (t?.appTab) { showAppTab(t); closePane(own, true) }
    }, () => {})
  }, [tab, machine, own])

  useEffect(() => {
    if (!live) return
    let stop = false, retry = 0, timer = 0
    const connect = () => {
      if (stop) return
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/web-viewer/live/${id}`)
      ws.binaryType = "blob"
      sock.current = ws
      sharpSent.current = false
      let ended = false
      ws.onopen = () => { retry = 0 }
      ws.onmessage = (m) => {
        if (typeof m.data !== "string") {
          const el = img.current
          if (!el) return
          const was = el.dataset.url, url = URL.createObjectURL(m.data as Blob)
          el.src = url
          el.dataset.url = url
          if (was) URL.revokeObjectURL(was)
          setFramed(true)
          setStatus("live")
          syncSharp()
          return
        }
        let d: { t?: string; text?: string; fatal?: boolean } & State
        try { d = JSON.parse(m.data) } catch { return }
        if (d.t === "state") { setInfo((i) => ({ ...i, ...d })); if (d.title) keepTitle(id, d.title) }
        else if (d.t === "gone") { ended = true; setStatus("gone") }
        else if (d.t === "error" && d.fatal) { ended = true; setError(d.text ?? ""); setStatus(/closed/.test(d.text ?? "") ? "gone" : "error") }
        else if (d.t === "error") setError(d.text ?? "")
      }
      ws.onclose = () => {
        if (sock.current === ws) sock.current = null
        if (stop || ended) return
        setStatus((s) => (s === "live" ? "connecting" : s))
        timer = window.setTimeout(connect, Math.min(10_000, 1000 * 2 ** retry++))
      }
    }
    // A refused WebSocket says nothing of why, so HTTP is asked first.
    void get<LiveTabs>("web-viewer/tabs").then((r) => {
      if (stop) return
      const t = find(r, tab, machine)
      if (!t) { setStatus("gone"); return }
      setInfo((i) => ({ ...t, ...i, ...t }))
      keepTitle(id, t.title)
      connect()
    }, (e) => { if (!stop) { setError(errorText(e, "Couldn't reach the desktop app's browser")); setStatus("error") } })
    return () => { stop = true; clearTimeout(timer); sock.current?.close(); sock.current = null }
  }, [tab, machine, id, live])

  useEffect(() => {
    if (!live) return
    let stop = false
    const read = () => void get<{ steps: LiveStep[]; kept: boolean }>(`web-viewer/tabs/${id}/steps${info.opened ? `?since=${info.opened}` : ""}`)
      .then((r) => { if (!stop) { setSteps(r.steps); setKept(r.kept) } }, () => {})
    read()
    const timer = setInterval(read, 3000)
    return () => { stop = true; clearInterval(timer) }
  }, [id, live, info.opened])

  useEffect(() => () => { const u = img.current?.dataset.url; if (u) URL.revokeObjectURL(u) }, [])

  const raw = (m: Record<string, unknown>) => { const ws = sock.current; if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)) }
  const send = (m: Record<string, unknown>) => raw({ t: "input", ...m })
  const at = (e: { clientX: number; clientY: number }) => {
    const r = img.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  const inside = (p: { x: number; y: number }) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1

  const view = useRef<View>({ s: 1, x: 0, y: 0 })
  const sharpSent = useRef(false)
  const [zoomed, setZoomed] = useState(false)
  const [trackpad, setTrackpad] = useScopedState("web-viewer:live-trackpad", false, "device")
  // Screencast frames carry no cursor, so one is drawn.
  const cursor = useRef({ x: 0.5, y: 0.5, held: false })
  const fit = (v: View): View => {
    const el = img.current, bx = box.current
    if (!el || !bx) return { s: 1, x: 0, y: 0 }
    const s = Math.min(MAX_ZOOM, Math.max(1, v.s))
    const axis = (off: number, size: number, room: number, t: number) =>
      size * s <= room ? (room - size * s) / 2 - off : Math.min(-off, Math.max(room - size * s - off, t))
    return { s, x: axis(el.offsetLeft, el.offsetWidth, bx.clientWidth, v.x), y: axis(el.offsetTop, el.offsetHeight, bx.clientHeight, v.y) }
  }
  const syncSharp = () => {
    const on = view.current.s >= SHARP_AT
    if (on !== sharpSent.current && sock.current?.readyState === WebSocket.OPEN) { sharpSent.current = on; raw({ t: "sharp", on }) }
  }
  const apply = () => {
    const el = img.current, pt = pointer.current
    if (!el) return
    const v = view.current, z = v.s > 1.001
    if (z && !el.style.width) { el.style.width = `${el.offsetWidth}px`; el.style.height = `${el.offsetHeight}px` }
    else if (!z && el.style.width) { el.style.width = ""; el.style.height = "" }
    el.style.transform = z || v.x || v.y ? `translate(${v.x}px, ${v.y}px) scale(${v.s})` : ""
    setZoomed(z)
    syncSharp()
    if (pt) {
      const c = cursor.current
      pt.style.display = trackpadOn.current || c.held ? "" : "none"
      pt.style.transform = `translate(${el.offsetLeft + v.x + c.x * el.offsetWidth * v.s}px, ${el.offsetTop + v.y + c.y * el.offsetHeight * v.s}px)`
      pt.dataset.held = c.held ? "true" : "false"
    }
  }
  const trackpadOn = useRef(trackpad)
  trackpadOn.current = trackpad
  useEffect(apply, [trackpad])
  const zoomTo = (s: number, to: { clientX: number; clientY: number }, from = view.current, fromAt = to) => {
    const el = img.current, b = box.current?.getBoundingClientRect()
    if (!el || !b) return
    const ux = (fromAt.clientX - b.left - el.offsetLeft - from.x) / from.s, uy = (fromAt.clientY - b.top - el.offsetTop - from.y) / from.s
    const n = Math.min(MAX_ZOOM, Math.max(1, s))
    view.current = fit({ s: n, x: to.clientX - b.left - el.offsetLeft - ux * n, y: to.clientY - b.top - el.offsetTop - uy * n })
    apply()
  }
  const unzoom = () => { view.current = { s: 1, x: 0, y: 0 }; apply() }
  useEffect(() => {
    const el = img.current, bx = box.current
    if (!el || !bx) return
    const ro = new ResizeObserver(() => { view.current = fit(view.current); apply() })
    ro.observe(bx)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scrolled = useRef({ dx: 0, dy: 0, x: 0, y: 0, timer: 0 })
  const scroll = (dx: number, dy: number, where: { x: number; y: number }) => {
    const q = scrolled.current, r = img.current!.getBoundingClientRect()
    q.dx += dx / r.width
    q.dy += dy / r.height
    q.x = where.x
    q.y = where.y
    q.timer ||= window.setTimeout(() => {
      q.timer = 0
      if (q.dx || q.dy) send({ type: "wheel", x: q.x, y: q.y, dx: q.dx, dy: q.dy })
      q.dx = q.dy = 0
    }, 40)
  }
  useEffect(() => () => clearTimeout(scrolled.current.timer), [])
  const panOrScroll = (dx: number, dy: number, where: { x: number; y: number }) => {
    const v = view.current, n = fit({ ...v, x: v.x + dx, y: v.y + dy })
    view.current = n
    apply()
    const rx = dx - (n.x - v.x), ry = dy - (n.y - v.y)
    if (Math.abs(rx) + Math.abs(ry) > 0.5) scroll(-rx, -ry, where)
  }
  const moveCursor = (dx: number, dy: number) => {
    const el = img.current, bx = box.current, c = cursor.current
    if (!el || !bx) return
    const r = el.getBoundingClientRect()
    c.x = Math.min(1, Math.max(0, c.x + (dx * TRACKPAD_SPEED) / r.width))
    c.y = Math.min(1, Math.max(0, c.y + (dy * TRACKPAD_SPEED) / r.height))
    const v = view.current, px = el.offsetLeft + v.x + c.x * el.offsetWidth * v.s, py = el.offsetTop + v.y + c.y * el.offsetHeight * v.s
    const edge = (p: number, room: number) => (p < EDGE ? EDGE - p : p > room - EDGE ? room - EDGE - p : 0)
    view.current = fit({ ...v, x: v.x + edge(px, bx.clientWidth), y: v.y + edge(py, bx.clientHeight) })
    apply()
  }

  const fingers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<Gesture | null>(null)
  const lastTap = useRef({ t: 0, x: 0, y: 0 })
  const clicked = useRef({ t: 0, x: 0, y: 0, n: 1 })
  const moved = useRef(0)
  const press = (action: "down" | "up" | "move", where: { x: number; y: number }) =>
    send({ type: "mouse", action, button: action === "up" || cursor.current.held ? "left" : "none", count: 1, ...where })
  const tapCount = (x: number, y: number) => {
    const l = lastTap.current, now = Date.now()
    const count = now - l.t < DOUBLE_MS && (trackpadOn.current || Math.hypot(x - l.x, y - l.y) < 30) ? 2 : 1
    lastTap.current = count === 2 ? { t: 0, x, y } : { t: now, x, y }
    return count
  }
  const pair = () => {
    const [a, b] = [...fingers.current.values()]
    return { mid: { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) }
  }
  const release = (g: Gesture) => {
    clearTimeout(g.hold)
    if (!cursor.current.held) return
    cursor.current.held = false
    press("up", cursor.current)
    apply()
  }
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") {
      if (e.target !== img.current) return
      e.preventDefault()
      keys.current?.focus({ preventScroll: true })
      e.currentTarget.setPointerCapture(e.pointerId)
      // A pointerdown's detail is always 0, so clicks are counted here.
      const c = clicked.current, now = Date.now()
      c.n = now - c.t < DOUBLE_MS && Math.hypot(e.clientX - c.x, e.clientY - c.y) < 5 ? Math.min(3, c.n + 1) : 1
      Object.assign(c, { t: now, x: e.clientX, y: e.clientY })
      send({ type: "mouse", action: "down", button: BUTTON[e.button] ?? "left", count: c.n, modifiers: mods(e), ...at(e) })
      return
    }
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (fingers.current.size === 1) {
      const g: Gesture = { start: { clientX: e.clientX, clientY: e.clientY }, last: { clientX: e.clientX, clientY: e.clientY }, t: Date.now(), moved: false, two: null, hold: 0 }
      const where = at(e)
      if (trackpadOn.current || inside(where)) g.hold = window.setTimeout(() => {
        if (gesture.current !== g || g.moved || g.two) return
        if (!trackpadOn.current) { cursor.current.x = where.x; cursor.current.y = where.y }
        cursor.current.held = true
        haptic("medium")
        press("down", cursor.current)
        apply()
      }, HOLD_MS)
      gesture.current = g
    } else if (fingers.current.size === 2 && gesture.current) {
      release(gesture.current)
      const p = pair()
      gesture.current.two = { from: { ...view.current }, fromAt: p.mid, d: p.d, last: p.mid, kind: null }
    }
  }
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") {
      if (Date.now() - moved.current < (e.buttons ? 30 : 100)) return
      moved.current = Date.now()
      send({ type: "mouse", action: "move", button: e.buttons & 1 ? "left" : "none", modifiers: mods(e), ...at(e) })
      return
    }
    const g = gesture.current, f = fingers.current.get(e.pointerId)
    if (!g || !f) return
    f.x = e.clientX
    f.y = e.clientY
    if (g.two) {
      if (fingers.current.size < 2) return
      const t = g.two, p = pair()
      t.kind ??= !trackpadOn.current ? "pinch" : Math.abs(p.d - t.d) > 24 ? "pinch"
        : Math.hypot(p.mid.clientX - t.fromAt.clientX, p.mid.clientY - t.fromAt.clientY) > SLOP ? "scroll" : null
      if (t.kind === "pinch") zoomTo(t.from.s * (p.d / t.d), p.mid, t.from, t.fromAt)
      else if (t.kind === "scroll") panOrScroll(p.mid.clientX - t.last.clientX, p.mid.clientY - t.last.clientY, at(p.mid))
      t.last = p.mid
      return
    }
    const dx = e.clientX - g.last.clientX, dy = e.clientY - g.last.clientY
    if (!g.moved && Math.hypot(e.clientX - g.start.clientX, e.clientY - g.start.clientY) > SLOP) {
      g.moved = true
      if (!cursor.current.held) clearTimeout(g.hold)
    }
    if (!g.moved) return
    g.last = { clientX: e.clientX, clientY: e.clientY }
    if (trackpadOn.current) {
      moveCursor(dx, dy)
      if (Date.now() - moved.current < 30) return
      moved.current = Date.now()
      press("move", cursor.current)
    } else if (cursor.current.held) {
      const where = at(e)
      cursor.current.x = Math.min(1, Math.max(0, where.x))
      cursor.current.y = Math.min(1, Math.max(0, where.y))
      apply()
      if (Date.now() - moved.current < 30) return
      moved.current = Date.now()
      press("move", cursor.current)
    } else panOrScroll(dx, dy, at(g.start))
  }
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) send({ type: "mouse", action: "up", button: BUTTON[e.button] ?? "left", count: clicked.current.n, modifiers: mods(e), ...at(e) })
      return
    }
    if (!fingers.current.delete(e.pointerId)) return
    const g = gesture.current
    if (fingers.current.size || !g) return
    gesture.current = null
    if (cursor.current.held) return release(g)
    clearTimeout(g.hold)
    if (g.two || g.moved || Date.now() - g.t > HOLD_MS) return
    if (trackpadOn.current) send({ type: "tap", count: tapCount(0, 0), ...cursor.current })
    else {
      const where = at(e)
      if (inside(where)) send({ type: "tap", count: tapCount(e.clientX, e.clientY), ...where })
    }
  }
  const cancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return
    fingers.current.delete(e.pointerId)
    if (fingers.current.size || !gesture.current) return
    release(gesture.current)
    gesture.current = null
  }
  useEffect(() => {
    const el = box.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = img.current!.getBoundingClientRect(), k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1
      // A trackpad's pinch comes as the wheel with Control held.
      if (e.ctrlKey) return zoomTo(view.current.s * Math.exp((-e.deltaY * k) / 100), e)
      if (view.current.s > 1.001) return panOrScroll(-e.deltaX * k, -e.deltaY * k, at(e))
      if (e.target !== img.current) return
      send({ type: "wheel", ...at(e), dx: (e.deltaX * k) / r.width, dy: (e.deltaY * k) / r.height, modifiers: mods(e) })
    }
    el.addEventListener("wheel", wheel, { passive: false })
    return () => el.removeEventListener("wheel", wheel)
  })
  useEffect(() => {
    const el = keys.current
    if (!el) return
    const input = (e: InputEvent) => {
      if (e.isComposing || e.inputType === "insertCompositionText") return
      e.preventDefault()
      if (e.inputType === "deleteContentBackward") send({ type: "key", key: "Backspace" })
      else if (e.inputType === "deleteContentForward") send({ type: "key", key: "Delete" })
      else if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") send({ type: "key", key: "Enter" })
      else if (e.data) send({ type: "text", text: e.data })
    }
    const composed = (e: CompositionEvent) => { if (e.data) send({ type: "text", text: e.data }); el.value = "" }
    const paste = (e: ClipboardEvent) => { e.preventDefault(); const text = e.clipboardData?.getData("text/plain"); if (text) send({ type: "text", text }) }
    el.addEventListener("beforeinput", input)
    el.addEventListener("compositionend", composed)
    el.addEventListener("paste", paste)
    return () => { el.removeEventListener("beforeinput", input); el.removeEventListener("compositionend", composed); el.removeEventListener("paste", paste) }
  })
  const key = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    const chord = (e.metaKey || e.ctrlKey) && e.key.length === 1
    if (!SPECIAL.has(e.key) && !chord) return
    if (chord && e.key.toLowerCase() === "v") return
    if (chord && e.key.toLowerCase() === "c" && !e.altKey && !e.shiftKey) { e.preventDefault(); return copy() }
    e.preventDefault()
    e.stopPropagation()
    send({ type: "key", key: [e.metaKey && "Meta", e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", e.key].filter(Boolean).join("+") })
  }

  // Safari lets a tap write the clipboard only through a ClipboardItem given the text's promise.
  const copy = async () => {
    const got = get<{ text: string }>(`web-viewer/tabs/${id}/selection`).then((r) => r.text)
    const none = () => notify("Nothing is selected in the page: double-tap a word, or hold a finger on the text and drag")
    try {
      if (typeof ClipboardItem === "function" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": got.then((t) => { if (!t) throw new Error("nothing selected"); return new Blob([t], { type: "text/plain" }) }) })])
        return notify("Copied")
      }
    } catch {}
    let text: string
    try { text = await got } catch (e) { return notifyError(e, "Couldn't copy from the page") }
    if (!text) return none()
    await copyText(text)
    notify("Copied")
  }
  const paste = () => void navigator.clipboard?.readText().then((text) => { if (text) send({ type: "text", text }) },
    (e) => { if ((e as Error)?.name !== "NotAllowedError") notifyError(e, "Couldn't paste") })
  const [typing, setTyping] = useState(false)
  const area = useVisibleArea(coarse && typing)
  const arrow = (name: string, Icon: typeof ArrowUp) => ({ name, label: <Icon className="size-[17px]" strokeWidth={2} />, run: () => send({ type: "key", key: `Arrow${name}` }) })
  const barKeys: BarKey[] = [
    { name: "Escape", label: "esc", run: () => send({ type: "key", key: "Escape" }) },
    { name: "Tab", label: "tab", run: () => send({ type: "key", key: "Tab" }) },
    { name: "Shift Tab", label: keysText("⇧tab"), run: () => send({ type: "key", key: "Shift+Tab" }) },
    arrow("Left", ArrowLeft), arrow("Up", ArrowUp), arrow("Down", ArrowDown), arrow("Right", ArrowRight),
    { name: "Paste", label: <ClipboardPaste className="size-[17px]" strokeWidth={2} />, run: paste },
  ]

  const [paused, choosePaused] = useChosen(!!info.paused)
  const pause = () => choosePaused(!paused, () => post(`web-viewer/tabs/${id}/pause`, { on: !paused }), paused ? "Couldn't let agents go on" : "Couldn't stop the agents")
  const [asking, chooseAsking] = useChosen(info.asking ?? null)
  const done = () => chooseAsking(null, () => post(`web-viewer/tabs/${id}/done`, {}), "Couldn't tell the agent")

  const shown = status === "gone" ? "This tab was closed in the desktop app." : status === "error" ? error || "Couldn't show this tab." : !framed ? "Connecting…" : ""
  return (
    <div className="@container flex h-full min-h-0 flex-col" data-web-live={id} data-web-live-status={status}>
      <div ref={bar} className="group/bar flex min-h-10 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b-[0.5px] border-border px-2 py-1">
        <button type="button" onClick={back} className="flex h-11 shrink-0 cursor-pointer items-center gap-1 rounded-[6px] px-2 text-[15px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground md:h-7 md:text-[13px]">
          <ChevronLeft className="size-4" strokeWidth={2} />Tabs
        </button>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-medium md:text-[13px]">{info.title || (info.url ? hostOf(info.url) : "")}</span>
          <span className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
            {info.by && <Bot className="size-3 shrink-0" strokeWidth={2} style={{ color: "var(--purple)" }} />}
            <span className="truncate">{info.by ? whose(info as LiveTab) : info.url ? hostOf(info.url) : ""}</span>
            <Container id={info.container ?? null} />
          </span>
        </span>
        <span className="flex items-center gap-1 max-md:w-full max-md:justify-end">
        {coarse && (
          <Button look="quiet" size="small" aria-label="Trackpad" aria-pressed={trackpad} data-tip="Trackpad"
            onClick={() => setTrackpad(!trackpad)} data-web-live-trackpad={trackpad} className={cn("max-md:size-11 max-md:px-0", trackpad && "bg-foreground/[0.08] text-foreground")}>
            <MousePointer2 className="size-4" strokeWidth={2} />
          </Button>
        )}
        <Button look="quiet" size="small" aria-label="Copy" data-tip="Copy what's selected" onClick={() => void copy()} data-web-live-copy className="max-md:size-11 max-md:px-0">
          <Copy className="size-4" strokeWidth={2} />
        </Button>
        <Button look="quiet" size="small" aria-label="Keyboard" data-tip="Type in the page" onClick={() => keys.current?.focus({ preventScroll: true })} className="max-md:size-11 max-md:px-0">
          <Keyboard className="size-4" strokeWidth={2} />
        </Button>
        <Button look={paused ? "primary" : "secondary"} size="small" onClick={pause} data-web-live-pause={paused ? "resume" : "pause"} className="max-md:h-11">
          {paused ? <Play className="size-3.5" strokeWidth={2.25} /> : <Pause className="size-3.5" strokeWidth={2.25} />}{paused ? "Resume agents" : "Stop agents"}
        </Button>
        <PaneControls />
        </span>
      </div>
      {asking && (
        <div className="flex shrink-0 items-center gap-3 border-b-[0.5px] border-border bg-[color-mix(in_oklab,var(--yellow)_14%,transparent)] px-3 py-2" data-web-live-ask>
          <span className="min-w-0 flex-1 text-[15px] md:text-[13px]"><span className="font-medium">{info.askedBy || "An agent"} asks:</span> {asking}</span>
          <Button look="primary" size="small" onClick={done} className="max-md:h-11" data-web-live-done>Done</Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col @3xl:flex-row">
        <div ref={box} className="relative flex min-h-0 min-w-0 flex-1 touch-none items-center justify-center overflow-hidden bg-muted p-2 [-webkit-touch-callout:none]"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onContextMenu={(e) => e.preventDefault()}>
          <img ref={img} alt={info.title ?? ""} draggable={false} data-web-live-frame data-web-live-zoom={zoomed ? "in" : "fit"}
            style={info.w ? { maxWidth: `min(100%, ${info.w}px)` } : undefined}
            className={cn("max-h-full max-w-full origin-top-left rounded-[4px] shadow-sm ring-[0.5px] ring-border select-none", (!framed || status === "gone") && "hidden")} />
          <div ref={pointer} aria-hidden data-web-live-pointer className="pointer-events-none absolute top-0 left-0 data-[held=true]:[&>svg]:scale-90" style={{ display: "none" }}>
            <MousePointer2 className="size-5 -translate-x-[3px] -translate-y-[2px] fill-foreground text-background drop-shadow-sm transition-transform" strokeWidth={1.5} />
          </div>
          {zoomed && framed && status !== "gone" && (
            <Button look="secondary" size="small" onClick={unzoom} onPointerDown={(e) => e.stopPropagation()} data-web-live-unzoom
              className="absolute right-3 bottom-3 bg-background/90 shadow-sm backdrop-blur-sm max-md:h-11">Zoom to fit</Button>
          )}
          {shown && <p className="max-w-[420px] px-4 text-center text-[15px] text-muted-foreground md:text-[13px]">{shown}</p>}
          {status === "connecting" && framed && <span className="absolute top-3 right-3 rounded-[6px] bg-background/90 px-1.5 py-0.5 text-[11px] text-muted-foreground">Reconnecting…</span>}
          {error && status === "live" && <span className="absolute bottom-3 left-1/2 max-w-[90%] -translate-x-1/2 truncate rounded-[6px] bg-background/90 px-2 py-1 text-[12px]">{error}</span>}
          <textarea ref={keys} onKeyDown={key} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} aria-label="Type in the page" autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false}
            className="pointer-events-none absolute top-0 left-0 size-px resize-none border-0 bg-transparent p-0 text-[16px] opacity-0 outline-none" />
        </div>
        <aside className="flex max-h-[38%] min-h-0 shrink-0 flex-col border-t-[0.5px] border-border @3xl:max-h-none @3xl:w-[280px] @3xl:border-t-0 @3xl:border-l-[0.5px]" data-web-live-steps={steps.length}>
          <div className="px-2 pt-2"><SidebarHeading title="What agents did here" open /></div>
          <ol className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {steps.length ? steps.map((s, i) => (
              <li key={`${s.t}-${i}`} className="flex flex-col rounded-[6px] px-2 py-1">
                <span className={cn("text-[15px] md:text-[13px]", s.failed && "text-ink-(--red)")}>{s.text}</span>
                <span className="text-[12px] text-tertiary">{dateText(s.t, TIME)} · {s.by}</span>
              </li>
            )) : <li className="px-2 py-1 text-[15px] text-tertiary md:text-[13px]">{kept ? "Nothing yet." : "Turn on Activity to see what agents do here."}</li>}
          </ol>
        </aside>
      </div>
      {area?.keyboard && createPortal(
        <div className="fixed inset-x-0 z-[45] -translate-y-full" style={{ top: area.top + area.height }} data-web-live-keys>
          <KeyBar label="Page keys" keys={barKeys} hide={() => keys.current?.blur()} />
        </div>,
        document.body,
      )}
    </div>
  )
}
