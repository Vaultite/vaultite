// A note presented one slide at a time, scaled to fit, with the usual keys, clicks and swipes; it follows the note's
// changes while shown.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject, type TouchEvent } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, X } from "lucide-react"
import { activeFile, cn, getStore, NoteBody, readFile, splitFm, stem, useVaultChange, type Store } from "@vaultite"
import { isTitleSlide, splitSlides } from "./slides"

/** The note as it is now: the editor's text when it's the one being edited (unsaved typing too), else the file's. */
async function textOf(path: string) {
  const f = activeFile()
  return f?.path === path ? f.text() : (await readFile(path)).text
}

/** The widest a slide's text is laid out (then scaled up to the screen), and how far it's scaled at most. */
const BASE = 720
const MAX = 2.2
const MIN = 0.6

/** Scale `inner` (laid out BASE wide, or the stage's width when narrower) to fit `stage`. */
function useFit(stage: RefObject<HTMLDivElement | null>, inner: RefObject<HTMLDivElement | null>, key: unknown) {
  const [fit, setFit] = useState({ w: BASE, scale: 1, h: 0 })
  const measure = useCallback(() => {
    const s = stage.current, el = inner.current
    if (!s || !el) return
    const cs = getComputedStyle(s)
    const aw = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    const ah = s.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
    const w = Math.max(240, Math.min(BASE, aw))
    if (Math.abs(el.offsetWidth - w) > 0.5) el.style.width = `${w}px`
    const h = el.offsetHeight
    const scale = Math.max(MIN, Math.min(MAX, aw / w, h ? ah / h : MAX))
    setFit((f) => (f.w === w && Math.abs(f.scale - scale) < 0.005 && f.h === h ? f : { w, scale, h }))
  }, [stage, inner])
  useLayoutEffect(measure, [measure, key])
  useEffect(() => {
    const ro = new ResizeObserver(measure)
    if (stage.current) ro.observe(stage.current)
    if (inner.current) ro.observe(inner.current)
    return () => ro.disconnect()
  }, [measure, key])
  return fit
}

