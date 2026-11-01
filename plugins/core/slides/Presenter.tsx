// The presenter view, as reveal.js' speaker view: a window of its own with the slide, the next step, the notes, a
// timer and the clock. Drawn from the presentation's own React tree into the popup's document (one state, both windows).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react"
import { cn, dateText, Tooltips } from "@vaultite"
import { elapsedText } from "./slides"

export type PresenterWindow = { win: Window; root: HTMLElement; close: () => void }
export type Keys = Pick<globalThis.KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "preventDefault" | "stopPropagation">

/** Open (or take back) the presenter's window, with the app's stylesheets and look copied into it and kept in step;
 *  null when the browser won't open one. `gone`: the user closed it. */
export function openPresenter(title: string, gone: () => void): PresenterWindow | null {
  const win = window.open("", "vaultite-presenter", `popup,width=${Math.min(1280, screen.availWidth)},height=${Math.min(800, screen.availHeight)}`)
  if (!win) return null
  const doc = win.document
  doc.head.replaceChildren()
  doc.title = title
  const root = doc.createElement("div")
  doc.body.replaceChildren(root)
  const clones = new Map<Element, Element>()
  const sync = () => {
    const from = document.documentElement, to = doc.documentElement
    for (const a of [...to.attributes]) if (!from.hasAttribute(a.name)) to.removeAttribute(a.name)
    for (const a of from.attributes) if (to.getAttribute(a.name) !== a.value) to.setAttribute(a.name, a.value)
    doc.body.className = document.body.className
    const want = [...document.head.querySelectorAll<HTMLElement>('link[rel="stylesheet"], style')]
    for (const [o, c] of clones) if (!want.includes(o as HTMLElement)) { c.remove(); clones.delete(o) }
    let prev: Node | null = null
    for (const o of want) {
      let c = clones.get(o)
      if (!c) clones.set(o, (c = o.cloneNode(true) as Element))
      if (o instanceof HTMLLinkElement) { if ((c as HTMLLinkElement).href !== o.href) (c as HTMLLinkElement).href = o.href }
      else if (c.textContent !== o.textContent) c.textContent = o.textContent
      // (moved only when out of place: moving a <link> loads its sheet again)
      const at: Node | null = prev ? prev.nextSibling : doc.head.firstChild
      if (c !== at) doc.head.insertBefore(c, at)
      prev = c
    }
  }
  sync()
  const mo = new MutationObserver(sync)
  mo.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true })
  mo.observe(document.documentElement, { attributes: true })
  mo.observe(document.body, { attributes: true, attributeFilter: ["class"] })
  // (polled too: a closed popup doesn't always say so)
  const check = setInterval(() => { if (win.closed) left() }, 1000)
  const left = () => { stop(); gone() }
  const stop = () => { mo.disconnect(); clearInterval(check); win.removeEventListener("pagehide", left); removeEventListener("pagehide", close) }
  const close = () => { stop(); win.close() }
  win.addEventListener("pagehide", left)
  addEventListener("pagehide", close) // the app reloading takes its presenter with it
  win.focus()
  return { win, root, close }
}

/** `children` (a slide as drawn on a screen `size`), scaled down into the box, the shape of that screen. */
export function Screen({ size, label, bare, children }: { size: { w: number; h: number }; label: string; bare?: boolean; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null)
  const [k, setK] = useState(0)
  useLayoutEffect(() => {
    const el = frame.current
    const view = el?.ownerDocument.defaultView
    if (!el || !view) return
    const fit = () => setK(Math.min(el.clientWidth / size.w, el.clientHeight / size.h))
    fit()
    const ro = new (view as typeof globalThis).ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [size.w, size.h])
  return (
    <div ref={frame} className="flex min-h-0 min-w-0 flex-1 items-start">
      <div role="img" aria-label={label} className={cn("relative shrink-0 overflow-hidden bg-background", !bare && "rounded-[10px] ring-1 ring-border")}
        style={{ width: size.w * k, height: size.h * k }}>
        <div className="absolute top-0 left-0 flex origin-top-left flex-col" style={{ width: size.w, height: size.h, transform: `scale(${k})` }}>{children}</div>
      </div>
    </div>
  )
}

/** Now, every second (by the popup's clock: the presentation's window may be out of sight). */
function useNow(win: Window) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    let t = 0
    const tick = () => { setNow(Date.now()); t = win.setTimeout(tick, 1000 - (Date.now() % 1000) + 5) }
    tick()
    return () => win.clearTimeout(t)
  }, [win])
  return now
}

const CLOCK = { hour: "numeric", minute: "2-digit" } as const
const label = "px-1 pb-1.5 text-[13px] text-muted-foreground"
const ctl = "grid size-9 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"

