// The browser's tabs from the web app, where there's no Electron (liveroutes.ts on the server, electron/browser/live.ts in
// the desktop app): whose each is, then one watched live to tap, type and scroll in, its agents stopped or an ask done.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react"
import { Bot, ChevronLeft, Globe, Keyboard, Pause, Play } from "lucide-react"
import { Button, closeTab, cn, dateText, errorText, get, post, selectTab, SidebarHeading, SidebarRow, useChosen, usePane, usePaneTopBar, viewsChanged, webPages } from "@vaultite"
import { hostOf } from "./address"
import { colorOf, containerById } from "./containers"
import type { LiveStep, LiveTab } from "./livetabs"

const titles = new Map<number, string>()
/** A watched tab's title, for its tab. */
export const liveTitle = (tab: number) => titles.get(tab)
function keepTitle(tab: number, title: string) {
  if (!title || titles.get(tab) === title) return
  titles.set(tab, title)
  viewsChanged()
}

const TIME = { hour: "numeric", minute: "2-digit" } as const
const whose = (t: Pick<LiveTab, "by" | "task">) => (t.by ? [t.by, t.task].filter(Boolean).join("/") : "Yours")

/** Whether the page is on screen (a phone's app in the background isn't): what's live stops meanwhile. */
function useOnScreen() {
  const [on, setOn] = useState(document.visibilityState === "visible")
  useEffect(() => {
    const f = () => setOn(document.visibilityState === "visible")
    document.addEventListener("visibilitychange", f)
    return () => document.removeEventListener("visibilitychange", f)
  }, [])
  return on
}

/** The tabs, read again every 2 s while shown. */
function useTabs(on: boolean) {
  const [tabs, setTabs] = useState<LiveTab[] | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    if (!on) return
    let stop = false
    const read = () => void get<{ tabs: LiveTab[] }>("web-viewer/tabs").then((r) => {
      if (stop) return
      setTabs(r.tabs)
      setError("")
      for (const t of r.tabs) keepTitle(t.tab, t.title)
    }, (e) => { if (!stop) setError(errorText(e, "Couldn't reach the desktop app's browser")) })
    read()
    const timer = setInterval(read, 2000)
    return () => { stop = true; clearInterval(timer) }
  }, [on])
  return { tabs, error }
}

