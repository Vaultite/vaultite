import { lazy, Suspense, useSyncExternalStore } from "react"
import type { Drawing, Rect } from "../../../core/desktop/screenmarks"
import type { PenScript } from "../core/pilot"
import type { Here } from "./layout"

export type Shown = Drawing & { here: Here }
export type Act = { id?: string; kind: "clear" | "keep" | "copy" | "open" | "ask" | "dismiss" | "media"; text?: string; url?: string; places?: Record<string, Rect>; mark?: string
  sound?: boolean; paused?: boolean }
export type DrawBridge = { on: (fn: (d: Shown[] | Shown | null) => void) => () => void; act: (a: Act) => void }

const Draw = lazy(() => import("./Draw"))
const LEAVE = 220

type View = { up: Shown[]; gone: Shown[] }
let view: View = { up: [], gone: [] }
const listeners = new Set<() => void>()
const set = (v: View) => { view = v; for (const l of listeners) l() }
const bridge = window.vaultiteScreen?.draw
bridge?.on((x) => {
  const up = Array.isArray(x) ? x : x ? [x] : [], ids = new Set(up.map((d) => d.id))
  const left = view.up.filter((d) => !ids.has(d.id))
  if (left.length) setTimeout(() => set({ ...view, gone: view.gone.filter((g) => !left.includes(g)) }), LEAVE)
  set({ up, gone: [...view.gone.filter((g) => !ids.has(g.id)), ...left] })
})
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export function ScreenDrawings({ pen }: { pen?: (s: PenScript | null) => void }) {
  const { up, gone } = useSyncExternalStore(subscribe, () => view)
  if (!up.length && !gone.length) return null
  const lead = up.filter((d) => !d.past && !d.hidden).sort((a, b) => b.t - a.t)[0]?.id
  return <Suspense fallback={null}>
    {[...up, ...gone].map((d) => {
      const shown = up.filter((x) => !x.hidden), slot = shown.indexOf(d)
      return <Draw key={d.id} d={d} leaving={!up.includes(d)} act={(a) => bridge?.act(a)} pen={d.id === lead && d.here.home ? pen : undefined} slot={Math.max(0, slot)} named={shown.length > 1} />
    })}
  </Suspense>
}

