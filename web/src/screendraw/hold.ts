// The overlay's windows take the pointer only over what's marked `data-hold`: their boxes go to the main process, which
// decides by where the pointer is (electron/overlaywin.ts), never by this page's enters and leaves.

/** A box in the window's points. */
export type Box = { x: number; y: number; width: number; height: number }
type Bridge = { holds?: (m: { boxes: Box[]; pressing: boolean }) => void; near?: () => void }

/** Spread on what takes the pointer. */
export const HOLD = { "data-hold": "" } as const

/** The boxes of the page's visible `data-hold` elements (none hidden, see-through or taking no pointer). */
export function holdBoxes(root: ParentNode = document): Box[] {
  const out: Box[] = []
  for (const el of root.querySelectorAll<HTMLElement>("[data-hold]")) {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) || getComputedStyle(el).pointerEvents === "none") continue
    for (const r of el.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue
      const x = Math.floor(r.left), y = Math.floor(r.top)
      out.push({ x, y, width: Math.ceil(r.right) - x, height: Math.ceil(r.bottom) - y })
    }
  }
  return out
}

/** Keep the main process told of the page's holds (`api`: the preload's bridge) from now on; the stop. */
export function tellHolds(api: Bridge | undefined) {
  if (!api?.holds) return () => {}
  let told = "", soon = 0, pressing = false, renewed = 0, neared = 0
  const send = (force = false) => {
    const boxes = holdBoxes(), text = JSON.stringify(boxes) + pressing
    if (!force && text === told) return
    told = text
    renewed = performance.now()
    api.holds!({ boxes, pressing })
  }
  // (looked at once a frame at most; again each frame while something on the page moves or fades to an end)
  const look = () => {
    soon = 0
    send()
    if (document.getAnimations().some((a) => a.playState === "running" && Number.isFinite(a.effect?.getComputedTiming().endTime as number))) schedule()
  }
  const schedule = () => { if (!soon) soon = requestAnimationFrame(look) }
  const held = (e: Event) => e.target instanceof Element && !!e.target.closest("[data-hold]")
  const on: [EventTarget, string, (e: Event) => void][] = [
    [window, "pointerover", (e) => { schedule(); if (held(e)) api.near?.() }],
    [window, "pointerdown", (e) => { if (held(e)) { pressing = true; send() } }],
    // (a press goes on: said again now and then, or the window lets it go, overlaywin.ts PRESS_MS; over one, the pointer is
    // said to be there now and then too, which takes it if the first time came a moment early)
    [window, "pointermove", (e) => {
      const now = performance.now()
      if (pressing && now - renewed > 500) send(true)
      else schedule()
      if (!pressing && held(e) && now - neared > 150) { neared = now; api.near?.() }
    }],
    [window, "pointerup", () => { if (pressing) { pressing = false; send() } }],
    [window, "pointercancel", () => { if (pressing) { pressing = false; send() } }],
    [window, "resize", schedule], [document, "scroll", schedule],
    [document, "transitionrun", schedule], [document, "animationstart", schedule],
  ]
  for (const [t, ev, fn] of on) t.addEventListener(ev, fn, { capture: true, passive: true })
  const seen = new MutationObserver(schedule)
  seen.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
  schedule()
  return () => { for (const [t, ev, fn] of on) t.removeEventListener(ev, fn, { capture: true }); seen.disconnect(); cancelAnimationFrame(soon) }
}
