import { useEffect, useState, type MouseEvent } from "react"
import { createPortal } from "react-dom"
import { AppWindow, Check, ChevronDown, ChevronUp, Ellipsis, Globe, MousePointer2, Pause, Play, X } from "lucide-react"
import { Button, cell, cn, CORNERS, menuBelow, openView, useCornerDrag, useCornerStack, useDesktop, useScopedState, type Corner } from "@vaultite"
import { hostOf } from "./address"
import { onScreen, pictured } from "./state"
import { useFrame, useShown } from "./liveframe"
import { engine } from "./engine"
import { agentPages, closeAgentPage, doneAsk, openAsTab, pauseAgents, toBackground, whoOf, working, type AgentPage } from "./agentpages"

const dismissed = cell<Set<number> | null>(null)
const outOfSight = (pages: AgentPage[], seen: Set<number>) => (pages.some((p) => p.asking && seen.has(p.id)) ? [] : pages.filter((p) => !seen.has(p.id)))
const shows = (pages: AgentPage[], gone: Set<number> | null) => pages.length > 0 && (!gone || pages.some((p) => !gone.has(p.id) || p.asking))
const seenNow = (a: Set<number>, b: Set<number>) => (b.size ? new Set([...a, ...b]) : a)
export const agentsCardShown = () => shows(outOfSight(agentPages.get(), seenNow(onScreen.get(), pictured.get())), dismissed.get())
export const showAgentsCard = (on: boolean) => dismissed.set(on ? null : new Set(agentPages.get().map((p) => p.id)))

const PURPLE = "var(--purple)"
const icon = "grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"

export function AgentsCard() {
  const all = agentPages.use()
  const seen = seenNow(onScreen.use(), pictured.use())
  const pages = outOfSight(all, seen)
  const gone = dismissed.use()
  const desktop = useDesktop()
  const on = desktop && shows(pages, gone)
  useEffect(() => { if (!all.length && gone) dismissed.set(null) }, [all.length, gone])
  if (!on) return null
  return createPortal(<Card pages={pages} />, document.body)
}

const first = (pages: AgentPage[]) => pages.find((p) => p.asking) ?? [...pages].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0]