export function Presentation({ path, onClose }: { path: string; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [at, setAt] = useState(0)
  const [full, setFull] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const store = getStore() as Store

  const load = useCallback(() => { textOf(path).then(setText, () => onClose()) }, [path, onClose])
  useEffect(load, [load])
  useVaultChange(load, [path])

  const { fm, body } = useMemo(() => splitFm(text ?? ""), [text])
  const slides = useMemo(() => splitSlides(body), [body])
  const n = Math.max(1, slides.length)
  const i = Math.min(at, n - 1)
  const md = slides[i] ?? ""
  const fit = useFit(stage, inner, md)

  const go = useCallback((d: number) => setAt((x) => Math.max(0, Math.min(n - 1, Math.min(x, n - 1) + d))), [n])

  // Full screen where the browser has it (not iPhones: there the presentation fills the page). Leaving it (Escape,
  // which the browser takes) ends the presentation, unless it was F.
  const leaving = useRef(false)
  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) { leaving.current = true; void document.exitFullscreen().catch(() => {}) }
    else void root.current?.requestFullscreen?.().catch(() => {})
  }, [])
  useEffect(() => {
    const el = root.current
    el?.focus()
    if (document.fullscreenEnabled && matchMedia("(pointer: fine)").matches) void el?.requestFullscreen?.().catch(() => {})
    const change = () => {
      const on = !!document.fullscreenElement
      setFull(on)
      if (!on && !leaving.current) onClose()
      leaving.current = false
    }
    document.addEventListener("fullscreenchange", change)
    return () => {
      document.removeEventListener("fullscreenchange", change)
      if (document.fullscreenElement === el) { leaving.current = true; void document.exitFullscreen().catch(() => {}) }
    }
  }, [onClose])

  const key = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key
    if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter", "n"].includes(k)) go(1)
    else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p"].includes(k)) go(-1)
    else if (k === "Home") setAt(0)
    else if (k === "End") setAt(n - 1)
    else if (k === "Escape") onClose()
    else if (k === "f") toggleFull()
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  // A click on the slide: the left third goes back, the rest forward; links, players and buttons do their own thing
  // (a link to a note ends the presentation, to show it).
  const click = (e: MouseEvent) => {
    const t = e.target as Element
    if (t.closest("[data-wiki], [data-tag]")) { onClose(); return }
    if (t.closest("a, button, audio, video, iframe, input, summary, details, select, textarea, .note-embed, [data-no-nav]")) return
    if (window.getSelection()?.toString()) return
    const r = root.current!.getBoundingClientRect()
    go(e.clientX - r.left < r.width / 3 ? -1 : 1)
  }
  const touch = useRef<{ x: number; y: number } | null>(null)
  const touchStart = (e: TouchEvent) => { const p = e.touches[0]; touch.current = p ? { x: p.clientX, y: p.clientY } : null }
  const touchEnd = (e: TouchEvent) => {
    const s = touch.current, p = e.changedTouches[0]
    touch.current = null
    if (!s || !p) return
    const dx = p.clientX - s.x, dy = p.clientY - s.y
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { e.preventDefault(); go(dx < 0 ? 1 : -1) }
  }

  const title = isTitleSlide(md)
  const ctl = "grid size-11 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground md:size-9"
  return createPortal(
    <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${stem(path)}, slide ${i + 1} of ${n}`} onKeyDown={key}
      className="group/slides fixed inset-0 z-[70] flex flex-col bg-background text-foreground outline-none select-none" data-presentation={path} data-keeps-keys>
      <div ref={stage} onClick={click} onTouchStart={touchStart} onTouchEnd={touchEnd}
        className="flex min-h-0 flex-1 cursor-default overflow-auto px-6 pt-[max(env(safe-area-inset-top),2rem)] pb-16 md:px-16 md:pt-12">
        <div style={{ width: fit.w * fit.scale, height: fit.h * fit.scale }} className="relative m-auto shrink-0">
          <div ref={inner} key={i} data-slide={i + 1}
            className={cn("absolute top-0 left-0 origin-top-left select-text", title && "text-center [&_.note-prose]:text-[22px] [&_.note-prose]:leading-[30px]")}
            style={{ width: fit.w, transform: `scale(${fit.scale})` }}>
            {text !== null && (md
              ? <NoteBody store={store} path={path} body={md} fm={fm} className="slide-body" />
              : <p className="text-center text-muted-foreground">This note is empty.</p>)}
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:px-4">
        <div className="pointer-events-auto flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover/slides:opacity-100 md:focus-within:opacity-100">
          <button type="button" aria-label="Previous slide" className={ctl} disabled={i === 0} onClick={() => go(-1)}><ChevronLeft className="size-5" strokeWidth={2} /></button>
          <button type="button" aria-label="Next slide" className={ctl} disabled={i === n - 1} onClick={() => go(1)}><ChevronRight className="size-5" strokeWidth={2} /></button>
          {document.fullscreenEnabled && (
            <button type="button" aria-label={full ? "Exit full screen" : "Full screen"} data-tip={full ? "Exit full screen (F)" : "Full screen (F)"} className={cn(ctl, "max-md:hidden")} onClick={toggleFull}>
              {full ? <Minimize2 className="size-4" strokeWidth={2} /> : <Maximize2 className="size-4" strokeWidth={2} />}
            </button>
          )}
        </div>
        <span className="flex-1" />
        <span className="text-[15px] tabular-nums text-muted-foreground md:text-[13px]" data-slide-count>{i + 1} / {n}</span>
      </div>
      <button type="button" aria-label="End presentation" data-tip="End presentation (Esc)" onClick={onClose}
        className={cn(ctl, "absolute top-[max(env(safe-area-inset-top),0.5rem)] right-2 opacity-100 transition-opacity md:top-3 md:right-3 md:opacity-0 md:group-hover/slides:opacity-100 md:focus:opacity-100")}>
        <X className="size-5" strokeWidth={2} />
      </button>
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-foreground/[0.06]" aria-hidden>
        <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${((i + 1) / n) * 100}%` }} />
      </div>
    </div>,
    document.body,
  )
}
