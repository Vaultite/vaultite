import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useStateFor } from "@/core/statefor"
import { HOLD } from "./screendraw/hold"
import { api, type IslandBridge, type IslandData } from "./island/data"
import { Mark } from "./island/Mark"
import { Cursor, Foot, Groups } from "./island/Rows"
import { WalkMark, WalkRow } from "./island/Walk"
import { walkWidth } from "./island/walkwords"
import { atRest } from "../../core/desktop/knocks"
export type { IslandBridge }

const TUCK = 14
const FOOT = 14

function useFaces() {
  const told = useRef("")
  const tell = () => {
    const list = document.querySelector(".island-rows"), view = list?.getBoundingClientRect()
    const rects = [...document.querySelectorAll<HTMLElement>("[data-island-at]")].flatMap((el) => {
      const r = el.getBoundingClientRect(), v = view && list?.contains(el) ? view : null
      const top = v ? Math.max(r.top, v.top) : r.top, bottom = v ? Math.min(r.bottom, v.bottom) : r.bottom
      return bottom - top < 4 ? [] : [{ id: el.dataset.islandAt!, x: Math.round(r.x), y: Math.round(top), width: Math.round(r.width), height: Math.round(bottom - top) }]
    })
    const text = JSON.stringify(rects)
    if (text !== told.current) { told.current = text; api?.faces?.(rects) }
    list?.setAttribute("data-more", `${list.scrollTop > 1 ? "top " : ""}${list.scrollTop + list.clientHeight < list.scrollHeight - 1 ? "bottom" : ""}`.trim())
  }
  useLayoutEffect(tell)
  return tell
}

function useOpen(knock: boolean) {
  const [open, setOpen] = useState(false), [, tick] = useState(0)
  const hold = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(hold.current), [])
  useEffect(() => { if (!open) return; const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t) }, [open])
  const go = (on: boolean, ms: number) => {
    clearTimeout(hold.current)
    if (ms) hold.current = setTimeout(() => setOpen(on), ms)
    else setOpen(on)
  }
  return { open, enter: () => go(true, knock ? 1 : 120), leave: () => go(false, 220), show: () => go(true, 0), close: () => go(false, 0) }
}

function KnockLine({ d, drop, close }: { d: IslandData & { knock: NonNullable<IslandData["knock"]> }; drop: boolean; close: () => void }) {
  const { knock } = d, of = d.presences.find((p) => p.knock === knock.id), calm = !!knock.hold
  const open = () => api?.act("open", of?.id ?? knock.id), action = calm ? "Show me" : "Answer"
  return (
    <>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={open} data-island-knock={knock.id} data-calm={calm || undefined} {...(of ? { "data-island-at": of.id } : {})}>
        <Cursor tint={of?.tint ?? knock.tint} size={14} />
        <span className={cn("island-line min-w-0 text-[12.5px] leading-none", drop ? "island-wrap" : "truncate")}><b className="font-semibold">{knock.who}</b><span className="text-white/75">{`  ${knock.line}`}</span></span>
      </button>
      <button type="button" className={cn("island-chip ml-1 shrink-0", !calm && "island-chip-main")} onClick={open} data-island-action={action}>{action}</button>
      <button type="button" className="island-chip island-icon shrink-0" onClick={() => { close(); api?.act("dismiss", knock.id) }} aria-label="Close" data-island-dismiss><X className="size-3.5" /></button>
    </>
  )
}

const Said = ({ text, drop }: { text: string; drop: boolean }) =>
  <span key={text} className={cn("island-fade island-line min-w-0 text-[12.5px] leading-none text-white/80", drop ? "island-wrap" : "truncate")} data-walk-note role="status">{text}</span>

