// The companion's drawings over the screen (companion draw --marks), mounted by screen.tsx: what electron/overlay.ts
// sends this display, drawn by Draw.tsx (loaded with the first one); what the user presses goes back.
import { lazy, Suspense, useSyncExternalStore } from "react"
import type { Drawing, Rect } from "../../../plugins/core/companion/screenmarks"
import type { Here } from "./layout"

/** A drawing as this display gets it: `here`, where the display is and whether it has the cards. */
export type Shown = Drawing & { here: Here }
/** What the user pressed: Clear, Keep (with the places as found here), or a mark's action. */
export type Act = { id?: string; kind: "clear" | "keep" | "copy" | "open" | "ask"; text?: string; url?: string; places?: Record<string, Rect> }
export type DrawBridge = { on: (fn: (d: Shown | null) => void) => () => void; act: (a: Act) => void }

const Draw = lazy(() => import("./Draw"))
const LEAVE = 220

// (heard from the page's first moment, whether drawn yet or not: one sent with the first scene isn't lost)
type View = { d: Shown | null; gone: Shown | null }
let view: View = { d: null, gone: null }
const listeners = new Set<() => void>()
const set = (v: View) => { view = v; for (const l of listeners) l() }
const bridge = (window as unknown as { vaultiteScreen?: { draw?: DrawBridge } }).vaultiteScreen?.draw
bridge?.on((x) => {
  const was = view.d
  if (!x && was) setTimeout(() => { if (view.gone === was) set({ ...view, gone: null }) }, LEAVE)
  set({ d: x, gone: x ? null : was ?? view.gone })
})
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

/** This display's drawing, and the last one fading as it goes. */
export function ScreenDrawings({ grab }: { grab: (on: boolean) => void }) {
  const { d, gone } = useSyncExternalStore(subscribe, () => view), show = d ?? gone
  if (!show) return null
  return <Suspense fallback={null}><Draw key={show.id} d={show} leaving={!d} act={(a) => bridge?.act(a)} grab={grab} /></Suspense>
}

document.head.append(Object.assign(document.createElement("style"), { textContent: `
.sd-root { transition: opacity ${LEAVE}ms ease-out; }
.sd-root.sd-leave { opacity: 0; }
.sd-glow { filter: drop-shadow(0 0 5px color-mix(in srgb, var(--tint) 55%, transparent)) drop-shadow(0 1px 1px rgba(0,0,0,.28)); }
.sd-ink { fill: var(--tint); }
.sd-line { fill: none; stroke: var(--tint); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.sd-hatch { stroke-width: 1.3; opacity: .75; }
.sd-dot { fill: var(--tint); }
.sd-tintfill { fill: color-mix(in srgb, var(--tint) 11%, transparent); }
.sd-dim { fill: rgba(0,0,0,.42); }
.sd-pen { stroke-dasharray: 1 1; stroke-dashoffset: 1; animation: sd-pen var(--dur, 500ms) cubic-bezier(.35,.1,.35,1) var(--delay, 0ms) forwards; }
@keyframes sd-pen { to { stroke-dashoffset: 0; } }
.sd-pop { opacity: 0; animation: sd-pop .3s cubic-bezier(.2,.9,.3,1.25) var(--delay, 0ms) forwards; }
@keyframes sd-pop { from { opacity: 0; scale: .85; } to { opacity: 1; scale: 1; } }
.sd-fade { opacity: 0; animation: sd-fade .35s ease-out var(--delay, 0ms) forwards; }
@keyframes sd-fade { to { opacity: 1; } }
.sd-bob-down { animation: sd-bob-y 1.2s ease-in-out infinite; } .sd-bob-up { animation: sd-bob-y 1.2s ease-in-out infinite reverse; }
.sd-bob-right { animation: sd-bob-x 1.2s ease-in-out infinite; } .sd-bob-left { animation: sd-bob-x 1.2s ease-in-out infinite reverse; }
@keyframes sd-bob-y { 50% { translate: 0 6px; } } @keyframes sd-bob-x { 50% { translate: 6px 0; } }
.sd-pill { height: 22px; padding: 0 9px; border-radius: 999px; background: var(--tint); color: white; font-size: 12.5px; font-weight: 600; line-height: 22px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center;
  box-shadow: 0 0 0 1.5px color-mix(in srgb, white 70%, transparent), 0 2px 8px rgba(0,0,0,.25); transform-origin: center; }
.sd-badge { width: 24px; height: 24px; border-radius: 999px; background: var(--tint); color: white; font-size: 13px; font-weight: 700; display: grid; place-items: center;
  box-shadow: 0 0 0 2px white, 0 2px 8px rgba(0,0,0,.3); }
.sd-card { padding: 12px 14px; border-radius: 12px; background: var(--background); color: var(--foreground); font-size: 14px; line-height: 1.4;
  box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--tint) 45%, transparent), 0 10px 30px rgba(0,0,0,.18); transform-origin: top left; overflow: hidden; }
.sd-sticky { background: color-mix(in srgb, var(--yellow) 20%, var(--background)); }
.sd-title { font-weight: 600; margin-bottom: 6px; }
.sd-bullet { color: var(--tint); font-weight: 700; min-width: 1em; }
.sd-grid { background-image: linear-gradient(color-mix(in srgb, var(--foreground) 7%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--foreground) 7%, transparent) 1px, transparent 1px); background-size: 20px 20px; }
.sd-paper .sd-title { margin-bottom: 0; }
.sd-ptext { color: var(--foreground); white-space: pre; } .sd-ptext.sd-s { font-size: 12px; } .sd-ptext.sd-m { font-size: 14px; } .sd-ptext.sd-l { font-size: 20px; font-weight: 600; }
.sd-plabel { color: var(--foreground); font-size: 13px; font-weight: 500; line-height: 1.2; white-space: nowrap; }
.sd-axis { color: color-mix(in srgb, var(--foreground) 65%, transparent); font-size: 11px; }
.sd-write { color: var(--tint); font-weight: 600; line-height: 1.3; text-shadow: 0 0 2px var(--background), 0 0 6px var(--background), 0 0 12px var(--background); }
.sd-write.sd-s { font-size: 16px; } .sd-write.sd-m { font-size: 22px; } .sd-write.sd-l { font-size: 30px; }
.sd-chip { height: 30px; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; border-radius: 999px; cursor: pointer; background: var(--background); color: var(--foreground); font-size: 13px; font-weight: 600;
  box-shadow: 0 0 0 1.5px var(--tint), 0 4px 14px rgba(0,0,0,.2); transform-origin: left center; }
.sd-chip:hover { background: color-mix(in srgb, var(--tint) 12%, var(--background)); }
.sd-chip svg { color: var(--tint); }
.sd-tools { padding: 3px; border-radius: 999px; background: color-mix(in srgb, var(--background) 92%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--foreground) 12%, transparent), 0 6px 20px rgba(0,0,0,.2); transform-origin: bottom center; }
.sd-tool { height: 26px; display: inline-flex; align-items: center; gap: 4px; padding: 0 10px; border-radius: 999px; color: var(--foreground); font-size: 12.5px; font-weight: 600; cursor: pointer; }
button.sd-tool:hover { background: color-mix(in srgb, var(--foreground) 8%, transparent); }
@media (prefers-reduced-motion: reduce) { .sd-pen, .sd-pop, .sd-fade, [class*="sd-bob"] { animation: none !important; opacity: 1; stroke-dashoffset: 0; } }
` }))
