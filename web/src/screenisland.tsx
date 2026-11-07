// The island by the notch (electron/island.ts): background sessions as faces on black running on from the notch (top
// centre with none); a knock shows its line with "Not now"; a hover lists them, each to open, put off or ignore.
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Knock, Presence } from "../../plugins/core/companion/knocks"

type Spot = { x: number; y: number; bar: number; align: "left" | "centre"; attached: boolean; room?: number }
export type IslandData = { presences: Presence[]; knock: (Knock & { tint: string; left: number }) | null; spot: Spot; left: number; width: number }
type Bridge = { on: (fn: (d: IslandData) => void) => () => void; grab: (on: boolean) => void; act: (act: string, id: string, mute?: boolean) => void
  faces?: (list: { id: string; x: number; y: number; width: number; height: number }[]) => void }
const api = (window as unknown as { vaultiteScreen?: { island?: Bridge } }).vaultiteScreen?.island

/** How far the black runs in under the notch (islandlogic.ts' TUCK). */
const TUCK = 14
const SHOWN = 5
const SAID: Record<Presence["state"], string> = { working: "Working", "needs you": "Needs you", done: "Done" }
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60_000); return m < 1 ? "now" : m < 60 ? `${m}m` : `${Math.round(m / 60)}h` }

function Face({ p, size = 18 }: { p: Presence; size?: number }) {
  return (
    <span className="relative grid shrink-0 place-items-center rounded-full font-semibold text-white" data-island-face={p.id} data-state={p.state}
      style={{ width: size, height: size, fontSize: size * 0.55, background: `var(--${p.tint})` }}>
      {p.who.replace(/^[^\p{L}\p{N}]+/u, "").charAt(0).toUpperCase() || "·"}
      {p.state === "working" && <span aria-hidden className="island-spin absolute -inset-[3px] rounded-full" style={{ "--tint": `var(--${p.tint})` } as React.CSSProperties} />}
      {p.state === "needs you" && <span aria-hidden className="island-ping absolute -top-[2px] -right-[2px] size-[7px] rounded-full bg-[var(--orange)] ring-[1.5px] ring-black" />}
      {p.state === "done" && (
        <span aria-hidden className="absolute -right-[3px] -bottom-[3px] grid size-[10px] place-items-center rounded-full bg-[var(--green)] ring-[1.5px] ring-black">
          <Check className="size-[7px] text-black" strokeWidth={4} />
        </span>
      )}
    </span>
  )
}

