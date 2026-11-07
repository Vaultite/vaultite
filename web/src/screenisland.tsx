// The island by the notch (electron/island.ts): sessions as faces running on from the notch, a knock's line with Not now,
// a QA walk or lesson leading while on (walk.ts, teach.ts); a hover lists them, each with its buttons.
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Check, Undo2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { holdOf, type Knock, type Presence } from "../../plugins/core/companion/knocks"
import { countText, type WalkScene } from "../../plugins/core/companion/walks"

type Spot = { x: number; y: number; bar: number; align: "left" | "centre"; attached: boolean; room?: number }
export type IslandData = { presences: Presence[]; knock: (Knock & { tint: string; left: number }) | null; walk: WalkScene | null; spot: Spot; left: number; width: number }
type Bridge = { on: (fn: (d: IslandData) => void) => () => void; grab: (on: boolean) => void; act: (act: string, id: string, mute?: boolean) => void
  faces?: (list: { id: string; x: number; y: number; width: number; height: number }[]) => void }
const api = (window as unknown as { vaultiteScreen?: { island?: Bridge } }).vaultiteScreen?.island

/** How far the black runs in under the notch (islandlogic.ts' TUCK). */
const TUCK = 14
const SHOWN = 5
/** Room kept under the card in its window (electron/island.ts' H), for its shadow: past that it scrolls. */
const FOOT = 14
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

/** A walk's or a lesson's words: what it is, how many so far. */
function walkWords(w: WalkScene) {
  const lesson = w.of === "lesson"
  return { name: lesson ? "Watching" : "QA walk", count: lesson ? (w.count === 1 ? "1 step" : `${w.count} steps`) : countText(w.count), lesson }
}

/** In the bar: a walk on (a red dot as it listens), what it is and its count. */
function WalkMark({ w }: { w: WalkScene }) {
  const { name, count } = walkWords(w)
  return (
    <span className="flex shrink-0 items-center gap-1.5 pr-1 text-[12.5px] leading-none" data-walk={w.state} aria-label={`${name}, ${count}`}>
      <span className={cn("size-2 rounded-full", w.state === "on" ? "bg-[var(--red)]" : "bg-white/45")} />
      <b className="font-semibold">{name}</b>
      <span className="text-white/60 tabular-nums" data-walk-count={w.count}>{w.count}</span>
    </span>
  )
}

