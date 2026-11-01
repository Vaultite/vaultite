// Export as HTML: the deck drawn as the presentation draws it, in one file that presents itself in any browser
// (its images and the fonts it uses inside it; a small player for keys, clicks, swipes, fragments and notes).
import { useEffect, useRef, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { cn, getStore, NoteBody, notify, notifyError, stem, type Store } from "@vaultite"
import { Boxes, layOut, LAYOUT_CSS } from "./Layout"
import { annotate, backgroundOf, DECK_CSS, frameOf, SlideFrame, TITLE } from "./Presentation"
import { exportAsked } from "./asked"
import { isTitleSlide, type Slide } from "./slides"
import { revealTheme } from "./themes"


const dataUrl = (url: string) => fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${r.status}`)))).then((b) => new Promise<string>((ok, no) => {
  const fr = new FileReader()
  fr.onload = () => ok(String(fr.result)); fr.onerror = () => no(fr.error)
  fr.readAsDataURL(b)
}))

/** Images in, fonts loaded, math and embeds drawn (a slow image is given up on after 15 s, drawn as it is). */
async function settled(root: HTMLElement) {
  const end = Date.now() + 15_000
  for (const img of root.querySelectorAll("img")) img.loading = "eager"
  await new Promise((r) => setTimeout(r, 500))
  while (Date.now() < end && [...root.querySelectorAll("img")].some((i) => !i.complete)) await new Promise((r) => setTimeout(r, 100))
  await document.fonts?.ready.catch(() => {})
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
}

const URL_RE = /url\(\s*(["']?)([^"')]+)\1\s*\)/g
/** The page's CSS, its addresses absolute, and the @font-faces of the families `root` uses inside it. */
async function pageCss(root: HTMLElement) {
  const used = new Set<string>()
  for (const el of [root, ...root.querySelectorAll("*")]) for (const f of getComputedStyle(el).fontFamily.split(",")) used.add(f.trim().replace(/^["']|["']$/g, "").toLowerCase())
  const out: string[] = []
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList
    try { rules = sheet.cssRules } catch { continue }
    const base = sheet.href ?? location.href
    for (const r of rules) {
      if (r instanceof CSSFontFaceRule) {
        if (!used.has(r.style.getPropertyValue("font-family").trim().replace(/^["']|["']$/g, "").toLowerCase())) continue
        let text = r.cssText
        for (const [m, , u] of text.matchAll(URL_RE)) {
          if (u.startsWith("data:")) continue
          text = text.replace(m, await dataUrl(new URL(u, base).href).then((d) => `url("${d}")`, () => m))
        }
        out.push(text)
      } else out.push(r.cssText.replace(URL_RE, (m, _q, u: string) => (/^(data:|#)/.test(u) ? m : `url("${new URL(u, base).href}")`)))
    }
  }
  return out.join("\n")
}

const PLAYER_CSS = `
html, body { margin: 0; height: 100%; overflow: hidden; }
[data-deck] { position: fixed; inset: 0; }
[data-deck] > section { position: absolute; inset: 0; display: none; overflow: hidden; background: var(--background); color: var(--foreground); }
[data-deck] > section.on { display: block; }
section > .slide-bg { position: absolute; inset: 0; pointer-events: none; }
section > .slide-fit { position: absolute; top: 50%; }
[data-deck-theme] > section { background-color: var(--r-background-color); color: var(--r-main-color); }
section > aside { display: none; }
body.notes section.on > aside { display: block; position: fixed; top: 0; right: 0; bottom: 0; width: 360px; box-sizing: border-box; overflow: auto; padding: 16px; background: var(--card); color: var(--foreground); border-left: 1px solid var(--border); }
.slide-count { position: fixed; right: 16px; bottom: 12px; font: 13px/1 system-ui, sans-serif; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
.slide-bar { position: fixed; left: 0; bottom: 0; height: 3px; background: var(--primary); transition: width .2s; }
`

// Kept in step with Presentation.tsx's keys and fragments.
const PLAYER = `(() => {
const S = [...document.querySelectorAll("[data-deck] > section")], bar = document.querySelector(".slide-bar"), count = document.querySelector(".slide-count")
let i = 0, step = 0
const groups = (s) => { const at = new Map(), rest = []; for (const f of s.querySelectorAll(".slide-fit .fragment")) { const k = parseInt(f.dataset.fragmentIndex, 10); if (isNaN(k)) rest.push([f]); else { if (!at.has(k)) at.set(k, []); at.get(k).push(f) } } return [...[...at].sort((a, b) => a[0] - b[0]).map((e) => e[1]), ...rest] }
const fit = () => { const f = S[i].querySelector(".slide-fit"), w = innerWidth - (document.body.classList.contains("notes") ? 360 : 0); f.style.transform = "none"; const fw = f.offsetWidth, sc = Math.max(0.1, Math.min(2.2 * 720 / fw, (w * 0.9) / fw, (innerHeight * 0.85) / f.offsetHeight)); f.style.left = w / 2 + "px"; f.style.transform = "translate(-50%, -50%) scale(" + sc + ")" }
const show = () => { S.forEach((s, k) => s.classList.toggle("on", k === i)); const g = groups(S[i]); step = Math.max(0, Math.min(step, g.length)); g.forEach((x, k) => x.forEach((f) => { f.classList.toggle("visible", k < step); f.classList.toggle("current-fragment", k === step - 1) })); count.textContent = i + 1 + " / " + S.length; bar.style.width = ((i + 1) / S.length) * 100 + "%"; history.replaceState(null, "", "#" + (i + 1)); fit() }
const go = (d, col) => { const n = groups(S[i]).length; if (!col && d > 0 && step < n) { step++; return show() } if (!col && d < 0 && step > 0) { step--; return show() } const h = +S[i].dataset.h; const to = !col ? i + d : d > 0 ? S.findIndex((s) => +s.dataset.h > h) : S.findIndex((s) => +s.dataset.h === h - 1); if (to < 0 || to >= S.length) return; i = to; step = d < 0 && !col ? Infinity : 0; show() }
addEventListener("keydown", (e) => { if (e.metaKey || e.ctrlKey || e.altKey) return; const k = e.key
  if (["ArrowDown", "PageDown", " ", "Enter", "n"].includes(k)) go(1); else if (["ArrowUp", "PageUp", "Backspace", "p"].includes(k)) go(-1)
  else if (k === "ArrowRight") go(1, true); else if (k === "ArrowLeft") go(-1, true)
  else if (k === "Home" || k === "End") { i = k === "Home" ? 0 : S.length - 1; step = 0; show() }
  else if (k === "s") { document.body.classList.toggle("notes"); fit() }
  else if (k === "f") { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.() }
  else return; e.preventDefault() })
addEventListener("click", (e) => { if (e.target.closest("a, button, audio, video, iframe, summary, details, aside") || getSelection().toString()) return; go(e.clientX < innerWidth / 3 ? -1 : 1) })
let t = null
addEventListener("touchstart", (e) => { t = e.touches[0] }, { passive: true })
addEventListener("touchend", (e) => { const p = e.changedTouches[0]; if (t && p) { const dx = p.clientX - t.clientX; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(p.clientY - t.clientY) * 1.5) go(dx < 0 ? 1 : -1) } t = null })
addEventListener("resize", fit)
i = Math.max(0, Math.min(S.length - 1, (parseInt(location.hash.slice(1), 10) || 1) - 1)); show()
})()`

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`)

