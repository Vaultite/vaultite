// The island by the notch (electron/island.ts): at rest one still count (orange only while one waits on the user), a
// knock's line as it comes (its × closes it into the island), a QA walk or lesson while on; a hover lists them in the Agents panel's groups and words.
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Undo2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useStateFor } from "@/core/statefor"
import { HOLD } from "./screendraw/hold"
import { type Knock, type Presence, PRESENCE_GROUPS } from "../../core/desktop/knocks"
import { countText, type WalkScene } from "../../core/desktop/walks"

type Spot = { x: number; y: number; bar: number; align: "left" | "centre"; attached: boolean; room?: number }
export type IslandData = { presences: Presence[]; knock: (Knock & { tint: string; left: number }) | null; walk: WalkScene | null; spot: Spot; left: number; width: number }
type Bridge = { on: (fn: (d: IslandData) => void) => () => void; act: (act: string, id: string, mute?: boolean) => void
  faces?: (list: { id: string; x: number; y: number; width: number; height: number }[]) => void }
const api = (window as unknown as { vaultiteScreen?: { island?: Bridge } }).vaultiteScreen?.island

/** How far the black runs in under the notch (islandlogic.ts' TUCK). */
const TUCK = 14
/** Room kept under the card in its window (electron/island.ts' H), for its shadow: past that it scrolls. */
const FOOT = 14
/** A row's second line when its agent says nothing of its own. */
const QUIET: Record<Presence["state"], string> = { "needs you": "Waiting on you", ready: "Ready for review", working: "Working", done: "Done" }
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60_000); return m < 1 ? "now" : m < 60 ? `${m}m` : `${Math.round(m / 60)}h` }

