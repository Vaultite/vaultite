// Agents' pages, out of the user's tabs: while agents browse, a card in a corner (as the mini player), the picked page live
// with the agent's pointer moving in it, Open as tab and Pause. A float (layers.ts): pages under it stay live.
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react"
import { createPortal } from "react-dom"
import { AppWindow, Check, ChevronDown, ChevronUp, Ellipsis, Globe, MousePointer2, Pause, Play, X } from "lucide-react"
import { Button, cell, cn, CORNERS, menuBelow, openView, useCornerDrag, useDesktop, useScopedState, webPages, type Corner } from "@vaultite"
import { hostOf } from "./address"
import { onScreen } from "./state"
import { agentPages, closeAgentPage, doneAsk, openAsTab, pauseAgents, toBackground, whoOf, working, type AgentPage } from "./agentpages"

/** Pages the user closed the card on: it shows again for another page, or an ask. null: none closed. */
const dismissed = cell<Set<number> | null>(null)
/** What the card shows: pages out of sight (one in a tab on screen is seen), none while one on screen asks (its card at
 *  the tab's foot has the user's attention, and Done). */
const outOfSight = (pages: AgentPage[], seen: Set<number>) => (pages.some((p) => p.asking && seen.has(p.id)) ? [] : pages.filter((p) => !seen.has(p.id)))
const shows = (pages: AgentPage[], gone: Set<number> | null) => pages.length > 0 && (!gone || pages.some((p) => !gone.has(p.id) || p.asking))
export const agentsCardShown = () => shows(outOfSight(agentPages.get(), onScreen.get()), dismissed.get())
export const showAgentsCard = (on: boolean) => dismissed.set(on ? null : new Set(agentPages.get().map((p) => p.id)))

const PURPLE = "var(--purple)"
const engine = (name: string, ...args: unknown[]) => Promise.resolve(webPages?.engine?.(name, ...args))
const icon = "grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"

/** The card, on a computer, while some page is at work and it isn't closed. */
export function AgentsCard() {
  const all = agentPages.use()
  const seen = onScreen.use()
  const pages = outOfSight(all, seen)
  const gone = dismissed.use()
  const desktop = useDesktop()
  const on = desktop && shows(pages, gone)
  useEffect(() => { if (!all.length && gone) dismissed.set(null) }, [all.length, gone])
  if (!on) { return <Room px={0} /> }
  return createPortal(<Card pages={pages} />, document.body)
}

/** What's drawn at the bottom (toasts) keeps clear of the card in a bottom corner. */
function Room({ px }: { px: number }) {
  useEffect(() => {
    document.documentElement.style.setProperty("--agents-card", `${px}px`)
    return () => { document.documentElement.style.setProperty("--agents-card", "0px") }
  }, [px])
  return null
}

/** The page shown first: one asking, else the latest at work. */
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
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const el = drag.ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [drag.ref])
  return (
    <div role="region" aria-label="Agents in the browser" data-agents-card={open ? "open" : "closed"} {...drag}
      onKeyDown={(e) => { if (e.key === "Escape") showAgentsCard(false) }}
      className={cn("glass-strong fixed z-[19] w-[340px] max-w-[calc(100vw-2rem)] touch-none overflow-hidden rounded-[12px] shadow-lg select-none",
        "transition-[left,right] duration-200 ease-out data-dragging:cursor-grabbing data-dragging:shadow-2xl data-dragging:transition-none", CORNERS[at])}
      style={at[0] === "b" ? { bottom: "calc(2.5rem + var(--mini-player))" } : undefined}>
      <Room px={at[0] === "b" ? height + 8 : 0} />
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

/** The picked page as it is now: a click opens it as a tab (shows its tab). */
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

/** Who and what: its agent and task, and what it's doing now (else what it's for, or where it is). */
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

/** Whether this window is on screen: what's live stops while it isn't. */
function useShown() {
  const [on, setOn] = useState(!document.hidden)
  useEffect(() => {
    const f = () => setOn(!document.hidden)
    document.addEventListener("visibilitychange", f)
    return () => document.removeEventListener("visibilitychange", f)
  }, [])
  return on
}

/** Page `id` live: its frames as the desktop app sends them while this window watches it (renewed: a window gone stops
 *  it). */
function useFrame(id: number) {
  const [frame, setFrame] = useState<string | null>(null)
  const shown = useShown()
  const last = useRef(0)
  useEffect(() => {
    if (!shown) return
    let stop = false
    const watch = () => void engine("agents:watch", id).then((r) => {
      const f = (r as { frame?: string } | undefined)?.frame
      if (!stop && f && !last.current) setFrame(`data:image/jpeg;base64,${f}`)
    }, () => {})
    watch()
    const renew = setInterval(watch, 10_000)
    const off = webPages?.on((m) => {
      if (m.type !== "engine:live:frame" || m.tab !== id || typeof m.jpeg !== "string") return
      last.current = Date.now()
      setFrame(`data:image/jpeg;base64,${m.jpeg}`)
    })
    return () => { stop = true; last.current = 0; clearInterval(renew); off?.(); void engine("agents:unwatch", id).catch(() => {}) }
  }, [id, shown])
  return frame
}

/** Each page's small picture, every 2 s while shown. */
function useShots(ids: string) {
  const [shots, setShots] = useState<Record<number, string>>({})
  const shown = useShown()
  useEffect(() => {
    if (!ids || !shown) return
    let stop = false
    const want = new Set(ids.split(" ").map(Number))
    const read = () => void engine("agents:live").then((l) => {
      if (stop || !Array.isArray(l)) return
      setShots(Object.fromEntries((l as { tab: number; shot: string | null }[]).filter((x) => want.has(x.tab) && x.shot).map((x) => [x.tab, x.shot!])))
    }, () => {})
    read()
    const t = setInterval(read, 2000)
    return () => { stop = true; clearInterval(t) }
  }, [ids, shown])
  return shots
}

/** Now, again every second while `on` (what's "now" ages out). */
function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}