export type Timer = { start: number; paused: number | null }
export function Presenter({ win, size, at, n, current, next, notes, css, timer, setTimer, total, onKey, onPrev, onNext, canPrev, canNext }: {
  win: Window; size: { w: number; h: number }; at: number; n: number; current: ReactNode; next: ReactNode | null; notes: ReactNode; css: ReactNode
  /** The presentation's timer (it's from when it started); `total`: its timeForPresentation (s), 0 for none. */
  timer: Timer; setTimer: (f: (t: Timer) => Timer) => void; total: number
  onKey: (e: Keys) => void; onPrev: () => void; onNext: () => void; canPrev: boolean; canNext: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const now = useNow(win)
  const taken = (timer.paused ?? now) - timer.start
  const pause = () => setTimer((t) => (t.paused === null ? { ...t, paused: Date.now() } : { start: t.start + Date.now() - t.paused, paused: null }))
  const reset = () => setTimer((t) => ({ start: Date.now(), paused: t.paused === null ? null : Date.now() }))
  useEffect(() => { root.current?.focus() }, [])
  // Keys from anywhere in the window: a button clicked and then disabled leaves the focus on its body.
  const keys = useRef(onKey)
  keys.current = onKey
  useEffect(() => {
    const down = (e: globalThis.KeyboardEvent) => keys.current(e)
    win.addEventListener("keydown", down)
    return () => win.removeEventListener("keydown", down)
  }, [win])
  return (
    <div ref={root} tabIndex={-1} data-presenter
      className="flex h-dvh flex-col bg-background text-foreground outline-none select-none">
      {css}
      <Tooltips win={win} />
      <div className="flex min-h-0 flex-1 gap-4 p-4 max-md:flex-col">
        <section aria-label="Current slide" className="flex min-h-0 min-w-0 flex-[1.7] flex-col max-md:flex-1" data-presenter-current>
          <div className={cn(label, "tabular-nums")} data-presenter-count>Slide {at + 1} of {n}</div>
          <Screen size={size} label={`Slide ${at + 1}`}>{current}</Screen>
        </section>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          <section aria-label="Next" className="flex h-[36%] min-h-0 flex-col" data-presenter-next>
            <div className={label}>Next</div>
            {next
              ? <Screen size={size} label="Next">{next}</Screen>
              : <div className="grid flex-1 place-items-center rounded-[10px] text-[15px] text-muted-foreground ring-1 ring-border">End of the presentation</div>}
          </section>
          <section aria-label="Speaker notes" className="flex min-h-0 flex-1 flex-col">
            <div className={label}>Speaker notes</div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-[10px] bg-card px-4 py-3 ring-1 ring-border select-text [&_.note-prose]:text-[20px] [&_.note-prose]:leading-[30px]" data-presenter-notes>
              {notes}
            </div>
          </section>
        </div>
      </div>
      <div className="flex h-14 shrink-0 items-center gap-1 border-t border-border px-3">
        <button type="button" aria-label="Previous slide" data-tip="Previous slide" className={ctl} disabled={!canPrev} onClick={onPrev}><ChevronLeft className="size-5" strokeWidth={2} /></button>
        <button type="button" aria-label="Next slide" data-tip="Next slide" className={ctl} disabled={!canNext} onClick={onNext}><ChevronRight className="size-5" strokeWidth={2} /></button>
        <span className="flex-1" />
        <span className={cn("text-[22px] font-medium tabular-nums", timer.paused !== null && "text-muted-foreground", total && taken >= total * 1000 && "text-[var(--red)]")} data-timer aria-label="Time taken">{elapsedText(taken)}</span>
        {total > 0 && <span className="pl-1 text-[22px] tabular-nums text-muted-foreground" data-timer-total aria-label="Time for the presentation">/ {elapsedText(total * 1000)}</span>}
        <button type="button" aria-label={timer.paused === null ? "Pause timer" : "Resume timer"} data-tip={timer.paused === null ? "Pause timer" : "Resume timer"} className={ctl} onClick={pause}>
          {timer.paused === null ? <Pause className="size-4" strokeWidth={2} /> : <Play className="size-4" strokeWidth={2} />}
        </button>
        <button type="button" aria-label="Reset timer" data-tip="Reset timer" className={ctl} onClick={reset}><RotateCcw className="size-4" strokeWidth={2} /></button>
        <span className="mx-3 h-5 w-px bg-border" aria-hidden />
        <span className="pr-2 text-[22px] tabular-nums text-muted-foreground" data-clock aria-label="Time">{dateText(now, CLOCK)}</span>
      </div>
    </div>
  )
}