/** In the list: the walk with its buttons; its × asks once more before discarding what it noted. */
function WalkRow({ w }: { w: WalkScene }) {
  const [discard, setDiscard] = useState(false)
  useEffect(() => { if (!discard) return; const t = setTimeout(() => setDiscard(false), 3500); return () => clearTimeout(t) }, [discard])
  const { name, count, lesson } = walkWords(w), act = (what: string) => api?.act("walk", what)
  const sub = w.state === "sending" ? (lesson ? "Making it…" : "Sending…") : w.note ?? (w.state === "paused" ? "Paused while you talk to the companion" : lesson ? "Say done to make it a tour or a skill" : "Talk as you go; say done to send")
  return (
    <div role="listitem" className="island-row" data-walk-row={w.state}>
      <span className={cn("grid size-[22px] shrink-0 place-items-center rounded-full", w.state === "on" ? "bg-[var(--red)]/25" : "bg-white/10")}>
        <span className={cn("size-2 rounded-full", w.state === "on" ? "bg-[var(--red)]" : "bg-white/50")} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2"><span className="truncate text-[12.5px] font-semibold">{name}</span>
          <span className="shrink-0 text-[11px] text-white/55 tabular-nums">{count}</span></span>
        <span key={sub} className="island-fade block truncate text-[11.5px] text-white/70">{sub}</span>
      </span>
      {w.state !== "sending" && (discard ? (
        <button type="button" className="island-chip shrink-0 text-[var(--red)]" onClick={() => { setDiscard(false); act("cancel") }}>Discard {count}</button>
      ) : (
        <span className="flex shrink-0 gap-1">
          {!lesson && <button type="button" className="island-chip island-icon" disabled={!w.count} onClick={() => act("scratch")} aria-label="Scratch the last item"><Undo2 className="size-3.5" /></button>}
          <button type="button" className="island-chip" disabled={!w.count} onClick={() => act("done")} aria-label={lesson ? "Done: make it a tour or a skill" : "Done: send the walk"}>Done</button>
          <button type="button" className="island-chip island-icon" onClick={() => (w.count ? setDiscard(true) : act("cancel"))} aria-label={lesson ? "Stop watching and forget it" : "End the walk without sending it"}><X className="size-3.5" /></button>
        </span>
      ))}
    </div>
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
  // (a row scrolled out of the list isn't there: each is clipped to what the list shows, and told again as it scrolls)
  const told = useRef(""), list = useRef<HTMLDivElement>(null), [ends, setEnds] = useState("")
  const tell = () => {
    const view = list.current?.getBoundingClientRect()
    const rects = [...document.querySelectorAll<HTMLElement>("[data-island-at]")].flatMap((el) => {
      const r = el.getBoundingClientRect(), v = view && list.current!.contains(el) ? view : null
      const top = v ? Math.max(r.top, v.top) : r.top, bottom = v ? Math.min(r.bottom, v.bottom) : r.bottom
      return bottom - top < 4 ? [] : [{ id: el.dataset.islandAt!, x: Math.round(r.x), y: Math.round(top), width: Math.round(r.width), height: Math.round(bottom - top) }]
    })
    const text = JSON.stringify(rects)
    if (text !== told.current) { told.current = text; api?.faces?.(rects) }
    // (which ends have more past them: the list fades there)
    const l = list.current, more = l ? `${l.scrollTop > 1 ? "top " : ""}${l.scrollTop + l.clientHeight < l.scrollHeight - 1 ? "bottom" : ""}`.trim() : ""
    if (more !== ends) setEnds(more)
  }
  useLayoutEffect(tell)
  useEffect(() => () => { clearTimeout(hold.current); if (over.current) api?.grab(false) }, [])
  // (the list's "2m ago"s, kept true while it's open)
  const [, tick] = useState(0)
  useEffect(() => { if (!open) return; const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t) }, [open])
  if (!d) return null
  const { spot, presences, knock } = d, walk = d.walk && d.walk.state !== "told" ? d.walk : null
  // (a word from the walk: as an item is noted, or where it went once it's over)
  const said = !knock && d.walk?.note ? d.walk.note : null
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
  // (as many faces as rest clear of the menu bar's status items, +N for the rest; a walk on leads, taking its room)
  const walkW = walk ? 30 + walkWords(walk).name.length * 7 + String(walk.count).length * 7 : 0
  const room = (spot.room ?? Infinity) - walkW, wide = (n: number) => 20 + n * 25 - 7 + (n < presences.length ? 25 : 0)
  let n = Math.min(SHOWN, presences.length)
  while (n > 1 && wide(n) > room) n--
  const shown = presences.slice(0, n), more = presences.length - n
  const radius = spot.bar / 2
  const of = knock ? presences.find((p) => p.knock === knock.id) : undefined
  const ring = knock ? Math.max(0, Math.min(1, knock.left / holdOf(knock))) : 0
  // (no room for its line before the status items: it drops into a card below the bar, as the list does, rather than
  // cover them; the card hangs from the bar's end, reaching back under the notch when room is short)
  const drop = (!!knock || !!said) && room < 320, rows = presences.length > 0 || !!walk, card = (open && rows) || drop, back = room < 340
  const line = knock ? (
    <>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => api?.act("open", of?.id ?? knock.id)} data-island-knock={knock.id} {...(of ? { "data-island-at": of.id } : {})}>
        {of ? <Face p={of} /> : <span className="size-[18px] shrink-0 rounded-full" style={{ background: `var(--${knock.tint})` }} />}
        <span className={cn("island-line min-w-0 text-[12.5px] leading-none", drop ? "island-wrap" : "truncate")}><b className="font-semibold">{knock.who}</b><span className="text-white/75">{`  ${knock.line}`}</span></span>
      </button>
      <button type="button" className="island-chip ml-1 shrink-0" onClick={() => api?.act("later", knock.id)} data-island-later>Not now</button>
    </>
  ) : said ? (
    <span key={said} className={cn("island-fade island-line min-w-0 text-[12.5px] leading-none text-white/80", drop ? "island-wrap" : "truncate")} data-walk-note role="status">{said}</span>
  ) : null
  const grace = knock && <span aria-hidden className="island-grace" style={{ transform: `scaleX(${ring})`, background: `var(--${knock.tint})` }} />
  return (
    <div className="island-root" onPointerEnter={enter} onPointerLeave={leave} data-island data-open={open || undefined}
      style={{ position: "absolute", top: 0, left: d.left - (attached ? TUCK : 0), ...(centre ? { transform: "translateX(-50%)" } : {}) }}>
      <div className="island text-white"
        style={{ borderRadius: attached ? `0 0 ${radius}px 0` : `0 0 ${radius}px ${radius}px`, paddingLeft: attached ? TUCK : 0, width: fit ? fit + (attached ? TUCK : 0) : undefined }}>
        <div ref={inner} className="flex w-max items-center gap-1.5 px-2.5" style={{ height: spot.bar }}>
          {walk && <WalkMark w={walk} />}
          {line && !drop ? line : (
            <div className="flex items-center gap-[7px]" aria-label="Sessions in the background">
              {shown.map((p) => <span key={p.id} data-island-at={p.id} className="grid"><Face p={p} /></span>)}
              {more > 0 && <span className="text-[11px] font-semibold text-white/70">+{more}</span>}
              {!walk && !shown.length && line && drop && <span className="size-2 rounded-full bg-white/45" aria-hidden />}
            </div>
          )}
        </div>
        {knock && !drop && grace}
      </div>
      {card && (
        <div className={cn("island-card text-white", centre && "island-card-centre")} style={{ top: spot.bar + 6, maxHeight: `calc(100vh - ${spot.bar + 6 + FOOT}px)`, ...(centre ? {} : back ? { right: 0 } : { left: attached ? TUCK : 0 }) }}>
          {drop && <div className="flex shrink-0 items-center gap-1.5 px-2.5 py-2.5">{line}</div>}
          {open && rows && (
            <div ref={list} className={cn("island-rows mb-1.5 px-1.5", !drop && "mt-1.5")} role="list" onScroll={tell} data-more={ends || undefined}>
              {walk && <WalkRow w={walk} />}
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
.island-card { position: absolute; width: 340px; display: flex; flex-direction: column; background: #000; border-radius: 18px; overflow: hidden; box-shadow: 0 10px 30px rgb(0 0 0 / .35);
  animation: island-in 240ms cubic-bezier(.2, .9, .3, 1); font-family: -apple-system, system-ui, sans-serif; -webkit-font-smoothing: antialiased }
.island-card-centre { left: 50%; translate: -50% 0 }
.island-line { max-width: 300px; white-space: pre }
.island-wrap { white-space: normal; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden }
.island-chip { font-size: 11.5px; font-weight: 600; line-height: 1; padding: 5px 9px; border-radius: 999px; background: rgb(255 255 255 / .14); color: #fff; cursor: default }
.island-chip:hover { background: rgb(255 255 255 / .24) }
.island-chip:disabled { opacity: .4; background: rgb(255 255 255 / .14) }
.island-icon { display: grid; place-items: center; width: 24px; padding: 4px 0 }
.island-fade { animation: island-fade 200ms ease-out }
.island-grace { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; transform-origin: left; transition: transform 220ms linear; opacity: .9 }
.island-rows { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  scrollbar-width: thin; scrollbar-color: rgb(255 255 255 / .28) transparent; --fade: 22px }
.island-rows > * { flex-shrink: 0 }
.island-rows[data-more="bottom"] { mask-image: linear-gradient(#000 calc(100% - var(--fade)), transparent) }
.island-rows[data-more="top"] { mask-image: linear-gradient(transparent, #000 var(--fade)) }
.island-rows[data-more="top bottom"] { mask-image: linear-gradient(transparent, #000 var(--fade) calc(100% - var(--fade)), transparent) }
.island-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 12px }
.island-row:hover { background: rgb(255 255 255 / .09) }
.island-spin { background: conic-gradient(from 0deg, transparent 0 55%, var(--tint) 100%); -webkit-mask: radial-gradient(circle, transparent calc(50% - 1.6px), #000 calc(50% - 1.5px));
  mask: radial-gradient(circle, transparent calc(50% - 1.6px), #000 calc(50% - 1.5px)); animation: island-turn 1.1s linear infinite; animation-play-state: paused }
/* (turning only while looked at: at rest an arc says working, and the menu bar draws nothing each frame) */
.island-root:hover .island-spin { animation-play-state: running }
/* (a few beats as it comes, then the dot rests: it stays till they answer) */
.island-ping { animation: island-ping 1.6s ease-in-out 6 }
@keyframes island-turn { to { transform: rotate(1turn) } }
@keyframes island-ping { 50% { transform: scale(.7); opacity: .6 } }
@keyframes island-in { from { opacity: 0; transform: translateY(-4px) } }
@keyframes island-fade { from { opacity: 0 } }
@media (prefers-reduced-motion: reduce) { .island-spin, .island-ping, .island-fade { animation: none } }
`