export function Island() {
  const [d, setD] = useState<IslandData | null>(null)
  const [open, setOpen] = useState(false)
  const over = useRef(false), hold = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => api?.on(setD), [])
  // (its width follows what it holds, on a spring: the faces, a knock's line, the list)
  const inner = useRef<HTMLDivElement>(null), [fit, setFit] = useState(0)
  useLayoutEffect(() => { const w = inner.current?.offsetWidth ?? 0; if (w && w !== fit) setFit(w) })
  // (where each session shows, told after each change: a Talk key held over one talks to it)
  const told = useRef("")
  useLayoutEffect(() => {
    const list = [...document.querySelectorAll<HTMLElement>("[data-island-at]")].map((el) => { const r = el.getBoundingClientRect()
      return { id: el.dataset.islandAt!, x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } })
    const text = JSON.stringify(list)
    if (text !== told.current) { told.current = text; api?.faces?.(list) }
  })
  useEffect(() => () => { if (over.current) api?.grab(false) }, [])
  // (the grace's line drains from what's left of it as the knock came)
  const [, tick] = useState(0)
  useEffect(() => { if (!d?.knock) return; const t = setInterval(() => tick((n) => n + 1), 100); return () => clearInterval(t) }, [d?.knock?.id])
  if (!d) return null
  const { spot, presences, knock } = d
  const enter = () => {
    if (!over.current) { over.current = true; api?.grab(true) }
    clearTimeout(hold.current)
    hold.current = setTimeout(() => setOpen(true), knock ? 0 : 120)
  }
  const leave = () => {
    if (over.current) { over.current = false; api?.grab(false) }
    clearTimeout(hold.current)
    hold.current = setTimeout(() => setOpen(false), 220)
  }
  const attached = spot.attached, centre = spot.align === "centre"
  // (as many faces as rest clear of the menu bar's status items, +N for the rest)
  const room = spot.room ?? Infinity, wide = (n: number) => 20 + n * 25 - 7 + (n < presences.length ? 25 : 0)
  let n = Math.min(SHOWN, presences.length)
  while (n > 1 && wide(n) > room) n--
  const shown = presences.slice(0, n), more = presences.length - n
  const radius = spot.bar / 2
  const of = knock ? presences.find((p) => p.knock === knock.id) : undefined
  const ring = knock ? Math.max(0, Math.min(1, knock.left / 3000)) : 0
  // (no room for its line before the status items: it drops into a card below the bar, as the list does, rather than
  // cover them; the card hangs from the bar's end, reaching back under the notch when room is short)
  const drop = !!knock && room < 320, card = open || drop, back = room < 340
  const line = knock && (
    <>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => api?.act("open", of?.id ?? knock.id)} data-island-knock={knock.id} {...(of ? { "data-island-at": of.id } : {})}>
        {of ? <Face p={of} /> : <span className="size-[18px] shrink-0 rounded-full" style={{ background: `var(--${knock.tint})` }} />}
        <span className={cn("island-line min-w-0 text-[12.5px] leading-none", drop ? "island-wrap" : "truncate")}><b className="font-semibold">{knock.who}</b><span className="text-white/75">{`  ${knock.line}`}</span></span>
      </button>
      <button type="button" className="island-chip ml-1 shrink-0" onClick={() => api?.act("later", knock.id)} data-island-later>Not now</button>
    </>
  )
  const grace = knock && <span aria-hidden className="island-grace" style={{ transform: `scaleX(${ring})`, background: `var(--${knock.tint})` }} />
  return (
    <div className="island-root" onPointerEnter={enter} onPointerLeave={leave} data-island data-open={open || undefined}
      style={{ position: "absolute", top: 0, left: d.left - (attached ? TUCK : 0), ...(centre ? { transform: "translateX(-50%)" } : {}) }}>
      <div className="island text-white"
        style={{ borderRadius: attached ? `0 0 ${radius}px 0` : `0 0 ${radius}px ${radius}px`, paddingLeft: attached ? TUCK : 0, width: fit ? fit + (attached ? TUCK : 0) : undefined }}>
        <div ref={inner} className="flex w-max items-center gap-1.5 px-2.5" style={{ height: spot.bar }}>
          {knock && !drop ? line : (
            <div className="flex items-center gap-[7px]" aria-label="Sessions in the background">
              {shown.map((p) => <span key={p.id} data-island-at={p.id} className="grid"><Face p={p} /></span>)}
              {more > 0 && <span className="text-[11px] font-semibold text-white/70">+{more}</span>}
            </div>
          )}
        </div>
        {knock && !drop && grace}
      </div>
      {card && (
        <div className={cn("island-card text-white", centre && "island-card-centre")} style={{ top: spot.bar + 6, ...(centre ? {} : back ? { right: 0 } : { left: attached ? TUCK : 0 }) }}>
          {drop && <div className="flex items-center gap-1.5 px-2.5 py-2.5">{line}</div>}
          {open && (
            <div className={cn("island-rows px-1.5 pb-1.5", !drop && "pt-1.5")} role="list">
              {presences.map((p) => (
                <div key={p.id} role="listitem" className="island-row" data-island-row={p.id} data-island-at={p.id}>
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => api?.act("open", p.id)}>
                    <Face p={p} size={22} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2"><span className="truncate text-[12.5px] font-semibold">{p.who}</span>
                        <span className={cn("shrink-0 text-[11px]", p.state === "needs you" ? "text-[var(--orange)]" : "text-white/55")}>{SAID[p.state]} · {ago(p.since)}</span></span>
                      {p.line && <span className="block truncate text-[11.5px] text-white/70">{p.line}</span>}
                    </span>
                  </button>
                  {p.knock && (
                    <span className="flex shrink-0 gap-1">
                      <button type="button" className="island-chip" onClick={() => api?.act("later", p.knock!)}>Not now</button>
                      <button type="button" className="island-chip" onClick={() => api?.act("ignore", p.knock!)}>Ignore</button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {drop && grace}
        </div>
      )}
    </div>
  )
}

export const ISLAND_STYLE = `
:root { interpolate-size: allow-keywords }
html, body { background: transparent !important; overflow: hidden }
.island { background: #000; max-width: 440px; overflow: hidden; position: relative;
  transition: width 420ms cubic-bezier(.3, 1.25, .45, 1), border-radius 260ms ease, box-shadow 260ms ease; font-family: -apple-system, system-ui, sans-serif; -webkit-font-smoothing: antialiased }
.island-card { position: absolute; width: 340px; background: #000; border-radius: 18px; overflow: hidden; box-shadow: 0 10px 30px rgb(0 0 0 / .35);
  animation: island-in 240ms cubic-bezier(.2, .9, .3, 1); font-family: -apple-system, system-ui, sans-serif; -webkit-font-smoothing: antialiased }
.island-card-centre { left: 50%; translate: -50% 0 }
.island-line { max-width: 300px; white-space: pre }
.island-wrap { white-space: normal; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden }
.island-chip { font-size: 11.5px; font-weight: 600; line-height: 1; padding: 5px 9px; border-radius: 999px; background: rgb(255 255 255 / .14); color: #fff; cursor: default }
.island-chip:hover { background: rgb(255 255 255 / .24) }
.island-grace { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; transform-origin: left; transition: transform 100ms linear; opacity: .9 }
.island-rows { display: flex; flex-direction: column; gap: 2px }
.island-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 12px }
.island-row:hover { background: rgb(255 255 255 / .09) }
.island-spin { background: conic-gradient(from 0deg, transparent 0 55%, var(--tint) 100%); -webkit-mask: radial-gradient(circle, transparent calc(50% - 1.6px), #000 calc(50% - 1.5px));
  mask: radial-gradient(circle, transparent calc(50% - 1.6px), #000 calc(50% - 1.5px)); animation: island-turn 1.1s linear infinite }
.island-ping { animation: island-ping 1.6s ease-in-out infinite }
@keyframes island-turn { to { transform: rotate(1turn) } }
@keyframes island-ping { 50% { transform: scale(.7); opacity: .6 } }
@keyframes island-in { from { opacity: 0; transform: translateY(-4px) } }
@media (prefers-reduced-motion: reduce) { .island-spin, .island-ping { animation: none } }
`