export function LiveView({ arg, setArg }: { arg: string; setArg: (arg: string) => void }) {
  const tab = Number(arg)
  return tab > 0 ? <Watch tab={tab} back={() => setArg("")} /> : <Tabs open={(t) => setArg(String(t))} />
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

function Tabs({ open }: { open: (tab: number) => void }) {
  const { hidden } = usePane()
  const { tabs, error } = useTabs(!hidden && useOnScreen())
  const asking = (tabs ?? []).filter((t) => t.asking)
  const agents = (tabs ?? []).filter((t) => !t.asking && t.by)
  const yours = (tabs ?? []).filter((t) => !t.asking && !t.by)
  const rows = (list: LiveTab[]) => (
    <div className="flex flex-col gap-px" data-size-up>
      {list.map((t) => (
        <SidebarRow key={t.tab} icon={t.by ? Bot : Globe} tint={t.by ? "var(--purple)" : undefined} badge={t.asking ? "ask" : undefined} open
          onClick={() => open(t.tab)} data-web-live-tab={t.tab} tip={null}
          label={<span className="flex min-w-0 items-baseline gap-1.5"><span className="min-w-0 shrink truncate">{t.title || hostOf(t.url)}</span>
            <span className="min-w-0 shrink-[2] truncate text-[12px] text-muted-foreground">{t.asking ?? (t.by ? whose(t) : hostOf(t.url))}</span></span>}>
          <span className="mr-1 flex shrink-0 items-center gap-2">
            {t.paused && <span className="text-[12px] text-muted-foreground">Paused</span>}
            <Container id={t.container} />
          </span>
        </SidebarRow>
      ))}
    </div>
  )
  return (
    <div className="h-full overflow-y-auto overscroll-contain"><div className="mx-auto max-w-[760px] px-4 pt-4 pb-10" data-web-live-list>
      <h1 className="mb-1 text-[20px] font-semibold">Browser tabs</h1>
      <p className="mb-4 text-[15px] text-muted-foreground md:text-[13px]">The web pages open in the desktop app. Open one to watch it, tap and type in it, or stop the agent working there.</p>
      {error ? <p className="text-[15px] text-muted-foreground md:text-[13px]">{error}</p>
        : tabs && !tabs.length ? <p className="text-[15px] text-tertiary md:text-[13px]">No web pages are open in the desktop app.</p> : null}
      {asking.length > 0 && <section className="mb-4"><SidebarHeading title="Needs you" open />{rows(asking)}</section>}
      {agents.length > 0 && <section className="mb-4"><SidebarHeading title="Agents" open />{rows(agents)}</section>}
      {yours.length > 0 && <section className="mb-4"><SidebarHeading title="Yours" open />{rows(yours)}</section>}
    </div></div>
  )
}

type State = Partial<LiveTab> & { tab: number }
const SPECIAL = new Set(["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"])
const BUTTON = ["left", "middle", "right"]
const mods = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
  (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)

function Watch({ tab, back }: { tab: number; back: () => void }) {
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
  usePaneTopBar(bar)
  const live = !hidden && onScreen

  // In the desktop app the tab itself is there: shown instead (an Inbox item's link opens this).
  useEffect(() => {
    if (!webPages?.engine || !own) return
    void get<{ tabs: LiveTab[] }>("web-viewer/tabs").then((r) => {
      const t = r.tabs.find((x) => x.tab === tab)
      if (t?.appTab) { selectTab(t.appTab); closeTab(own, true) }
    }, () => {})
  }, [tab, own])

  useEffect(() => {
    if (!live) return
    let stop = false, retry = 0, timer = 0
    const connect = () => {
      if (stop) return
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/web-viewer/live/${tab}`)
      ws.binaryType = "blob"
      sock.current = ws
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
          return
        }
        let d: { t?: string; text?: string; fatal?: boolean } & State
        try { d = JSON.parse(m.data) } catch { return }
        if (d.t === "state") { setInfo((i) => ({ ...i, ...d })); if (d.title) keepTitle(tab, d.title) }
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
    // (asked over HTTP first: a refused socket says nothing of why)
    void get<{ tabs: LiveTab[] }>("web-viewer/tabs").then((r) => {
      if (stop) return
      const t = r.tabs.find((x) => x.tab === tab)
      if (!t) { setStatus("gone"); return }
      setInfo((i) => ({ ...t, ...i, ...t }))
      keepTitle(tab, t.title)
      connect()
    }, (e) => { if (!stop) { setError(errorText(e, "Couldn't reach the desktop app's browser")); setStatus("error") } })
    return () => { stop = true; clearTimeout(timer); sock.current?.close(); sock.current = null }
  }, [tab, live])

  // What agents did here since it opened, from Activity.
  useEffect(() => {
    if (!live) return
    let stop = false
    const read = () => void get<{ steps: LiveStep[]; kept: boolean }>(`web-viewer/tabs/${tab}/steps${info.opened ? `?since=${info.opened}` : ""}`)
      .then((r) => { if (!stop) { setSteps(r.steps); setKept(r.kept) } }, () => {})
    read()
    const timer = setInterval(read, 3000)
    return () => { stop = true; clearInterval(timer) }
  }, [tab, live, info.opened])

  useEffect(() => () => { const u = img.current?.dataset.url; if (u) URL.revokeObjectURL(u) }, [])

  const send = (m: Record<string, unknown>) => { const ws = sock.current; if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "input", ...m })) }
  const at = (e: { clientX: number; clientY: number }) => {
    const r = img.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  // Input: a mouse as itself; a finger taps (a click) or drags (a scroll); keys through a hidden field that has the focus.
  const touch = useRef<{ x: number; y: number; t: number; lastX: number; lastY: number; moved: boolean; sent: number } | null>(null)
  const moved = useRef(0)
  const down = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (e.pointerType === "mouse") {
      e.preventDefault()
      keys.current?.focus({ preventScroll: true })
      e.currentTarget.setPointerCapture(e.pointerId)
      send({ type: "mouse", action: "down", button: BUTTON[e.button] ?? "left", count: e.detail || 1, modifiers: mods(e), ...at(e) })
    } else touch.current = { x: e.clientX, y: e.clientY, t: Date.now(), lastX: e.clientX, lastY: e.clientY, moved: false, sent: 0 }
  }
  const move = (e: ReactPointerEvent<HTMLImageElement>) => {
    const r = img.current!.getBoundingClientRect()
    if (e.pointerType === "mouse") {
      if (Date.now() - moved.current < (e.buttons ? 30 : 100)) return
      moved.current = Date.now()
      send({ type: "mouse", action: "move", button: e.buttons & 1 ? "left" : "none", modifiers: mods(e), ...at(e) })
      return
    }
    const t = touch.current
    if (!t) return
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8) t.moved = true
    if (!t.moved || Date.now() - t.sent < 40) return
    send({ type: "wheel", ...at({ clientX: t.x, clientY: t.y }), dx: (t.lastX - e.clientX) / r.width, dy: (t.lastY - e.clientY) / r.height })
    t.lastX = e.clientX
    t.lastY = e.clientY
    t.sent = Date.now()
  }
  const up = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (e.pointerType === "mouse") { send({ type: "mouse", action: "up", button: BUTTON[e.button] ?? "left", count: e.detail || 1, modifiers: mods(e), ...at(e) }); return }
    const t = touch.current
    touch.current = null
    if (t && !t.moved && Date.now() - t.t < 600) send({ type: "tap", ...at(e) })
  }
  useEffect(() => {
    const el = img.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect(), k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1
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
    if (chord && e.key.toLowerCase() === "v") return // (the paste event brings the text)
    e.preventDefault()
    e.stopPropagation()
    send({ type: "key", key: [e.metaKey && "Meta", e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", e.key].filter(Boolean).join("+") })
  }

  const [paused, choosePaused] = useChosen(!!info.paused)
  const pause = () => choosePaused(!paused, () => post(`web-viewer/tabs/${tab}/pause`, { on: !paused }), paused ? "Couldn't let agents go on" : "Couldn't stop the agents")
  const [asking, chooseAsking] = useChosen(info.asking ?? null)
  const done = () => chooseAsking(null, () => post(`web-viewer/tabs/${tab}/done`, {}), "Couldn't tell the agent")

  const shown = status === "gone" ? "This tab was closed in the desktop app." : status === "error" ? error || "Couldn't show this tab." : !framed ? "Connecting…" : ""
  return (
    <div className="@container flex h-full min-h-0 flex-col" data-web-live={tab} data-web-live-status={status}>
      <div ref={bar} className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b-[0.5px] border-border px-2 py-1">
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
        <Button look="quiet" size="small" aria-label="Keyboard" data-tip="Type in the page" onClick={() => keys.current?.focus({ preventScroll: true })} className="max-md:size-11 max-md:px-0">
          <Keyboard className="size-4" strokeWidth={2} />
        </Button>
        <Button look={paused ? "primary" : "secondary"} size="small" onClick={pause} data-web-live-pause={paused ? "resume" : "pause"} className="max-md:h-11">
          {paused ? <Play className="size-3.5" strokeWidth={2.25} /> : <Pause className="size-3.5" strokeWidth={2.25} />}{paused ? "Resume agents" : "Stop agents"}
        </Button>
        </span>
      </div>
      {asking && (
        <div className="flex shrink-0 items-center gap-3 border-b-[0.5px] border-border bg-[color-mix(in_oklab,var(--yellow)_14%,transparent)] px-3 py-2" data-web-live-ask>
          <span className="min-w-0 flex-1 text-[15px] md:text-[13px]"><span className="font-medium">{info.askedBy || "An agent"} asks:</span> {asking}</span>
          <Button look="primary" size="small" onClick={done} className="max-md:h-11" data-web-live-done>Done</Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col @3xl:flex-row">
        <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-muted p-2">
          <img ref={img} alt={info.title ?? ""} draggable={false} data-web-live-frame
            className={cn("max-h-full max-w-full touch-none rounded-[4px] shadow-sm ring-[0.5px] ring-border select-none", (!framed || status === "gone") && "hidden")}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { touch.current = null }} onContextMenu={(e) => e.preventDefault()} />
          {shown && <p className="max-w-[420px] px-4 text-center text-[15px] text-muted-foreground md:text-[13px]">{shown}</p>}
          {status === "connecting" && framed && <span className="absolute top-3 right-3 rounded-[6px] bg-background/90 px-1.5 py-0.5 text-[11px] text-muted-foreground">Reconnecting…</span>}
          {error && status === "live" && <span className="absolute bottom-3 left-1/2 max-w-[90%] -translate-x-1/2 truncate rounded-[6px] bg-background/90 px-2 py-1 text-[12px]">{error}</span>}
          <textarea ref={keys} onKeyDown={key} aria-label="Type in the page" autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false}
            className="pointer-events-none absolute top-0 left-0 size-px resize-none border-0 bg-transparent p-0 text-[16px] opacity-0 outline-none" />
        </div>
        <aside className="flex max-h-[38%] min-h-0 shrink-0 flex-col border-t-[0.5px] border-border @3xl:max-h-none @3xl:w-[280px] @3xl:border-t-0 @3xl:border-l-[0.5px]" data-web-live-steps={steps.length}>
          <div className="px-2 pt-2"><SidebarHeading title="What agents did here" open /></div>
          <ol className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {steps.length ? steps.map((s, i) => (
              <li key={`${s.t}-${i}`} className="flex flex-col rounded-[6px] px-2 py-1">
                <span className={cn("text-[15px] md:text-[13px]", s.failed && "text-[var(--red)]")}>{s.text}</span>
                <span className="text-[12px] text-tertiary">{dateText(s.t, TIME)} · {s.by}</span>
              </li>
            )) : <li className="px-2 py-1 text-[15px] text-tertiary md:text-[13px]">{kept ? "Nothing yet." : "Turn on Activity to see what agents do here."}</li>}
          </ol>
        </aside>
      </div>
    </div>
  )
}
