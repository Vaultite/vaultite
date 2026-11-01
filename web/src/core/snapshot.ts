// A still picture of part of the page made of a copy of its elements: what a dragged pane shows of itself. The copy is
// inert and in a shadow root, so nothing that looks for elements (a tab by its id, a pane's body) finds it.

let sheet: { n: number; css: CSSStyleSheet } | null = null
/** The page's styles as one sheet the copy adopts (made again when a plugin adds one). */
function styles() {
  const n = document.styleSheets.length
  if (sheet?.n === n) return sheet.css
  const text = [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join("\n") } catch { return "" } })
  const css = new CSSStyleSheet()
  css.replaceSync(text.join("\n"))
  sheet = { n, css }
  return css
}

/** What a copy can't show (a page in a frame, a video, a plugin's own element) stands as its box. */
const opaque = (e: Element) => /^(IFRAME|VIDEO|AUDIO|WEBVIEW|EMBED|OBJECT)$/.test(e.tagName) || (e.tagName.includes("-") && !!customElements.get(e.tagName.toLowerCase()))

/** A copy of `el` as it looks now, sized to fill what it's put in: `host` to put in the page, then `settle()` once it's
 *  there (scrolled boxes scrolled as they are). Past `limit` elements only `light` (a pane's tab bar) is copied. */
export function snapshot(el: HTMLElement, { limit = 6000, light }: { limit?: number; light?: string } = {}) {
  const host = document.createElement("div")
  host.inert = true
  host.style.cssText = "position: absolute; inset: 0; overflow: hidden"
  const root = host.attachShadow({ mode: "open" })
  root.adoptedStyleSheets = [styles()]
  const src = el.getElementsByTagName("*").length > limit ? el.querySelector<HTMLElement>(light ?? ":scope > *") : el
  const scrolls: [Element, number, number][] = []
  if (!src) return { host, settle: () => {} }
  const copy = src.cloneNode(true) as HTMLElement
  // (its own place in the page is the frame's: the copy fills it)
  // (a kept tab's page, hidden, shows in its copy)
  Object.assign(copy.style, { position: "absolute", inset: src === el ? "0" : "0 0 auto 0", transform: "none", scale: "none", opacity: "1", display: "" }, src === el ? { width: "auto", height: "auto" } : {})
  const boxes: Element[] = []
  stillCopy(src, copy, (o, c) => {
    if (o.scrollTop || o.scrollLeft) scrolls.push([c, o.scrollTop, o.scrollLeft])
    if (opaque(o)) boxes.push(c)
  })
  for (const c of boxes) {
    const box = document.createElement("div")
    box.className = c.getAttribute("class") ?? ""
    box.style.cssText = `${c.getAttribute("style") ?? ""}; background: var(--muted)`
    c.replaceWith(box)
  }
  root.append(copy)
  return { host, settle: () => { for (const [c, top, left] of scrolls) { c.scrollTop = top; c.scrollLeft = left } } }
}

const pictures = new WeakMap<Element, () => HTMLCanvasElement | null>()
/** `el` gives copies of the page its picture as it is now (`draw`; null: copy it as it is), for what a copy can't show
 *  of it: a WebGL canvas reads back empty once shown. Kept as long as `el` is. */
export function offerPicture(el: Element, draw: () => HTMLCanvasElement | null) { pictures.set(el, draw) }

/** Makes `copy` (a clone of `src`) look as `src` does where cloning loses it: canvases drawn again, and an element that
 *  offers its picture shows that instead of its insides. `visit` sees each element with its copy first. */
export function stillCopy(src: Element, copy: Element, visit?: (o: Element, c: Element) => void) {
  const shown: [Element, HTMLCanvasElement][] = []
  const a = document.createTreeWalker(src, NodeFilter.SHOW_ELEMENT), b = document.createTreeWalker(copy, NodeFilter.SHOW_ELEMENT)
  for (let x: Node | null = a.currentNode, y: Node | null = b.currentNode; x && y; x = a.nextNode(), y = b.nextNode()) {
    const o = x as Element, c = y as Element
    visit?.(o, c)
    const draw = pictures.get(o)
    let pic: HTMLCanvasElement | null = null
    try { pic = draw?.() ?? null } catch { /* copied as it is */ }
    if (pic) shown.push([c, pic])
    else if (o instanceof HTMLCanvasElement && c instanceof HTMLCanvasElement) {
      try { c.getContext("2d")?.drawImage(o, 0, 0) } catch { /* tainted, gone, or not a 2D one */ }
    }
  }
  for (const [c, pic] of shown) {
    pic.style.cssText = "position: absolute; inset: 0; width: 100%; height: 100%"
    c.replaceChildren(pic)
  }
}