document.head.append(Object.assign(document.createElement("style"), { textContent: `
.sd-root { transition: opacity ${LEAVE}ms ease-out; }
.sd-root.sd-leave, .sd-root.sd-hidden { opacity: 0; }
.sd-root.sd-hidden * { pointer-events: none !important; }
.sd-glow { filter: drop-shadow(0 0 5px color-mix(in srgb, var(--tint) 55%, transparent)) drop-shadow(0 1px 1px rgba(0,0,0,.28)); }
.sd-ink { fill: var(--tint); }
.sd-line { fill: none; stroke: var(--ink, var(--tint)); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; transition: stroke .4s; }
.sd-fill { fill: var(--fill); stroke: none; transition: fill .4s; }
.sd-svg { fill: none; stroke-linecap: round; stroke-linejoin: round; transition: stroke .4s; }
.sd-svg-fill { stroke: none; opacity: 0; animation: sd-fade .45s ease-out var(--delay, 0ms) forwards; transition: fill .4s; }
.sd-move { transition: transform .5s cubic-bezier(.3,.8,.3,1); }
.sd-dim { transition: d .5s cubic-bezier(.3,.8,.3,1); }
.sd-move-xy { transition: left .5s cubic-bezier(.3,.8,.3,1), top .5s cubic-bezier(.3,.8,.3,1), color .4s; }
/* erased: its pen run backward, what has no pen fading */
.sd-erase { pointer-events: none !important; }
.sd-erase .sd-pen { animation: sd-unpen .5s cubic-bezier(.5,0,.75,.6) forwards !important; }
.sd-erase :is(.sd-fill, .sd-svg-fill, .sd-ink, .sd-dot), .sd-erase > :is(div, .sd-shell), .sd-erase.sd-fade { animation: sd-out .45s ease-in forwards !important; }
@keyframes sd-unpen { from { stroke-dashoffset: 0; } to { stroke-dashoffset: 1; } }
@keyframes sd-out { from { opacity: 1; } to { opacity: 0; } }
.sd-shell { cursor: grab; } .sd-shell:active { cursor: grabbing; }
.sd-x { position: absolute; top: -8px; right: -8px; width: 20px; height: 20px; border-radius: 999px; display: grid; place-items: center; cursor: pointer; opacity: 0; transition: opacity .15s;
  background: var(--background); color: var(--foreground); box-shadow: 0 0 0 1px color-mix(in srgb, var(--foreground) 18%, transparent), 0 2px 6px rgba(0,0,0,.22); }
.sd-shell:hover > .sd-x, .sd-x:focus-visible { opacity: 1; } .sd-x:hover { background: color-mix(in srgb, var(--foreground) 10%, var(--background)); }
.sd-root button:focus-visible { outline: 2px solid var(--tint); outline-offset: 2px; }
.sd-media { overflow: hidden; }
/* a before picture over the thing as it is now: no lift, a quick fade in and out as it flips, its caption a tab */
.sd-card.sd-over { position: relative; overflow: visible; background: transparent; border-radius: 4px; box-shadow: 0 0 0 2px var(--tint); animation: sd-in .18s ease-out both; }
.sd-over .sd-media-box { background: transparent; overflow: hidden; border-radius: 4px; }
.sd-over-tab { position: absolute; bottom: calc(100% + 5px); left: -2px; padding: 0 8px; border-radius: 999px; font-size: 11px; font-weight: 600; line-height: 20px; white-space: nowrap; color: white; background: var(--tint); pointer-events: none; }
@keyframes sd-in { from { opacity: 0; } to { opacity: 1; } }
.sd-media-box { background: color-mix(in srgb, var(--foreground) 6%, var(--background)); }
.sd-media-box img, .sd-media-box video { display: block; }
.sd-media-wait { position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--foreground) 8%, transparent) 50%, transparent 70%) 0 0 / 200% 100%; animation: sd-shimmer 1.2s linear infinite; }
@keyframes sd-shimmer { to { background-position: -200% 0; } }
.sd-media-failed { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 12px; text-align: center; font-size: 13px; color: color-mix(in srgb, var(--foreground) 70%, transparent); }
.sd-media-caption { height: ${30}px; line-height: ${30}px; padding: 0 12px; font-size: 13px; font-weight: 500; }
.sd-media-bar { position: absolute; left: 8px; right: 8px; bottom: 8px; height: 28px; display: flex; align-items: center; gap: 6px; padding: 0 6px; border-radius: 999px; cursor: default;
  background: rgba(0,0,0,.55); color: white; opacity: 0; transition: opacity .15s; }
.sd-shell:hover .sd-media-bar, .sd-media-bar:focus-within, .sd-media:not([data-playing]) .sd-media-bar { opacity: 1; }
.sd-media-time { font-size: 11px; font-variant-numeric: tabular-nums; opacity: .85; white-space: nowrap; }
/* its sound, always on it: muted says so, so a press to hear it is never hidden */
.sd-media-sound { position: absolute; top: 8px; left: 8px; height: 26px; min-width: 26px; display: grid; place-items: center; border-radius: 999px; cursor: pointer;
  background: rgba(0,0,0,.55); color: white; box-shadow: 0 0 0 1px rgba(255,255,255,.18); transition: background .15s; }
.sd-media-sound:hover { background: rgba(0,0,0,.75); }
.sd-media[data-sound=on] .sd-media-sound { background: var(--tint); }
.sd-media-big { position: absolute; left: 50%; top: 50%; translate: -50% -50%; width: 48px; height: 48px; display: grid; place-items: center; border-radius: 999px; cursor: pointer;
  background: rgba(0,0,0,.55); color: white; box-shadow: 0 0 0 1px rgba(255,255,255,.2), 0 4px 14px rgba(0,0,0,.3); }
.sd-media-big:hover { background: rgba(0,0,0,.75); }
/* a choice: the question asked, its answers under it, as the companion's question bubble is drawn */
.sd-choices { padding: 12px; background: color-mix(in srgb, var(--tint) 9%, var(--background)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--tint) 70%, transparent), 0 10px 30px rgba(0,0,0,.2); }
.sd-choices-who { font-size: 11.5px; font-weight: 600; line-height: 20px; color: var(--tint); }
.sd-choices-q { font-size: 14px; font-weight: 600; line-height: 20px; margin-bottom: 8px; }
.sd-answer { width: 100%; min-height: 34px; display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px; text-align: left; cursor: pointer;
  background: var(--background); color: var(--foreground); font-size: 13.5px; font-weight: 600; line-height: 18px; box-shadow: 0 0 0 1px color-mix(in srgb, var(--tint) 35%, transparent); transition: background .12s, opacity .2s; }
.sd-answer svg { color: var(--tint); }
.sd-answer:hover:not(:disabled) { background: color-mix(in srgb, var(--tint) 14%, var(--background)); }
.sd-answer:disabled { cursor: default; opacity: .45; } .sd-answer[data-picked] { opacity: 1; box-shadow: 0 0 0 1.5px var(--tint); }
.sd-choices-hint { margin-top: 8px; font-size: 12px; line-height: 17px; color: color-mix(in srgb, var(--foreground) 62%, transparent); }
.sd-answer-sub { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; font-size: 12px; font-weight: 400; line-height: 17px; color: color-mix(in srgb, var(--foreground) 62%, transparent); overflow: hidden; }
.sd-media-bar button { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 999px; cursor: pointer; } .sd-media-bar button:hover { background: rgba(255,255,255,.18); }
.sd-media-bar input { flex: 1; min-width: 0; accent-color: var(--tint); cursor: pointer; }
.sd-lightbox { background: rgba(0,0,0,.6); animation: sd-fade .2s ease-out both; opacity: 0; }
.sd-lightbox-caption { position: absolute; bottom: 4vh; left: 50%; translate: -50% 0; padding: 6px 12px; border-radius: 999px; background: rgba(0,0,0,.6); color: white; font-size: 13px; }
.sd-hatch { stroke-width: 1.3; opacity: .75; }
.sd-dot { fill: var(--tint); }
.sd-focus { box-sizing: border-box; border: 2px solid var(--tint); background: color-mix(in srgb, var(--tint) 9%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, white 40%, transparent), 0 0 14px color-mix(in srgb, var(--tint) 35%, transparent);
  animation: sd-open var(--dur, 640ms) cubic-bezier(.5,0,.12,1) var(--delay, 0ms) both, sd-land 1s ease-out calc(var(--delay, 0ms) + var(--dur, 640ms) * .75) both; }
@keyframes sd-open { from { width: 12px; height: 12px; opacity: 0; } 10% { opacity: 1; } }
@keyframes sd-land { from { box-shadow: 0 0 0 1px color-mix(in srgb, white 40%, transparent), 0 0 0 5px color-mix(in srgb, var(--tint) 28%, transparent), 0 0 30px color-mix(in srgb, var(--tint) 65%, transparent); } }
.sd-past, .sd-gone { transition: opacity .5s ease-out; } .sd-past { opacity: .4; } .sd-gone { opacity: 0; }
.sd-dim { fill: rgba(0,0,0,.42); }
.sd-pen { stroke-dasharray: 1 1; stroke-dashoffset: 1; animation: sd-pen var(--dur, 500ms) cubic-bezier(.35,.1,.35,1) var(--delay, 0ms) forwards; }
@keyframes sd-pen { to { stroke-dashoffset: 0; } }
.sd-pop { opacity: 0; animation: sd-pop .3s cubic-bezier(.2,.9,.3,1.25) var(--delay, 0ms) forwards; }
@keyframes sd-pop { from { opacity: 0; scale: .85; } to { opacity: 1; scale: 1; } }
.sd-fade { opacity: 0; animation: sd-fade .35s ease-out var(--delay, 0ms) forwards; }
@keyframes sd-fade { to { opacity: 1; } }
/* (a scroll's arrow nudges a few times, then rests: nothing on screen moves for long on its own) */
.sd-bob-down { animation: sd-bob-y 1.2s ease-in-out 5; } .sd-bob-up { animation: sd-bob-y 1.2s ease-in-out 5 reverse; }
.sd-bob-right { animation: sd-bob-x 1.2s ease-in-out 5; } .sd-bob-left { animation: sd-bob-x 1.2s ease-in-out 5 reverse; }
@keyframes sd-bob-y { 50% { translate: 0 6px; } } @keyframes sd-bob-x { 50% { translate: 6px 0; } }
.sd-pill { height: 24px; padding: 0 11px; border-radius: 8px; background: var(--tint); color: white; font-size: 13px; font-weight: 600; line-height: 24px; letter-spacing: -.005em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  box-shadow: 0 0 0 1px color-mix(in srgb, white 55%, transparent), 0 4px 14px color-mix(in srgb, var(--tint) 30%, rgba(0,0,0,.22)); transform-origin: center; }
.sd-frame-tag { height: 20px; padding: 0 8px; border-radius: 6px; font-size: 12px; line-height: 20px; box-shadow: 0 0 0 1px color-mix(in srgb, white 45%, transparent), 0 2px 8px color-mix(in srgb, var(--tint) 25%, rgba(0,0,0,.2)); }
.sd-tag { opacity: 0; animation: sd-tag .42s cubic-bezier(.3,1.45,.55,1) var(--delay, 0ms) forwards; }
@keyframes sd-tag { from { opacity: 0; scale: .55; translate: var(--dx, 0) var(--dy, 0); } 40% { opacity: 1; } to { opacity: 1; scale: 1; translate: 0 0; } }
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
.sd-who { color: var(--tint); cursor: default; }
button.sd-tool:hover { background: color-mix(in srgb, var(--foreground) 8%, transparent); }
@media (prefers-reduced-motion: reduce) { .sd-pen, .sd-pop, .sd-fade, .sd-tag, .sd-focus, .sd-svg-fill, [class*="sd-bob"] { animation: none !important; opacity: 1; stroke-dashoffset: 0; }
  .sd-erase { display: none; } .sd-move, .sd-move-xy { transition: none; } }
` }))