/** The deck as one HTML file, from its slides drawn in `root`. */
async function build(root: HTMLElement, name: string, deckCss: string, theme: string | undefined) {
  const copy = root.cloneNode(true) as HTMLElement
  const urls = new Map<string, Promise<string>>()
  const inline = (u: string) => { if (!urls.has(u)) urls.set(u, dataUrl(new URL(u, location.href).href).catch(() => new URL(u, location.href).href)); return urls.get(u)! }
  for (const img of copy.querySelectorAll("img")) {
    img.removeAttribute("srcset"); img.removeAttribute("loading")
    const src = img.getAttribute("src")
    if (src && !src.startsWith("data:")) img.src = await inline(src)
  }
  for (const el of copy.querySelectorAll<HTMLElement>("[style*='url(']")) {
    const m = /url\("?([^")]+)"?\)/.exec(el.style.backgroundImage)
    if (m && !m[1].startsWith("data:")) el.style.backgroundImage = `url("${await inline(m[1])}")`
  }
  for (const el of copy.querySelectorAll<HTMLElement>("[src]:not(img), a[href]")) {
    const at = el.hasAttribute("src") ? "src" : "href", v = el.getAttribute(at)!
    if (!/^(#|data:|[a-z][\w+.-]*:)/i.test(v)) el.setAttribute(at, new URL(v, location.href).href)
  }
  const html = document.documentElement
  return `<!doctype html>
<html lang="${esc(html.lang || "en")}" class="${esc(html.className)}"${html.dataset.scheme ? ` data-scheme="${esc(html.dataset.scheme)}"` : ""} style="${esc(html.getAttribute("style") ?? "")}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(name)}</title>
<style>${(await pageCss(root)).replace(/<\/style/gi, "<\\/style")}</style>
<style>${(DECK_CSS + LAYOUT_CSS + deckCss + PLAYER_CSS).replace(/<\/style/gi, "<\\/style")}</style></head>
<body class="${esc(document.body.className)}"><div data-deck${theme ? ` data-deck-theme="${esc(theme)}"` : ""}>${copy.innerHTML}</div><div class="slide-count"></div><div class="slide-bar"></div>
<script>${PLAYER}</script></body></html>
`
}

/** Every slide of the deck drawn off screen, then saved as `<note>.html` (a browser's download). */
export function DeckExport({ path, slides, fm, props, css }: { path: string; slides: Slide[]; fm: string; props: Record<string, unknown>; css: string }) {
  const root = useRef<HTMLDivElement>(null)
  const store = getStore() as Store
  // A theme's --r-* on each slide, in its tone, as the presentation has them on its screen.
  const theme = revealTheme(props.theme), frame = frameOf(props), themeName = theme?.name
  const content = (s: Slide) => (s.boxes ? <Boxes items={s.boxes} ctx={{ store, path, fm }} /> : s.md && <NoteBody store={store} path={path} body={s.md} fm={fm} className="slide-body" />)
  useEffect(() => {
    let on = true
    void (async () => {
      const el = root.current!
      await settled(el)
      if (!on) return
      for (const sec of el.querySelectorAll<HTMLElement>(":scope > section")) {
        const s = slides[Number(sec.dataset.n)], box = sec.querySelector<HTMLElement>(".slide-box")
        if (box) { annotate(box, s); layOut(box); if (s.style) box.setAttribute("style", s.style) }
      }
      const name = `${stem(path)}.html`
      const blob = new Blob([await build(el, stem(path), css, themeName)], { type: "text/html" })
      if (!on) return
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob); a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
      notify(`Exported ${name}`)
    })().catch((e) => notifyError(e, "Couldn't export the slides")).finally(() => { if (on) exportAsked.set(null) })
    return () => { on = false }
  }, [path, slides, css, themeName])
  return createPortal(
    <div ref={root} aria-hidden data-deck-export data-deck data-deck-theme={theme?.name} style={{ position: "fixed", left: -20000, top: 0, width: frame.w, pointerEvents: "none" }}>
      {slides.map((s, n) => {
        const bg = backgroundOf(s, props, store, path)
        return (
          <section key={n} data-n={n} data-h={s.h} data-v={s.v} className={cn(bg.tone && "scheme-preview", bg.tone === "dark" && "dark")}
            data-scheme={bg.tone ? document.documentElement.dataset.scheme : undefined} style={theme?.vars as CSSProperties}>
            {bg.style && <div className="slide-bg" style={bg.style} />}
            <div data-deck-slide={n + 1} style={{ width: frame.w }} className={cn("slide-fit", !s.boxes && !s.canvas && isTitleSlide(s.md) && TITLE)}>
              <div className={cn("slide-box", s.cls)}><SlideFrame slide={s} frame={frame}>{content(s)}</SlideFrame></div>
            </div>
            {s.notes && <aside><div className="pb-1 text-[13px] text-muted-foreground">Speaker notes</div><NoteBody store={store} path={path} body={s.notes} fm={fm} className="slide-notes" /></aside>}
          </section>
        )
      })}
    </div>,
    document.body,
  )
}