/** An agent as its cursor on screen: its own colour, edged white. */
function Cursor({ tint, size = 15 }: { tint: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className="shrink-0">
      <path d="M3 2.5 L16.5 9.2 L10.3 10.9 L7.6 16.8 Z" fill={`var(--${tint})`} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

/** At rest: one cursor and a count, never a face each. Orange counting who waits on the user; else white, counting who
 *  works, a dot when one is ready for review. Moves once, when more come to need them or be ready. */
function Mark({ presences }: { presences: Presence[] }) {
  const n = (s: Presence["state"]) => presences.filter((p) => p.state === s).length
  const needs = n("needs you"), ready = n("ready"), working = n("working")
  const was = useRef({ needs, ready }), [nudge, setNudge] = useState(0)
  useEffect(() => {
    if (needs > was.current.needs || ready > was.current.ready) setNudge((x) => x + 1)
    was.current = { needs, ready }
  }, [needs, ready])
  if (!needs && !ready && !working) return null
  const state = needs ? "needs you" : ready && !working ? "ready" : "working"
  // (a Talk key held over it talks to the newest one waiting on them: a spoken reply to what just came)
  const one = presences.filter((p) => p.state === "needs you" && p.terminal).sort((a, b) => b.since - a.since)[0]
  const label = [needs && `${needs} need${needs === 1 ? "s" : ""} you`, ready && `${ready} ready for review`, working && `${working} working`].filter(Boolean).join(", ")
  return (
    <span key={nudge} className={cn("flex items-center gap-[5px]", nudge > 0 && "island-nudge")} data-island-mark={state} data-count={needs || working} aria-label={label}
      {...(one ? { "data-island-at": one.id } : {})}>
      <svg width={13} height={13} viewBox="0 0 20 20" aria-hidden className={needs ? "" : "opacity-[.62]"}>
        <path d="M3 2.5 L16.5 9.2 L10.3 10.9 L7.6 16.8 Z" fill={needs ? "var(--orange)" : "#fff"} />
      </svg>
      {(needs || working) > 0 && <span className={cn("text-[12px] font-semibold tabular-nums", needs ? "text-[var(--orange)]" : "text-white/[.62]")}>{needs || working}</span>}
      {!needs && ready > 0 && <span className="size-[5px] rounded-full bg-white/75" data-island-ready />}
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

/** One agent in the list: its cursor, its name and when, what it does now; its action on the row. */
function Row({ p }: { p: Presence }) {
  const open = () => api?.act("open", p.id)
  const action = p.state === "needs you" ? "Answer" : p.state === "ready" ? "Show me" : null
  return (
    <div role="listitem" className={cn("island-row", p.state === "done" && "opacity-60")} data-island-row={p.id} data-island-at={p.id} data-state={p.state}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={open}>
        <Cursor tint={p.tint} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2"><span className="truncate text-[12.5px] font-semibold">{p.who}</span>
            <span className="shrink-0 text-[11px] text-white/45 tabular-nums">{ago(p.since)}</span></span>
          <span className="block truncate text-[11.5px] text-white/65">{p.line ?? p.step ?? QUIET[p.state]}</span>
        </span>
      </button>
      {action && (
        <span className="flex shrink-0 gap-1">
          <button type="button" className={cn("island-chip", p.state === "needs you" && "island-chip-main")} onClick={open} data-island-action={action}>{action}</button>
          {p.knock && p.state === "needs you" && <button type="button" className="island-chip" onClick={() => api?.act("later", p.knock!)}>Not now</button>}
        </span>
      )}
    </div>
  )
}

export function Island() {
  const [d, setD] = useState<IslandData | null>(null)
  const [open, setOpen] = useState(false)
  const [done, setDone] = useStateFor([open], () => false)
  const hold = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => api?.on(setD), [])
  // (its width follows what it holds, on a spring: the mark, a knock's line)
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
  useEffect(() => () => clearTimeout(hold.current), [])
  // (the list's "2m"s, kept true while it's open; the done ones fold again once it closes)
  const [, tick] = useState(0)
  useEffect(() => { if (!open) return; const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t) }, [open])
  if (!d) return null
  const { spot, presences, knock } = d, walk = d.walk && d.walk.state !== "told" ? d.walk : null
  // (a word from the walk: as an item is noted, or where it went once it's over)
  const said = !knock && d.walk?.note ? d.walk.note : null
  const enter = () => {
    clearTimeout(hold.current)
    hold.current = setTimeout(() => setOpen(true), knock ? 0 : 120)
  }
  const leave = () => {
    clearTimeout(hold.current)
    hold.current = setTimeout(() => setOpen(false), 220)
  }
  const attached = spot.attached, centre = spot.align === "centre"
  const walkW = walk ? 30 + walkWords(walk).name.length * 7 + String(walk.count).length * 7 : 0
  const room = (spot.room ?? Infinity) - walkW
  const radius = spot.bar / 2
  const of = knock ? presences.find((p) => p.knock === knock.id) : undefined
  // (a ready one's card is calm: Show me; one waiting on them: Answer and Not now. No countdown either way)
  const calm = !!knock?.hold
  // (no room for its line before the status items: it drops into a card below the bar, as the list does, rather than
  // cover them; the card hangs from the bar's end, reaching back under the notch when room is short)
  const drop = (!!knock || !!said) && room < 320, rows = presences.length > 0 || !!walk, card = (open && rows) || drop, back = room < 340
  const line = knock ? (
    <>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => api?.act("open", of?.id ?? knock.id)} data-island-knock={knock.id} data-calm={calm || undefined} {...(of ? { "data-island-at": of.id } : {})}>
        <Cursor tint={of?.tint ?? knock.tint} size={14} />
        <span className={cn("island-line min-w-0 text-[12.5px] leading-none", drop ? "island-wrap" : "truncate")}><b className="font-semibold">{knock.who}</b><span className="text-white/75">{`  ${knock.line}`}</span></span>
      </button>
      <button type="button" className={cn("island-chip ml-1 shrink-0", !calm && "island-chip-main")} onClick={() => api?.act("open", of?.id ?? knock.id)} data-island-action={calm ? "Show me" : "Answer"}>{calm ? "Show me" : "Answer"}</button>
      {/* (closes the card at once, as its time running out would: it rests in the island, listed there; Not now is the list's) */}
      <button type="button" className="island-chip island-icon shrink-0" onClick={() => { setOpen(false); api?.act("dismiss", knock.id) }} aria-label="Close" data-island-dismiss><X className="size-3.5" /></button>
    </>
  ) : said ? (
    <span key={said} className={cn("island-fade island-line min-w-0 text-[12.5px] leading-none text-white/80", drop ? "island-wrap" : "truncate")} data-walk-note role="status">{said}</span>
  ) : null
  const groups = PRESENCE_GROUPS.map((g) => ({ ...g, rows: presences.filter((p) => p.state === g.state) })).filter((g) => g.rows.length)
  return (
    <div className="island-root" onPointerEnter={enter} onPointerLeave={leave} data-island data-open={open || undefined}
      style={{ position: "absolute", top: 0, left: d.left - (attached ? TUCK : 0), ...(centre ? { transform: "translateX(-50%)" } : {}) }}>
      {/* (the bar and its card take the pointer, `HOLD`: the rest of the window lets it through) */}
      <div className="island text-white" {...HOLD}
        style={{ borderRadius: attached ? `0 0 ${radius}px 0` : `0 0 ${radius}px ${radius}px`, paddingLeft: attached ? TUCK : 0, width: fit ? fit + (attached ? TUCK : 0) : undefined }}>
        <div ref={inner} className="flex w-max items-center gap-1.5 px-2.5" style={{ height: spot.bar }}>
          {walk && <WalkMark w={walk} />}
          {line && !drop ? line : (
            <div className="flex items-center" aria-label="Agents in the background">
              <Mark presences={presences} />
              {!walk && !presences.some((p) => p.state !== "done") && line && drop && <span className="size-2 rounded-full bg-white/45" aria-hidden />}
            </div>
          )}
        </div>
      </div>
      {card && (
        <div {...HOLD} className={cn("island-card text-white", centre && "island-card-centre")} style={{ top: spot.bar + 6, maxHeight: `calc(100vh - ${spot.bar + 6 + FOOT}px)`, ...(centre ? {} : back ? { right: 0 } : { left: attached ? TUCK : 0 }) }}>
          {drop && <div className="flex shrink-0 items-center gap-1.5 px-2.5 py-2.5">{line}</div>}
          {open && rows && (
            <>
              <div ref={list} className={cn("island-rows px-1.5", !drop && "mt-1")} role="list" onScroll={tell} data-more={ends || undefined}>
                {walk && <WalkRow w={walk} />}
                {groups.map((g) => g.state === "done" ? (
                  <div key={g.state} className="contents">
                    <button type="button" className="island-fold" onClick={() => setDone((v) => !v)} aria-expanded={done} data-island-done={g.rows.length}>
                      <span>{g.rows.length} done</span><span aria-hidden className={cn("island-chev", done && "rotate-90")}>›</span>
                    </button>
                    {done && g.rows.map((p) => <Row key={p.id} p={p} />)}
                  </div>
                ) : (
                  <div key={g.state} className="contents">
                    <div className="island-group" style={g.state === "needs you" ? { color: "var(--orange)" } : undefined} data-island-group={g.state}>{g.label} · {g.rows.length}</div>
                    {g.rows.map((p) => <Row key={p.id} p={p} />)}
                  </div>
                ))}
              </div>
              <button type="button" className="island-foot" onClick={() => api?.act("agents", "view:agents")} data-island-agents>All agents</button>
            </>
          )}
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
.island-chip-main { background: #fff; color: #000 }
.island-chip-main:hover { background: rgb(255 255 255 / .86) }
.island-chip:disabled { opacity: .4; background: rgb(255 255 255 / .14) }
.island-icon { display: grid; place-items: center; width: 24px; padding: 4px 0 }
.island-fade { animation: island-fade 200ms ease-out }
.island-rows { display: flex; flex-direction: column; gap: 1px; padding-bottom: 4px; flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  scrollbar-width: thin; scrollbar-color: rgb(255 255 255 / .28) transparent; --fade: 22px }
.island-rows > * { flex-shrink: 0 }
.island-rows[data-more="bottom"] { mask-image: linear-gradient(#000 calc(100% - var(--fade)), transparent) }
.island-rows[data-more="top"] { mask-image: linear-gradient(transparent, #000 var(--fade)) }
.island-rows[data-more="top bottom"] { mask-image: linear-gradient(transparent, #000 var(--fade) calc(100% - var(--fade)), transparent) }
.island-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 12px }
.island-row:hover { background: rgb(255 255 255 / .09) }
.island-group { font-size: 11px; font-weight: 600; color: rgb(255 255 255 / .5); padding: 8px 8px 3px }
.island-fold { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: rgb(255 255 255 / .5); padding: 7px 8px; border-radius: 12px; text-align: left; cursor: default }
.island-fold:hover { background: rgb(255 255 255 / .09); color: rgb(255 255 255 / .7) }
.island-chev { display: inline-block; transition: rotate 160ms ease }
.island-foot { flex-shrink: 0; text-align: left; font-size: 12px; color: rgb(255 255 255 / .7); margin: 2px 8px 6px; padding: 8px 6px 2px; border-top: 1px solid rgb(255 255 255 / .1); cursor: default }
.island-foot:hover { color: #fff }
/* (the one motion at rest: once, as more come to need them or be ready) */
.island-nudge { animation: island-nudge 520ms cubic-bezier(.3, 1.4, .5, 1) }
@keyframes island-nudge { 40% { transform: scale(1.22) } }
@keyframes island-in { from { opacity: 0; transform: translateY(-4px) } }
@keyframes island-fade { from { opacity: 0 } }
@media (prefers-reduced-motion: reduce) { .island-nudge, .island-fade { animation: none } }
`
