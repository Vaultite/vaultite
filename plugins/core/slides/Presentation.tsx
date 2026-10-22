// A note presented one slide at a time, scaled to fit, with the usual keys, clicks and swipes; it follows the note's
// changes while shown. Advanced Slides decks (slides.ts) also get their notes, fragments, backgrounds and <style>.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type RefObject, type TouchEvent } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, NotebookText, X } from "lucide-react"
import { activeFile, cn, getStore, NoteBody, rawUrl, readFile, readProps, resolver, snippet, splitFm, stem, useVaultChange, type Store } from "@vaultite"
import { isTitleSlide, parseDeck, scopeCss, type Slide } from "./slides"

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

/** Element annotations onto what they annotate, as reveal.js does: the element just before the comment, else the one
 *  it's in; a comment on its own line, the block above. Fragmented list items: their item. */
function annotate(root: HTMLElement, slide: Slide) {
  for (const mark of root.querySelectorAll<HTMLElement>('span[class^="slide-el-"]')) {
    const a = slide.els[Number(mark.className.slice(9))]
    const parent = mark.parentElement
    let target: Element | null = null
    if (a?.li) target = mark.closest("li")
    else if (a) {
      for (let p = mark.previousSibling; p && !target; p = p.previousSibling) if (p instanceof Element && p.tagName !== "BR") target = p
      target ??= parent
      if (target === parent && parent?.tagName === "P" && parent.childNodes.length === 1) { target = parent.previousElementSibling; parent.remove() }
    }
    mark.remove()
    if (!a || !target || !root.contains(target)) continue
    target.classList.add(...a.cls.split(/\s+/).filter(Boolean))
    if (a.style) target.setAttribute("style", [target.getAttribute("style"), a.style].filter(Boolean).join("; "))
    if (a.index !== undefined) (target as HTMLElement).dataset.fragmentIndex = String(a.index)
  }
}

/** The slide's fragments in the order they come in: by data-fragment-index (one index, one step), then the rest. */
function fragmentsOf(root: HTMLElement): HTMLElement[][] {
  const at = new Map<number, HTMLElement[]>(), rest: HTMLElement[][] = []
  for (const f of root.querySelectorAll<HTMLElement>(".fragment")) {
    const k = Number.parseInt(f.dataset.fragmentIndex ?? "", 10)
    if (!Number.isFinite(k)) rest.push([f])
    else if (at.has(k)) at.get(k)!.push(f)
    else at.set(k, [f])
  }
  return [...[...at].sort((a, b) => a[0] - b[0]).map((e) => e[1]), ...rest]
}