function Card({ pages }: { pages: AgentPage[] }) {
  const [corner, setCorner] = useScopedState<Corner>("web-viewer:agents-corner", "br", "device")
  const [open, setOpen] = useScopedState("web-viewer:agents-open", true, "device")
  const [picked, pick] = useState<number | null>(null)
  const page = pages.find((p) => p.id === picked) ?? first(pages)
  const others = pages.filter((p) => p !== page)
  const shots = useShots(pages.map((p) => p.id).join(" "))
  const drag = useCornerDrag(corner, setCorner)
  const at = CORNERS[corner] ? corner : "br"
  const place = useCornerStack("agents", at, 1, drag.ref)
  return (
    <div role="region" aria-label="Agents in the browser" data-agents-card={open ? "open" : "closed"} {...drag}
      onKeyDown={(e) => { if (e.key === "Escape") showAgentsCard(false) }}
      className={cn("glass-strong fixed z-[19] w-[340px] max-w-[calc(100vw-2rem)] touch-none overflow-hidden rounded-[12px] shadow-lg select-none",
        "transition-[left,right,margin] duration-200 ease-out data-dragging:cursor-grabbing data-dragging:shadow-2xl data-dragging:transition-none", CORNERS[at])}
      style={place}>
      {open && <Live page={page} />}
      <Bar page={page} shot={open ? null : shots[page.id]} more={others.length} open={open} setOpen={setOpen} />
      {page.asking && (
        <div className="mx-2 mb-2 flex items-center gap-2 rounded-[8px] py-1.5 pr-1.5 pl-2.5" style={{ background: "color-mix(in srgb, var(--purple) 12%, transparent)" }} data-agent-ask>
          <span className="min-w-0 flex-1 text-[13px] leading-[18px]">{page.asking}</span>
          <Button size="small" look="primary" onClick={() => void doneAsk(page.id)}><Check className="size-3.5" strokeWidth={2.5} />Done</Button>
        </div>
      )}
      {open && others.length > 0 && (
        <ul className="flex max-h-[168px] flex-col gap-px overflow-y-auto border-t-[0.5px] border-border p-1" data-agents-others>
          {others.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => pick(p.id)} data-agent-page={p.id}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] p-1 text-left hover:bg-foreground/[0.05]">
                <Thumb src={shots[p.id]} className="h-[34px] w-[54px] shrink-0 rounded-[5px]" />
                <Lines page={p} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Live({ page: p }: { page: AgentPage }) {
  const frame = useFrame(p.id)
  return (
    <button type="button" onClick={() => void openAsTab(p)} aria-label={p.tab ? "Show tab" : "Open as tab"} data-agent-live={p.id}
      className="relative block aspect-[16/10] w-full cursor-pointer overflow-hidden border-b-[0.5px] border-border bg-muted">
      <Thumb src={frame} className="absolute inset-0 size-full" />
      {(p.paused || p.asking) && (
        <span className="absolute top-2 left-2 rounded-[6px] bg-background/90 px-1.5 py-0.5 text-[11px] font-medium">{p.asking ? "Needs you" : "Paused"}</span>
      )}
    </button>
  )
}

function Lines({ page: p, more = 0 }: { page: AgentPage; more?: number }) {
  const now = useNow(!!p.at)
  const what = p.asking ? "Needs you" : p.paused ? "Paused" : working(p, now) ? p.what : p.summary || p.title || hostOf(p.url)
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-[13px] font-medium" data-agent-who>{whoOf(p)}</span>
      <span className={cn("truncate text-[12px]", p.asking ? "font-medium" : "text-muted-foreground")} style={p.asking ? { color: PURPLE } : undefined}>
        {what}{more ? ` · ${more} more` : ""}
      </span>
    </span>
  )
}

function Bar({ page: p, shot, more, open, setOpen }: { page: AgentPage; shot: string | null | undefined; more: number; open: boolean; setOpen: (on: boolean) => void }) {
  const menu = (e: MouseEvent) => menuBelow(e, [
    { label: p.paused ? "Resume" : "Pause", icon: p.paused ? Play : Pause, run: () => void pauseAgents(p.id, !p.paused) },
    ...(p.tab && p.own ? [{ label: "Move to background", icon: MousePointer2, run: () => void toBackground(p) }] : []),
    { label: "Show agents in the browser", icon: AppWindow, run: () => openView("agent-runs", { newTab: true }) },
    ...(p.own ? [{ label: "Close page", icon: X, sep: true, danger: true, run: () => void closeAgentPage(p.id) }] : []),
  ])
  return (
    <div className="flex h-12 items-center gap-2 pr-1 pl-2" data-agent-picked={p.id}>
      {open ? <span className="grid size-8 shrink-0 place-items-center rounded-full" style={{ background: "color-mix(in srgb, var(--purple) 14%, transparent)" }}>
        <MousePointer2 className={cn("size-4", working(p) && "animate-pulse")} strokeWidth={2.25} style={{ color: PURPLE }} />
      </span> : <button type="button" onClick={() => setOpen(true)} aria-label="Show it live" className="shrink-0 cursor-pointer"><Thumb src={shot} className="h-8 w-[51px] rounded-[5px]" /></button>}
      <Lines page={p} more={open ? 0 : more} />
      <button type="button" className={icon} onClick={() => void openAsTab(p)} aria-label={p.tab ? "Show tab" : "Open as tab"} data-tip={p.tab ? "Show tab" : "Open as tab"} data-agent-open>
        <AppWindow className="size-4" strokeWidth={2} />
      </button>
      <button type="button" className={icon} onClick={menu} aria-label="More" data-tip="More"><Ellipsis className="size-4" strokeWidth={2} /></button>
      <button type="button" className={icon} onClick={() => setOpen(!open)} aria-label={open ? "Smaller" : "Show it live"} data-tip={open ? "Smaller" : "Show it live"}>
        {open ? <ChevronDown className="size-4" strokeWidth={2} /> : <ChevronUp className="size-4" strokeWidth={2} />}
      </button>
      <button type="button" className={icon} onClick={() => showAgentsCard(false)} aria-label="Close" data-tip="Close"><X className="size-4" strokeWidth={2} /></button>
    </div>
  )
}

function Thumb({ src, className }: { src: string | null | undefined; className?: string }) {
  return src ? <img src={src} alt="" className={cn("object-cover object-top", className)} draggable={false} />
    : <span className={cn("grid place-items-center bg-muted", className)}><Globe className="size-4 text-tertiary" strokeWidth={1.5} /></span>
}

function useShots(ids: string) {
  const [shots, setShots] = useState<Record<number, string>>({})
  const shown = useShown()
  useEffect(() => {
    if (!ids || !shown) return
    let stop = false
    const want = new Set(ids.split(" ").map(Number))
    const read = () => void engine("agents:live").then((l) => {
      if (stop || !Array.isArray(l)) return
      setShots(Object.fromEntries(l.filter((x) => want.has(x.tab) && x.shot).map((x) => [x.tab, x.shot!])))
    }, () => {})
    read()
    const t = setInterval(read, 2000)
    return () => { stop = true; clearInterval(t) }
  }, [ids, shown])
  return shots
}

function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}
