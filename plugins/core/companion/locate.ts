// Where the app's places are on the screen, for a drawing over it (the server's `locate`): a pane, the app's UI by its
// data-ui id, words the window shows. Screen points, as the window's own position, its page's CSS px and its zoom say.
type Rect = { x: number; y: number; w: number; h: number }
type Sized = { interfaceSize?: { get: () => Promise<number>; on: (fn: (zoom: number) => void) => void } }
/** The desktop app's interface size (its whole-window zoom): a CSS px is this many screen points. */
let zoom = 1
const sized = typeof window === "undefined" ? undefined : (window as unknown as { vaultite?: Sized }).vaultite?.interfaceSize
if (sized) { void sized.get().then((z) => { zoom = z }, () => {}); sized.on((z) => { zoom = z }) }
/** Each of `places` ("pane:t3", "ui:tab:t3", "find:Morning report") found on screen now, as a rect in screen points. */
export function locate(places: unknown): Record<string, Rect> {
  const out: Record<string, Rect> = {}
  if (!Array.isArray(places)) return out
  // (the page's top left on the screen: the window's, below its own bar if it draws one; a CSS px is `z` points)
  const z = zoom, ox = window.screenX, oy = window.screenY + Math.max(0, window.outerHeight - window.innerHeight * z)
  for (const p of places.slice(0, 40)) {
    if (typeof p !== "string") continue
    const r = p.startsWith("find:") ? findText(p.slice(5)) : box(p.startsWith("ui:") ? p.slice(3) : p.startsWith("pane:") ? p : null)
    if (r) out[p] = { x: Math.round(ox + r.left * z), y: Math.round(oy + r.top * z), w: Math.round(r.width * z), h: Math.round(r.height * z) }
  }
  return out
}
const box = (id: string | null) => (id ? [...document.querySelectorAll<HTMLElement>(`[data-ui="${CSS.escape(id)}"]`)].find((e) => e.getClientRects().length > 0)?.getBoundingClientRect() ?? null : null)

/** What the companion draws itself: never what words are found in. */
const OWN = ".companion-overlay, [data-companion-bubble], .companion-cursor"
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
const shown = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
/** Where the window shows `text`: an element named it (a button's label or tip, its whole words), else the words
 *  themselves in its text, the first on screen. */
export function findText(text: string): DOMRect | null {
  const want = norm(text)
  if (!want) return null
  for (const el of document.querySelectorAll<HTMLElement>("[aria-label], [data-tip], button, a, [role]")) {
    if (el.closest(OWN)) continue
    const names = [el.getAttribute("aria-label"), el.dataset.tip, el.children.length ? null : el.textContent].filter((x): x is string => !!x)
    const r = names.some((n) => norm(n) === want) ? el.getBoundingClientRect() : null
    if (r && shown(r)) return r
  }
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const low = text.toLowerCase().trim()
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const i = (n.nodeValue ?? "").toLowerCase().indexOf(low)
    if (i < 0 || n.parentElement?.closest(OWN)) continue
    const range = document.createRange()
    range.setStart(n, i)
    range.setEnd(n, i + low.length)
    const r = range.getBoundingClientRect()
    if (shown(r)) return r
  }
  return null
}
