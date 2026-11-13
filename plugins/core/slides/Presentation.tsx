import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject, type TouchEvent } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight, LayoutGrid, Maximize2, Minimize2, NotebookText, Pencil, ScreenShare, X } from "lucide-react"
import { activeFile, cn, folderOf, getStore, isDesktop, NoteBody, notify, onLook, onlyMode, rawUrl, readFile, readProps, resolver, snippet, splitFm, stem, useVaultChange, type Store } from "@vaultite"
import { exportAsked } from "./asked"
import { DeckExport } from "./exportHtml"
import { cssFiles, cssPlaces, cssUrls, isTitleSlide, moveOf, parseDeck, scopeCss, templateNames, sizeOf, upcoming, type Slide } from "./slides"
import { openPresenter, Presenter, Screen, type Keys, type PresenterWindow } from "./Presenter"
import { Ink, InkBar, Laser, Overview, overviewKeys, TimeBar, TOOLS_CSS, type InkColor, type Stroke } from "./Tools"
import { revealTheme } from "./themes"
import { Boxes, layOut, LAYOUT_CSS, toneClass, toneOf } from "./Layout"
import { slideMotion, type Leaving } from "./transitions"

async function textOf(path: string) {
  const f = activeFile()
  return f?.path === path ? f.text() : (await readFile(path)).text
}

const BASE = 720
const MAX = 2.2
const MIN = 0.6
export const TITLE = "text-center text-[22px] leading-[30px]"
export function frameOf(props: Record<string, unknown>) {
  const s = sizeOf(props)
  return revealTheme(props.theme) ? { w: s.w, h: s.h, fixed: true } : { w: BASE, h: Math.round((BASE * s.h) / s.w), fixed: false }
}
type Frame = ReturnType<typeof frameOf>
export function SlideFrame({ slide, frame, center = true, children }: { slide?: Slide; frame: Frame; center?: boolean; children: ReactNode }) {
  if (slide?.canvas) return <div data-slide-canvas className="relative flex flex-col justify-center" style={{ height: frame.h }}>{children}</div>
  if (frame.fixed) return <div data-slide-frame className={cn("relative flex flex-col", center ? "justify-center" : "justify-start")} style={{ minHeight: frame.h }}>{children}</div>
  return children
}

type Bounds = { margin?: number; minScale?: number; maxScale?: number }
function useFit(stage: RefObject<HTMLDivElement | null>, inner: RefObject<HTMLDivElement | null>, key: unknown, fixed = false, base = BASE, { margin = 0, minScale, maxScale }: Bounds = {}) {
  const [fit, setFit] = useState({ w: base, scale: 1, h: 0 })
  const measure = useCallback(() => {
    const s = stage.current, el = inner.current
    if (!s || !el) return
    const cs = getComputedStyle(s)
    const room = 1 - margin
    const aw = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    const ah = s.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
    const w = fixed ? base : Math.max(240, Math.min(base, aw))
    if (Math.abs(el.offsetWidth - w) > 0.5) el.style.width = `${w}px`
    const h = el.offsetHeight
    const most = maxScale ?? (MAX * BASE) / base
    const scale = Math.max(minScale ?? (fixed ? 0 : MIN), Math.min(most, (aw * room) / w, h ? (ah * room) / h : most))
    setFit((f) => (f.w === w && Math.abs(f.scale - scale) < 0.005 && f.h === h ? f : { w, scale, h }))
  }, [stage, inner, fixed, base, margin, minScale, maxScale])
  useLayoutEffect(measure, [measure, key])
  useEffect(() => {
    const ro = new ResizeObserver(measure)
    if (stage.current) ro.observe(stage.current)
    if (inner.current) ro.observe(inner.current)
    return () => ro.disconnect()
  }, [measure, key])
  return fit
}

export function annotate(root: HTMLElement, slide: Slide) {
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
    if (a.bg && CSS.supports("color", a.bg)) { (target as HTMLElement).style.backgroundColor = a.bg; target.classList.add(...toneClass(a.bg).split(" ").filter(Boolean)) }
    if (a.index !== undefined) (target as HTMLElement).dataset.fragmentIndex = String(a.index)
    for (const [k, v] of Object.entries(a.data ?? {})) target.setAttribute(`data-${k}`, v)
  }
}

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