const walkNow = (d: IslandData) => (d.walk && d.walk.state !== "told" ? d.walk : null)
const roomOf = (d: IslandData) => (d.spot.room ?? Infinity) - walkWidth(walkNow(d))
function lineOf(d: IslandData, drop: boolean, close: () => void) {
  if (d.knock) return <KnockLine d={{ ...d, knock: d.knock }} drop={drop} close={close} />
  return d.walk?.note ? <Said text={d.walk.note} drop={drop} /> : null
}

function useFit() {
  const inner = useRef<HTMLDivElement>(null), [fit, setFit] = useState(0)
  useLayoutEffect(() => { const w = inner.current?.offsetWidth ?? 0; if (w && w !== fit) setFit(w) })
  return { inner, fit }
}

function Bar({ d, line, drop, show, inner, fit }: { d: IslandData; line: React.ReactNode; drop: boolean; show: () => void } & ReturnType<typeof useFit>) {
  const { attached, bar } = d.spot, walk = walkNow(d), radius = bar / 2, tuck = attached ? TUCK : 0, words = !!walk || (!!line && !drop)
  return (
    <div className="island text-white" {...HOLD} onClick={show}
      style={{ borderRadius: attached ? `0 0 ${radius}px 0` : `0 0 ${radius}px ${radius}px`, paddingLeft: tuck, width: fit ? fit + tuck : undefined }}>
      <div ref={inner} className={cn("flex w-max items-center gap-1.5", words ? "px-2.5" : attached ? "pr-2 pl-0.5" : "px-2")} style={{ height: bar }}>
        {walk && <WalkMark w={walk} />}
        {line && !drop ? line : (
          <div className="flex items-center" aria-label="Agents in the background">
            <Mark presences={d.presences} />
            {!walk && line && !atRest(d.presences) && <span className="size-2 rounded-full bg-white/45" aria-hidden />}
          </div>
        )}
      </div>
    </div>
  )
}

function Card({ d, line, list, view, tell }: { d: IslandData; line: React.ReactNode; list: boolean; view: { left?: number; right?: number }; tell: () => void }) {
  const { spot } = d, walk = walkNow(d), top = spot.bar + 6
  const [done, setDone] = useStateFor([list], () => false)
  return (
    <div {...HOLD} className={cn("island-card text-white", spot.align === "centre" && "island-card-centre")} style={{ top, maxHeight: `calc(100vh - ${top + FOOT}px)`, ...view }}>
      {line && <div className="flex shrink-0 items-center gap-1.5 px-2.5 py-2.5">{line}</div>}
      {list && (
        <>
          <div className={cn("island-rows px-1.5", !line && "mt-1")} role="list" onScroll={tell}>
            {walk && <WalkRow w={walk} />}
            <Groups presences={d.presences} answering={d.answering} done={done} toggle={() => setDone((v) => !v)} />
          </div>
          <Foot companion={d.companion} />
        </>
      )}
    </div>
  )
}

function Shown({ d }: { d: IslandData }) {
  const { open, enter, leave, show, close } = useOpen(!!d.knock)
  const tell = useFaces(), fit = useFit()
  const { spot } = d, centre = spot.align === "centre", room = roomOf(d), said = !!d.knock || !!d.walk?.note
  const drop = said && room < 320, rows = d.presences.length > 0 || !!walkNow(d), list = open && rows, tuck = spot.attached ? TUCK : 0
  const line = lineOf(d, drop, close), view = centre ? {} : room < 340 ? { right: 0 } : { left: tuck }
  return (
    <div className="island-root" onPointerEnter={enter} onPointerLeave={leave} data-island data-open={open || undefined}
      style={{ position: "absolute", top: 0, left: d.left - tuck, ...(centre ? { transform: "translateX(-50%)" } : {}) }}>
      <Bar d={d} line={line} drop={drop} show={show} {...fit} />
      {(list || drop) && <Card d={d} line={drop ? line : null} list={list} view={view} tell={tell} />}
    </div>
  )
}

export function Island() {
  const [d, setD] = useState<IslandData | null>(null)
  useEffect(() => api?.on(setD), [])
  return d && <Shown d={d} />
}
