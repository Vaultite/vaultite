// Where the app's places are on the screen, for a drawing over it (the server's `locate`): a pane, the app's UI by its
// data-ui id. Screen points, as the window's own position and its page's CSS px say (zoom 1).

/** Each of `places` ("pane:t3", "ui:tab:t3") found on screen now, as a rect in screen points. */
export function locate(places: unknown): Record<string, { x: number; y: number; w: number; h: number }> {
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {}
  if (!Array.isArray(places)) return out
  // (the page's top left on the screen: the window's, below its own bar if it draws one)
  const ox = window.screenX, oy = window.screenY + (window.outerHeight - window.innerHeight)
  for (const p of places.slice(0, 40)) {
    if (typeof p !== "string") continue
    const id = p.startsWith("ui:") ? p.slice(3) : p.startsWith("pane:") ? p : null
    const el = id && [...document.querySelectorAll<HTMLElement>(`[data-ui="${CSS.escape(id)}"]`)].find((e) => e.getClientRects().length > 0)
    if (!el) continue
    const r = el.getBoundingClientRect()
    out[p] = { x: Math.round(ox + r.left), y: Math.round(oy + r.top), w: Math.round(r.width), h: Math.round(r.height) }
  }
  return out
}