function useLook() {
  const read = () => { const r = document.documentElement; return `${r.classList.contains("dark") ? "dark" : "light"} ${r.dataset.scheme ?? ""}` }
  const [look, setLook] = useState(read)
  useEffect(() => onLook(() => setLook(read())), [])
  const [mode, scheme] = look.split(" ")
  return { mode, scheme }
}
const IMAGE = /^(https?:|data:image\/)|\.(png|jpe?g|gif|webp|avif|svg|bmp)([?#]|$)/i

export const DECK_CSS = `
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
[data-deck] { background-image: radial-gradient(circle at 50% 45%, color-mix(in oklab, var(--r-background-color), white var(--deck-glow)), var(--r-background-color) 75%); }
/* The text's size is the slide's, as in reveal.js: an annotation's font-size on a box reaches what's in it. */
:where([data-deck-slide]) { font-size: 17px; line-height: 1.53; }
@media (min-width: 768px) { :where([data-deck-slide]) { font-size: 16px; line-height: 1.5; } }
[data-deck-slide] .note-prose { font-size: inherit; line-height: inherit; }
[data-deck-theme] [data-deck-slide] { font-family: var(--r-main-font); font-size: var(--r-main-font-size); font-weight: var(--r-main-font-weight); line-height: 1.3; text-align: center; }
[data-deck-theme] .note-prose { font-family: inherit; font-weight: inherit; line-height: inherit; }
[data-deck-theme] .note-prose :where(p) { margin: var(--r-block-margin) 0; }
[data-deck-theme] .note-prose :where(ul, ol) { display: inline-block; text-align: left; margin: 0 0 0 1em; }
[data-deck-theme] .note-prose :where(ul, ol) :where(ul, ol) { display: block; margin-left: 40px; }
[data-deck-theme] .note-prose :where(li + li) { margin-top: 0; }
[data-deck-theme] .note-prose :where(img, video, iframe) { max-width: 95%; max-height: 95%; }
[data-deck-theme] .note-prose :where(img):not(:is(.stretch-row, .stretch-column) img) { display: inline-block; vertical-align: middle; }
[data-deck-theme] .note-prose :where(pre) { width: 90%; margin: var(--r-block-margin) auto; text-align: left; font-size: .55em; line-height: 1.2em; }
[data-deck-theme] .note-prose :where(blockquote) { width: 70%; margin: var(--r-block-margin) auto; font-style: italic; }
[data-deck-theme] .note-prose :where(table) { margin: auto; }
[data-deck-theme] [data-slide-box]:is(.dark, .scheme-preview) { --r-heading-color: var(--foreground); }
[data-deck-theme] .note-prose :is(.h1, .h2, .h3, .h4, .h5, .h6) { margin: var(--r-heading-margin); color: var(--r-heading-color); font-family: var(--r-heading-font);
  line-height: var(--r-heading-line-height); letter-spacing: var(--r-heading-letter-spacing); text-transform: var(--r-heading-text-transform); text-shadow: var(--r-heading-text-shadow); overflow-wrap: break-word; }
${[1, 2, 3, 4, 5, 6].map((n) => `[data-deck-theme] .note-prose .h${n} { font-size: var(--r-heading${n}-size); font-weight: var(--r-heading${n}-font-weight); }`).join("\n")}
[data-deck-theme] .note-prose .h1 { text-shadow: var(--r-heading1-text-shadow); }
[data-deck-theme] .note-prose :is(a, .wikilink:not(.missing)) { color: var(--r-link-color); }
[data-deck-theme] .note-prose :is(strong, b) { color: var(--r-bold-color, inherit); }
[data-deck-theme] .note-prose :is(em, i, blockquote) { color: var(--r-italic-color, inherit); }
[data-deck-theme] .note-prose :not(pre) > code { color: var(--r-inline-code-color, inherit); }
[data-deck-theme] .note-prose li::marker { color: var(--r-list-bullet-color, var(--muted-foreground)); }
[data-deck-theme] ::selection { color: var(--r-selection-color); background: var(--r-selection-background-color); }
`

export function backgroundOf(slide: Slide | undefined, props: Record<string, unknown>, store: Store, path: string) {
  const raw = (slide?.bg ?? (typeof props.bg === "string" ? props.bg : "")).trim()
  const at = slide?.bgAttrs ?? {}
  let tone = revealTheme(props.theme)?.tone ?? null
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
}

const nextName = (md: string) => {
  const plain = md.replace(/<span class="slide-el-\d+"><\/span>/g, "")
  return snippet(/^#{1,6}\s+(.+)$/m.exec(plain)?.[1] ?? plain.replace(/!\[\[[^\]]*\]\]/g, ""))
}

function useSheets(path: string, props: Record<string, unknown>) {
  const refs = cssFiles(props).join("\n")
  const [css, setCss] = useState("")
  const [n, setN] = useState(0)
  const places = useMemo(() => new Set(refs.split("\n").filter(Boolean).flatMap((r) => cssPlaces(r, path))), [refs, path])
  useVaultChange(() => setN((x) => x + 1), (p) => places.has(p))
  useEffect(() => {
    let on = true
    const one = async (ref: string) => {
      if (/^https:/i.test(ref)) return fetch(ref).then((r) => (r.ok ? r.text() : ""), () => "")
      for (const p of cssPlaces(ref, path)) {
        const text = await readFile(p).then((f) => f.text, () => null)
        if (text !== null) return cssUrls(text, folderOf(p), (u) => rawUrl(u))
      }
      return ""
    }
    void Promise.all(refs.split("\n").filter(Boolean).map(one)).then((all) => { if (on) setCss(all.join("\n")) })
    return () => { on = false }
  }, [refs, path, n])
  return css
}

function useTemplates(path: string, body: string, props: Record<string, unknown>, store: Store) {
  const [loaded, setLoaded] = useState(() => new Map<string, string>())
  const [n, setN] = useState(0)
  const wanted = templateNames(body, props).join("\n")
  const files = useRef(new Set<string>())
  useVaultChange(() => setN((x) => x + 1), (p) => files.current.has(p))
  useEffect(() => {
    let on = true
    void (async () => {
      const out = new Map<string, string>(), seen = new Set<string>()
      let todo = wanted.split("\n").filter(Boolean)
      while (todo.length && seen.size < 50) {
        for (const name of todo) seen.add(name)
        const got = await Promise.all(todo.map(async (name) => {
          const file = resolver(store)(name, path)?.file
          if (!file || !/\.md$/i.test(file)) return [name, ""] as const
          files.current.add(file)
          return [name, await readFile(file).then((f) => splitFm(f.text).body, () => "")] as const
        }))
        for (const [name, text] of got) if (text) out.set(name, text)
        todo = [...new Set(got.flatMap(([, t]) => templateNames(t)))].filter((x) => !seen.has(x))
      }
      if (on) setLoaded((m) => (m.size === out.size && [...out].every(([k, v]) => m.get(k) === v) ? m : out))
    })()
    return () => { on = false }
  }, [wanted, path, store, n])
  return loaded
}

let notesShown = false

const popups = () => isDesktop() && matchMedia("(pointer: fine)").matches

type Source = { store: Store; path: string; fm: string; props: Record<string, unknown>; text: string | null }

function SlideView({ src, slide, i, step, onClick }: { src: Source; slide?: Slide; i: number; step: number; onClick?: (e: MouseEvent) => void }) {
  const { store, path, fm, props, text } = src
  const stage = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const md = slide?.md ?? "", canvas = !!slide?.canvas
  const frame = useMemo(() => frameOf(props), [props])
  const fit = useFit(stage, inner, md, canvas || frame.fixed, frame.w)
  const theme = useMemo(() => revealTheme(props.theme), [props.theme])
  const draw = useCallback(() => {
    const el = inner.current
    if (!el) return
    if (slide) annotate(el, slide)
    layOut(el)
    const frags = fragmentsOf(el), k = Math.min(step, frags.length)
    frags.forEach((g, j) => g.forEach((f) => { f.classList.toggle("visible", j < k); f.classList.toggle("current-fragment", j === k - 1) }))
  }, [slide, step])
  useLayoutEffect(() => {
    draw()
    const el = inner.current
    if (!el) return
    const mo = new MutationObserver(draw)
    mo.observe(el, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [draw])
  const bg = useMemo(() => backgroundOf(slide, props, store, path), [slide, props, store, path])
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (slide?.style) box.current?.setAttribute("style", slide.style); else box.current?.removeAttribute("style") }, [slide?.style, i])
  const title = !slide?.boxes && !canvas && isTitleSlide(md)
  const content: ReactNode = slide?.boxes ? <Boxes items={slide.boxes} ctx={{ store, path, fm }} /> : md && <NoteBody store={store} path={path} body={md} fm={fm} className="slide-body" />
  return (
    <div className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground", bg.tone === "dark" ? "dark" : bg.tone === "light" && "scheme-preview")}
      data-tone={bg.tone ?? undefined} style={theme?.vars as CSSProperties}>
      <div data-deck data-deck-theme={theme?.name} className="relative flex min-h-0 flex-1 flex-col">
        {bg.style && <div aria-hidden className="pointer-events-none absolute inset-0" style={bg.style} />}
        <div ref={stage} onClick={onClick} className="relative flex min-h-0 flex-1 cursor-default overflow-hidden px-6 pt-8 pb-16 md:px-16 md:pt-12">
          <div style={{ width: fit.w * fit.scale, height: fit.h * fit.scale }} className="relative m-auto shrink-0">
            <div ref={inner} key={i} data-deck-slide={i + 1} className={cn("absolute top-0 left-0 origin-top-left", title && TITLE)}
              style={{ width: fit.w, transform: `scale(${fit.scale})` }}>
              <div ref={box} className={slide?.cls || undefined}>
                {text !== null && <SlideFrame slide={slide} frame={frame} center={sizeOf(props).center}>{content}</SlideFrame>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Presentation({ path, onClose }: { path: string; onClose: () => void }) {
  const exporting = exportAsked.use() === path
  const [text, setText] = useState<string | null>(null)
  const [pos, setPos] = useState({ at: 0, step: 0 })
  const [full, setFull] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const frags = useRef<HTMLElement[][]>([])
  const [count, setCount] = useState(0)
  const screenBox = useRef<HTMLDivElement>(null)
  const store = getStore() as Store

  const load = useCallback(() => { textOf(path).then(setText, () => onClose()) }, [path, onClose])
  useEffect(load, [load])
  useVaultChange(load, [path])

  const { fm, body } = useMemo(() => splitFm(text ?? ""), [text])
  const props = useMemo(() => readProps(fm).props, [fm])
  const templates = useTemplates(path, body, props, store)
  const deck = useMemo(() => parseDeck(body, props, (name) => templates.get(name)), [body, props, templates])
  const sheets = useSheets(path, props)
  const css = useMemo(() => scopeCss(`${sheets}\n${deck.css}`, "[data-deck]"), [sheets, deck.css])
  const { slides } = deck
  const hasNotes = slides.some((s) => s.notes)
  const [laser, setLaser] = useState(false)
  const [pen, setPen] = useState<InkColor | null>(null)
  const [color, setColor] = useState<InkColor>("red")
  const [board, setBoard] = useState(false)
  const [ink, setInk] = useState<Record<string, Stroke[]>>({})
  const [overview, setOverview] = useState(false)
  const [timer, setTimer] = useState(() => ({ start: Date.now(), paused: null as number | null }))
  const total = Number(props.timeForPresentation) > 0 ? Number(props.timeForPresentation) : 0
  const [notes, setNotes] = useState(() => notesShown || props.showNotes === true)
  useEffect(() => { if (props.showNotes === true) setNotes(true) }, [props.showNotes])
  const toggleNotes = () => setNotes((v) => (notesShown = !v))
  const n = Math.max(1, slides.length)
  const i = Math.min(pos.at, n - 1)
  const slide = slides[i] as Slide | undefined
  const md = slide?.md ?? ""
  const canvas = !!slide?.canvas
  const deckSize = useMemo(() => sizeOf(props), [props])
  const frame = useMemo(() => frameOf(props), [props])
  const per = deckSize.w / frame.w
  const fit = useFit(stage, inner, md, canvas || frame.fixed, frame.w, { margin: deckSize.margin, minScale: deckSize.minScale && deckSize.minScale * per, maxScale: deckSize.maxScale && deckSize.maxScale * per })
  const theme = useMemo(() => revealTheme(props.theme), [props.theme])
  const look = useLook()

  const draw = useCallback(() => {
    const el = inner.current
    if (!el) return
    if (slide) annotate(el, slide)
    layOut(el)
    frags.current = fragmentsOf(el)
    setCount(frags.current.length)
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

  const [motion] = useState(slideMotion)
  const gone = useRef<Leaving | null>(null)
  const layer = useRef<HTMLDivElement>(null)
  const bgEl = useRef<HTMLDivElement>(null)
  const tone = () => bg.tone ?? (document.documentElement.classList.contains("dark") ? "dark" : "light")
  const moveTo = (p: { at: number; step: number }) => {
    const to = slides[p.at]
    if (p.at !== i && slide && to && stage.current && inner.current) gone.current = motion.leave(moveOf(slide, to, props), { stage: stage.current, bg: bgEl.current, inner: inner.current }, tone())
    setPos(p)
  }
  useLayoutEffect(() => {
    if (!gone.current) return
    const f = requestAnimationFrame(() => {
      const l = gone.current
      gone.current = null
      if (l && layer.current && stage.current && inner.current) motion.arrive(l, layer.current, { stage: stage.current, bg: bgEl.current, inner: inner.current }, tone())
    })
    return () => cancelAnimationFrame(f)
  }, [i]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (d: 1 | -1, col = false) => {
    const at = Math.min(pos.at, n - 1), count = frags.current.length, step = Math.min(pos.step, count)
    if (d > 0 && step < count) return setPos({ at, step: step + 1 })
    if (d < 0 && step > 0) return setPos({ at, step: step - 1 })
    const h = slides[at]?.h ?? 0
    let to = at + d
    if (col) to = d > 0 ? slides.findIndex((s) => s.h > h) : slides.findIndex((s) => s.h === h - 1)
    if (to >= 0 && to < n) moveTo({ at: to, step: d < 0 ? Infinity : 0 })
  }
  const jump = (at: number) => moveTo({ at, step: 0 })

  // iPhones have no full screen. The browser takes Escape, and Chrome leaves full screen when a popup opens.
  const leaving = useRef(false)
  const opened = useRef(0)
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
      if (!on && !leaving.current && Date.now() - opened.current > 1500) onClose()
      leaving.current = false
    }
    document.addEventListener("fullscreenchange", change)
    return () => {
      document.removeEventListener("fullscreenchange", change)
      if (document.fullscreenElement === el) { leaving.current = true; void document.exitFullscreen().catch(() => {}) }
    }
  }, [onClose])

  const [presenter, setPresenter] = useState<PresenterWindow | null>(null)
  const togglePresenter = () => {
    if (presenter) return setPresenter(null)
    opened.current = Date.now()
    const p = openPresenter(`${stem(path)} – Presenter view`, () => setPresenter(null))
    if (!p) {
      notify("Allow pop-ups for this site to open the presenter view.")
      if (hasNotes) setNotes(true)
      return
    }
    setNotes(false)
    setPresenter(p)
  }
  useEffect(() => () => presenter?.close(), [presenter])
  const [size, setSize] = useState({ w: 1280, h: 800 })
  useLayoutEffect(() => {
    const el = screenBox.current
    if (!el || (!presenter && !overview)) return
    const measure = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight) || !el.clientWidth ? s : { w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [presenter, overview])

  const key = (e: Keys, inPresenter = false) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key
    if (overviewKeys.current?.(k)) { e.preventDefault(); e.stopPropagation(); return }
    const sheet = `${board ? "board" : "slide"}:${i}`
    if ((pen || board) && (k === "z" || k === "Delete")) setInk((m) => ({ ...m, [sheet]: k === "z" ? (m[sheet] ?? []).slice(0, -1) : [] }))
    else if ((pen || board) && k === "Escape") { setPen(null); setBoard(false) }
    else if (k === "c") setPen((p) => (p ? null : color))
    else if (k === "b") { setBoard((b) => !b); setPen((p) => p ?? color) }
    else if (k === "q") setLaser((v) => !v)
    else if (k === "o") setOverview(true)
    else if (["ArrowDown", "PageDown", " ", "Enter", "n"].includes(k)) go(1)
    else if (["ArrowUp", "PageUp", "Backspace", "p"].includes(k)) go(-1)
    else if (k === "ArrowRight") go(1, true)
    else if (k === "ArrowLeft") go(-1, true)
    else if (k === "Home") jump(0)
    else if (k === "End") jump(n - 1)
    else if (k === "Escape") onClose()
    else if (k === "f" && !inPresenter) toggleFull()
    else if (k === "s" && (presenter || popups())) togglePresenter()
    else if (k === "s" && hasNotes) toggleNotes()
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const click = (e: MouseEvent) => {
    const t = e.target as Element
    if (t.closest("[data-wiki], [data-tag]")) { onClose(); return }
    if (t.closest("a, button, audio, video, iframe, input, summary, details, select, textarea, .note-embed, [data-no-nav]")) return
    if ((t.ownerDocument.defaultView ?? window).getSelection()?.toString()) return
    const r = e.currentTarget.getBoundingClientRect()
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

  const bg = useMemo(() => backgroundOf(slide, props, store, path), [slide, props, store, path])

  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (slide?.style) box.current?.setAttribute("style", slide.style); else box.current?.removeAttribute("style") }, [slide?.style, i])

  const title = !slide?.boxes && !canvas && isTitleSlide(md)
  const next = slides[i + 1]
  const ctl = "grid size-11 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground md:size-9"
  const empty = !md && !slide?.bg && !slide?.boxes
  const ctx = { store, path, fm }
  const content = slide?.boxes ? <Boxes items={slide.boxes} ctx={ctx} /> : md && <NoteBody store={store} path={path} body={md} fm={fm} className="slide-body" />
  const other = bg.tone && bg.tone !== look.mode ? bg.tone : null
  const scheme = other && look.scheme && onlyMode(look.scheme) !== (other === "dark" ? "light" : "dark") ? look.scheme : undefined
  const src: Source = { store, path, fm, props, text }
  const up = upcoming(i, pos.step, count, n)
  const canPrev = i > 0 || pos.step > 0
  const canNext = i < n - 1 || Math.min(pos.step, count) < count
  const canPopup = popups()
  const sheet = `${board ? "board" : "slide"}:${i}`
  const addStroke = (st: Stroke) => setInk((m) => ({ ...m, [sheet]: [...(m[sheet] ?? []), st] }))
  const thumb = (k: number) => (
    <div className="flex w-full" style={{ aspectRatio: `${size.w} / ${size.h}` }}>
      <Screen size={size} label={`Slide ${k + 1}`} bare><SlideView src={src} slide={slides[k]} i={k} step={Infinity} /></Screen>
    </div>
  )
  const notesBody = (cls?: string) => slide?.notes
    ? <NoteBody key={i} store={store} path={path} body={slide.notes} fm={fm} className="slide-notes" />
    : <p className={cn("text-muted-foreground", cls)}>No notes for this slide.</p>
  return <>{createPortal(
    <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${stem(path)}, slide ${i + 1} of ${n}`} onKeyDown={(e) => key(e)}
      className="group/slides fixed inset-0 z-[70] flex flex-col bg-background text-foreground outline-none select-none md:flex-row" data-presentation={path} data-keeps-keys>
      <style>{DECK_CSS}{LAYOUT_CSS}{TOOLS_CSS}{css}</style>
      <div ref={screenBox} className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground", other && "scheme-preview", other === "dark" && "dark")}
        data-tone={bg.tone ?? undefined} data-scheme={scheme} style={theme?.vars as CSSProperties}>
        <div data-deck data-deck-theme={theme?.name} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {bg.style && <div ref={bgEl} aria-hidden className="pointer-events-none absolute inset-0" style={bg.style} />}
          <div ref={layer} aria-hidden className="pointer-events-none absolute inset-0" />
          <div ref={stage} onClick={click} onTouchStart={touchStart} onTouchEnd={touchEnd}
            className="relative flex min-h-0 flex-1 cursor-default touch-pan-y overflow-auto px-6 pt-[max(env(safe-area-inset-top),2rem)] pb-16 md:px-16 md:pt-12">
            <div style={{ width: fit.w * fit.scale, height: fit.h * fit.scale }} className={cn("relative mx-auto shrink-0", (deckSize.center || frame.fixed) && "my-auto")}>
              <div ref={inner} key={i} data-deck-slide={i + 1}
                className={cn("absolute top-0 left-0 origin-top-left select-text", title && TITLE)}
                style={{ width: fit.w, transform: `scale(${fit.scale})` }}>
                <div ref={box} className={slide?.cls || undefined}>
                  {text !== null && <SlideFrame slide={slide} frame={frame} center={deckSize.center}>
                    {content || (empty && <p className="text-center text-muted-foreground">This note is empty.</p>)}
                  </SlideFrame>}
                </div>
              </div>
              {text !== null && fit.h > 0 && <>
                <Ink key={`slide-${i}`} w={fit.w} h={fit.h} strokes={ink[`slide:${i}`] ?? []} pen={board ? null : pen} onStroke={addStroke} />
                {board && <Ink key={`board-${i}`} board w={fit.w} h={fit.h} strokes={ink[`board:${i}`] ?? []} pen={pen} onStroke={addStroke} />}
              </>}
            </div>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:px-4">
          <div className="pointer-events-auto flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover/slides:opacity-100 md:focus-within:opacity-100">
            <button type="button" aria-label="Previous slide" className={ctl} disabled={!canPrev} onClick={() => go(-1)}><ChevronLeft className="size-5" strokeWidth={2} /></button>
            <button type="button" aria-label="Next slide" className={ctl} disabled={!canNext} onClick={() => go(1)}><ChevronRight className="size-5" strokeWidth={2} /></button>
            <button type="button" aria-label="All slides" data-tip="All slides (O)" className={ctl} onClick={() => setOverview(true)}><LayoutGrid className="size-4" strokeWidth={2} /></button>
            <button type="button" aria-label={pen ? "Stop drawing" : "Draw on the slide"} aria-pressed={!!pen} data-tip="Draw (C)" className={cn(ctl, pen && "text-foreground")}
              onClick={() => setPen((p) => (p ? null : color))}><Pencil className="size-4" strokeWidth={2} /></button>
            {hasNotes && (
              <button type="button" aria-label={notes ? "Hide speaker notes" : "Show speaker notes"} aria-pressed={notes} data-tip={canPopup ? "Speaker notes" : "Speaker notes (S)"}
                className={cn(ctl, notes && "text-foreground")} onClick={toggleNotes}>
                <NotebookText className="size-4" strokeWidth={2} />
              </button>
            )}
            {(canPopup || presenter) && (
              <button type="button" aria-label={presenter ? "Close presenter view" : "Open presenter view"} aria-pressed={!!presenter} data-tip="Presenter view (S)"
                className={cn(ctl, "max-md:hidden", presenter && "text-foreground")} onClick={togglePresenter}>
                <ScreenShare className="size-4" strokeWidth={2} />
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
        {(pen || board) && <InkBar color={color} board={board} canUndo={!!ink[sheet]?.length} onColor={(c) => { setColor(c); setPen(c) }}
          onUndo={() => setInk((m) => ({ ...m, [sheet]: (m[sheet] ?? []).slice(0, -1) }))} onClear={() => setInk((m) => ({ ...m, [sheet]: [] }))}
          onBoard={() => { setBoard((b) => !b); setPen((p) => p ?? color) }} onDone={() => { setPen(null); setBoard(false) }} />}
        {laser && <Laser area={screenBox} />}
        {overview && <Overview n={n} at={i} label={(k) => nextName(slides[k]?.md ?? "")} thumb={thumb} onPick={(k) => { setOverview(false); jump(k) }} onClose={() => setOverview(false)} />}
        {total > 0 && <TimeBar total={total} start={timer.start} paused={timer.paused} />}
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-foreground/[0.06]" aria-hidden>
          <div data-slide-progress className="h-full bg-[var(--r-link-color,var(--primary))] transition-[width] duration-200" style={{ width: `${((i + 1) / n) * 100}%` }} />
        </div>
      </div>
      {notes && hasNotes && (
        <aside aria-label="Speaker notes" data-slide-notes
          className="flex h-[40%] shrink-0 flex-col border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:h-auto md:w-[min(400px,36%)] md:border-t-0 md:border-l md:pb-0">
          <div className="px-4 pt-3 pb-1 text-[15px] text-muted-foreground md:pt-4 md:text-[13px]">Speaker notes</div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 select-text">{notesBody("pt-2 text-[15px]")}</div>
          {next && (
            <div data-next-slide className="truncate border-t border-border px-4 py-2.5 text-[15px] text-muted-foreground md:text-[13px]">
              Next: {nextName(next.md) || `slide ${i + 2}`}
            </div>
          )}
        </aside>
      )}
      {exporting && text !== null && <DeckExport path={path} slides={slides} fm={fm} props={props} css={css} />}
    </div>,
    document.body,
  )}
  {presenter && createPortal(
    <Presenter win={presenter.win} size={size} at={i} n={n} css={<style>{DECK_CSS}{LAYOUT_CSS}{css}</style>} timer={timer} setTimer={setTimer} total={total}
      current={<SlideView src={src} slide={slide} i={i} step={pos.step} onClick={click} />}
      next={up && <SlideView src={src} slide={slides[up.at]} i={up.at} step={up.step} />}
      notes={notesBody("text-[17px]")} onKey={(e) => key(e, true)} onPrev={() => go(-1)} onNext={() => go(1)} canPrev={canPrev} canNext={canNext} />,
    presenter.root,
  )}</>
}