/** Light or dark, for a background colour; null when it isn't one (or is see-through). */
const tones = new Map<string, "light" | "dark" | null>()
function toneOf(color: string) {
  if (tones.has(color)) return tones.get(color)!
  let tone: "light" | "dark" | null = null
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
  if (c && CSS.supports("color", color)) {
    c.fillStyle = color
    c.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data
    const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    if (a >= 128) tone = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.18 ? "dark" : "light"
  }
  tones.set(color, tone)
  return tone
}
/** reveal.js themes, by how they look: a deck's theme sets its slides' tone. */
const DARK_THEMES = /^(black|night|league|blood|moon|dracula|black-contrast)$/i
const LIGHT_THEMES = /^(white|beige|sky|serif|simple|solarized|white-contrast)$/i
const IMAGE = /^(https?:|data:image\/)|\.(png|jpe?g|gif|webp|avif|svg|bmp)([?#]|$)/i

/** Fragments as reveal.js draws them; the deck's own CSS vars (--r-*) where the app's would be. */
const DECK_CSS = `
[data-deck] { --r-code-font: var(--font-code); background-color: var(--r-background-color, transparent); color: var(--r-main-color, inherit); }
[data-deck] :is(code, pre, kbd) { font-family: var(--r-code-font), var(--font-code); }
[data-deck] .fragment { transition: opacity .3s ease, transform .3s ease, color .3s ease; }
[data-deck] .fragment:not(.visible) { opacity: 0; }
[data-deck] .fragment:is(.fade-out, .semi-fade-out, .strike, .grow, .shrink, [class*="highlight-"]) { opacity: 1; }
[data-deck] .fragment.fade-out.visible { opacity: 0; }
[data-deck] .fragment.semi-fade-out.visible, [data-deck] .fragment.fade-in-then-semi-out.visible:not(.current-fragment) { opacity: .5; }
[data-deck] .fragment:is(.fade-in-then-out, .current-visible).visible:not(.current-fragment) { opacity: 0; }
[data-deck] .fragment.fade-up:not(.visible) { transform: translateY(40px); }
[data-deck] .fragment.fade-down:not(.visible) { transform: translateY(-40px); }
[data-deck] .fragment.fade-left:not(.visible) { transform: translateX(40px); }
[data-deck] .fragment.fade-right:not(.visible) { transform: translateX(-40px); }
[data-deck] .fragment:is(.fade-up, .fade-down, .fade-left, .fade-right, .grow, .shrink) { display: inline-block; }
[data-deck] li.fragment, [data-deck] :is(p, h1, h2, h3, h4, h5, h6, div).fragment { display: revert; }
[data-deck] .fragment.grow.visible { transform: scale(1.3); }
[data-deck] .fragment.shrink.visible { transform: scale(.7); }
[data-deck] .fragment.strike.visible { text-decoration: line-through; }
[data-deck] .fragment:is(.highlight-red.visible, .highlight-current-red.current-fragment) { color: var(--red); }
[data-deck] .fragment:is(.highlight-green.visible, .highlight-current-green.current-fragment) { color: var(--green); }
[data-deck] .fragment:is(.highlight-blue.visible, .highlight-current-blue.current-fragment) { color: var(--blue); }
`

/** A slide by its first heading, else its text. */
const nextName = (md: string) => {
  const plain = md.replace(/<span class="slide-el-\d+"><\/span>/g, "")
  return snippet(/^#{1,6}\s+(.+)$/m.exec(plain)?.[1] ?? plain.replace(/!\[\[[^\]]*\]\]/g, ""))
}

/** Speaker notes, shown or not, for every presentation till the app reloads. */
let notesShown = false

export function Presentation({ path, onClose }: { path: string; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  // The slide, and how many of its fragments are in (Infinity: all, coming back to it).
  const [pos, setPos] = useState({ at: 0, step: 0 })
  const [full, setFull] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const frags = useRef<HTMLElement[][]>([])
  const store = getStore() as Store

  const load = useCallback(() => { textOf(path).then(setText, () => onClose()) }, [path, onClose])
  useEffect(load, [load])
  useVaultChange(load, [path])

  const { fm, body } = useMemo(() => splitFm(text ?? ""), [text])
  const props = useMemo(() => readProps(fm).props, [fm])
  const deck = useMemo(() => parseDeck(body, props), [body, props])
  const css = useMemo(() => scopeCss(deck.css, "[data-deck]"), [deck.css])
  const { slides } = deck
  const hasNotes = slides.some((s) => s.notes)
  const [notes, setNotes] = useState(() => notesShown || props.showNotes === true)
  useEffect(() => { if (props.showNotes === true) setNotes(true) }, [props.showNotes])
  const toggleNotes = () => setNotes((v) => (notesShown = !v))
  const n = Math.max(1, slides.length)
  const i = Math.min(pos.at, n - 1)
  const slide = slides[i] as Slide | undefined
  const md = slide?.md ?? ""
  const fit = useFit(stage, inner, md)

  // Annotations and fragments are drawn onto the slide's DOM, again whenever its Markdown is drawn anew.
  const draw = useCallback(() => {
    const el = inner.current
    if (!el) return
    if (slide) annotate(el, slide)
    frags.current = fragmentsOf(el)
    const step = Math.min(pos.step, frags.current.length)
    frags.current.forEach((g, k) => g.forEach((f) => { f.classList.toggle("visible", k < step); f.classList.toggle("current-fragment", k === step - 1) }))
  }, [slide, pos.step])
  useLayoutEffect(() => {
    draw()
    const el = inner.current
    if (!el) return
    const mo = new MutationObserver(draw)
    mo.observe(el, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [draw])

  /** Forward or back a step: a fragment, else a slide (down a column, then on). `col`: a column at a time. */
  const go = useCallback((d: 1 | -1, col = false) => setPos((p) => {
    const at = Math.min(p.at, n - 1), count = frags.current.length, step = Math.min(p.step, count)
    if (d > 0 && step < count) return { at, step: step + 1 }
    if (d < 0 && step > 0) return { at, step: step - 1 }
    const h = slides[at]?.h ?? 0
    let to = at + d
    if (col) to = d > 0 ? slides.findIndex((s) => s.h > h) : slides.findIndex((s) => s.h === h - 1)
    if (to < 0 || to >= n) return p
    return { at: to, step: d < 0 ? Infinity : 0 }
  }), [n, slides])
  const jump = (at: number) => setPos({ at, step: 0 })

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
    if (["ArrowDown", "PageDown", " ", "Enter", "n"].includes(k)) go(1)
    else if (["ArrowUp", "PageUp", "Backspace", "p"].includes(k)) go(-1)
    else if (k === "ArrowRight") go(1, true)
    else if (k === "ArrowLeft") go(-1, true)
    else if (k === "Home") jump(0)
    else if (k === "End") jump(n - 1)
    else if (k === "Escape") onClose()
    else if (k === "f") toggleFull()
    else if (k === "s" && hasNotes) toggleNotes()
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
    const r = stage.current!.getBoundingClientRect()
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

  // The slide's background (its own, else the deck's `bg`), and the tone its text takes to read on it.
  const bg = useMemo(() => {
    const raw = (slide?.bg ?? (typeof props.bg === "string" ? props.bg : "")).trim()
    const at = slide?.bgAttrs ?? {}
    const theme = typeof props.theme === "string" ? props.theme : ""
    let tone: "light" | "dark" | null = DARK_THEMES.test(theme) ? "dark" : LIGHT_THEMES.test(theme) ? "light" : null
    let style: CSSProperties | null = null
    const link = /^\[\[([^\]|#]+)[^\]]*\]\]$/.exec(raw)?.[1]
    if (link || IMAGE.test(raw)) {
      const file = link || !/^[a-z]+:/i.test(raw) ? resolver(store)((link ?? raw).trim(), path)?.file : null
      const url = file ? rawUrl(file) : link ? "" : raw
      if (url) style = { backgroundImage: `url(${JSON.stringify(url)})`, backgroundSize: at.size || "cover", backgroundPosition: at.position || "center", backgroundRepeat: at.repeat || "no-repeat" }
    } else if (raw) {
      style = { background: raw }
      tone = toneOf(raw) ?? tone
    }
    if (style && at.opacity) style.opacity = Number(at.opacity)
    return { style, tone }
  }, [slide, props.bg, props.theme, store, path])

  // The slide's own class and style (`<!-- .slide: … -->`).
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (slide?.style) box.current?.setAttribute("style", slide.style); else box.current?.removeAttribute("style") }, [slide?.style, i])

  const title = isTitleSlide(md)
  const next = slides[i + 1]
  const ctl = "grid size-11 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground md:size-9"
  const empty = !md && !slide?.bg
  return createPortal(
    <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${stem(path)}, slide ${i + 1} of ${n}`} onKeyDown={key}
      className="group/slides fixed inset-0 z-[70] flex flex-col bg-background text-foreground outline-none select-none md:flex-row" data-presentation={path} data-keeps-keys>
      <style>{DECK_CSS}{css}</style>
      <div className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground", bg.tone === "dark" ? "dark" : bg.tone === "light" && "scheme-preview")} data-tone={bg.tone ?? undefined}>
        {/* the deck's own CSS reaches what's in [data-deck], never the controls */}
        <div data-deck className="relative flex min-h-0 flex-1 flex-col">
          {bg.style && <div aria-hidden className="pointer-events-none absolute inset-0" style={bg.style} />}
          <div ref={stage} onClick={click} onTouchStart={touchStart} onTouchEnd={touchEnd}
            className="relative flex min-h-0 flex-1 cursor-default touch-pan-y overflow-auto px-6 pt-[max(env(safe-area-inset-top),2rem)] pb-16 md:px-16 md:pt-12">
            <div style={{ width: fit.w * fit.scale, height: fit.h * fit.scale }} className="relative m-auto shrink-0">
              <div ref={inner} key={i} data-deck-slide={i + 1}
                className={cn("absolute top-0 left-0 origin-top-left select-text", title && "text-center [&_.note-prose]:text-[22px] [&_.note-prose]:leading-[30px]")}
                style={{ width: fit.w, transform: `scale(${fit.scale})` }}>
                <div ref={box} className={slide?.cls || undefined}>
                  {text !== null && (md
                    ? <NoteBody store={store} path={path} body={md} fm={fm} className="slide-body" />
                    : empty && <p className="text-center text-muted-foreground">This note is empty.</p>)}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:px-4">
          <div className="pointer-events-auto flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover/slides:opacity-100 md:focus-within:opacity-100">
            <button type="button" aria-label="Previous slide" className={ctl} disabled={i === 0 && !pos.step} onClick={() => go(-1)}><ChevronLeft className="size-5" strokeWidth={2} /></button>
            <button type="button" aria-label="Next slide" className={ctl} disabled={i === n - 1 && Math.min(pos.step, frags.current.length) >= frags.current.length} onClick={() => go(1)}><ChevronRight className="size-5" strokeWidth={2} /></button>
            {hasNotes && (
              <button type="button" aria-label={notes ? "Hide speaker notes" : "Show speaker notes"} aria-pressed={notes} data-tip="Speaker notes (S)"
                className={cn(ctl, notes && "text-foreground")} onClick={toggleNotes}>
                <NotebookText className="size-4" strokeWidth={2} />
              </button>
            )}
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
      </div>
      {notes && hasNotes && (
        <aside aria-label="Speaker notes" data-slide-notes
          className="flex h-[40%] shrink-0 flex-col border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:h-auto md:w-[min(400px,36%)] md:border-t-0 md:border-l md:pb-0">
          <div className="px-4 pt-3 pb-1 text-[15px] text-muted-foreground md:pt-4 md:text-[13px]">Speaker notes</div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 select-text">
            {slide?.notes
              ? <NoteBody key={i} store={store} path={path} body={slide.notes} fm={fm} className="slide-notes" />
              : <p className="pt-2 text-[15px] text-muted-foreground">No notes for this slide.</p>}
          </div>
          {next && (
            <div className="truncate border-t border-border px-4 py-2.5 text-[15px] text-muted-foreground md:text-[13px]">
              Next: {nextName(next.md) || `slide ${i + 2}`}
            </div>
          )}
        </aside>
      )}
    </div>,
    document.body,
  )
}
