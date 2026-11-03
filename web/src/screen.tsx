// The companion over the whole screen (electron/overlay.ts, a window a display): cursors in other apps, their bubbles, the
// companion waiting, the dictation pill. The pointer goes through but over them: a cursor dragged onto a window points.
import { StrictMode, useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { makePill } from "@/core/pill"
import { snippet } from "@/core/plaintext"
import { followSystemTheme } from "@/lib/utils"

type Say = { id: string; text: string; question?: boolean }
type Shown = { width: number; height: number
  agents: { name: string; tint: string; state: string; sx: number; sy: number; say?: Say }[]
  idle: { name: string; tint: string; sx: number; sy: number; docked: boolean } | null
  pill: { level: number; text: string; ready: boolean } | null }
type Bridge = { on: (fn: (s: Shown) => void) => () => void; grab: (on: boolean) => void; drop: (name: string, x: number, y: number) => void
  dismiss: (id: string) => void; stop: () => void }
const api = (window as unknown as { vaultiteScreen?: Bridge }).vaultiteScreen

followSystemTheme()

const WORDS: Record<string, string> = { reading: "reading", thinking: "thinking", writing: "writing", starting: "starting", listening: "listening" }

/** What the pointer is over takes it (to drag, to click); let go, it goes through again. */
let held = 0
const grab = (on: boolean) => { held = Math.max(0, held + (on ? 1 : -1)); api?.grab(held > 0) }

function Arrow({ tint }: { tint: string }) {
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
      <path d="M3 2.5 L16.5 9.2 L10.3 10.9 L7.6 16.8 Z" fill={tint} stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

/** A cursor or the waiting dot: dragged and dropped, it tells where. */
function useDrag(name: string) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const down = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget, id = e.pointerId
    el.setPointerCapture(id)
    const move = (ev: PointerEvent) => setAt({ x: ev.clientX, y: ev.clientY })
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
      setAt(null)
      if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 6) api?.drop(name, ev.clientX, ev.clientY)
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
  }
  return { at, down }
}

function Hold({ children, className, style, onPointerDown }: { children: React.ReactNode; className?: string; style?: React.CSSProperties; onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void }) {
  const over = useRef(false)
  useEffect(() => () => { if (over.current) grab(false) }, [])
  return (
    <div className={className} style={style} onPointerDown={onPointerDown}
      onPointerEnter={() => { if (!over.current) { over.current = true; grab(true) } }}
      onPointerLeave={() => { if (over.current) { over.current = false; grab(false) } }}>
      {children}
    </div>
  )
}

function Cursor({ a }: { a: Shown["agents"][number] }) {
  const tint = `var(--${a.tint})`, { at, down } = useDrag(a.name)
  const x = at?.x ?? a.sx, y = at?.y ?? a.sy, right = x > innerWidth - 320
  const words = WORDS[a.state]
  return (
    <div className="fixed top-0 left-0" style={{ transform: `translate(${x - 3}px, ${y - 2}px)`, transition: at ? "none" : "transform 380ms cubic-bezier(0.3, 0.7, 0.2, 1)" }}>
      <Hold className="cursor-grab" onPointerDown={down}><Arrow tint={tint} /></Hold>
      <div className={`absolute top-4 flex flex-col gap-1 ${right ? "right-3 items-end" : "left-3 items-start"}`}>
        <Hold className="w-max cursor-grab rounded-full px-1.5 text-[12px] leading-[18px] font-medium text-white shadow-sm" style={{ background: tint }} onPointerDown={down}>
          {a.name}{words ? <span className="opacity-80"> · {words}</span> : null}
        </Hold>
        {a.say && (
          <Hold className="w-max max-w-[300px] cursor-default rounded-[10px] border border-border bg-popover px-2.5 py-1.5 text-[13px] leading-snug text-popover-foreground shadow-md"
            onPointerDown={() => api?.dismiss(a.say!.id)}>
            {snippet(a.say.text)}
          </Hold>
        )}
      </div>
    </div>
  )
}

/** The companion waiting: a dot at the screen's edge, or by the pointer (which it never takes: it's under it). */
function Idle({ i }: { i: NonNullable<Shown["idle"]> }) {
  const tint = `var(--${i.tint})`, { at, down } = useDrag(i.name)
  if (!i.docked && !at) return <div className="pointer-events-none fixed top-0 left-0 opacity-80" style={{ transform: `translate(${i.sx}px, ${i.sy}px) scale(0.7)`, transformOrigin: "0 0" }}><Arrow tint={tint} /></div>
  const x = at?.x ?? i.sx, y = at?.y ?? i.sy
  return (
    <Hold className="fixed top-0 left-0 grid size-5 cursor-grab place-items-center" style={{ transform: `translate(${x - 10}px, ${y - 10}px)` }} onPointerDown={down}>
      {at ? <Arrow tint={tint} /> : <span className="size-3 rounded-full shadow-[0_0_0_2px_white,0_1px_4px_rgba(0,0,0,0.3)]" style={{ background: tint }} />}
    </Hold>
  )
}

function Pill({ p }: { p: NonNullable<Shown["pill"]> }) {
  const box = useRef<HTMLDivElement>(null), now = useRef(p)
  now.current = p
  useEffect(() => {
    const pill = makePill()
    pill.el.style.position = "static"
    box.current!.append(pill.el)
    let raf = requestAnimationFrame(function frame(t) { raf = requestAnimationFrame(frame); pill.set(now.current.level, now.current.ready, now.current.text, t) })
    return () => { cancelAnimationFrame(raf); pill.el.remove() }
  }, [])
  return <Hold className="fixed bottom-14 left-1/2 -translate-x-1/2 cursor-default" onPointerDown={() => api?.stop()}><div ref={box} /></Hold>
}

function Screen() {
  const [s, set] = useState<Shown | null>(null)
  useEffect(() => api?.on(set), [])
  if (!s) return null
  return (
    <>
      {s.agents.map((a) => <Cursor key={a.name} a={a} />)}
      {s.idle && <Idle i={s.idle} />}
      {s.pill && <Pill p={s.pill} />}
    </>
  )
}

document.documentElement.style.background = "transparent"
createRoot(document.getElementById("root")!).render(<StrictMode><Screen /></StrictMode>)
