import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Bot, Globe, Pause, Play } from "lucide-react"
import { Bar, Button, cn, dateText, FilterField, fmtDay, fmtLongDay, get, iso, notifyError, PageHeader, selectPane, SidebarHeading, useChosen, useKeptCount, useNearScreen, usePane, webPages } from "@vaultite"
import { hostOf } from "./address"
import { SiteIcon } from "./icons"
import type { LiveTab } from "./livetabs"
import { showAppTab } from "./LiveView"
import { agentPage, openAsTab } from "./agentpages"
import { Replay } from "./Replay"
import { useShot } from "./runshots"
import { engine, type LiveRun as Live } from "./engine"
import { count, kindOf, said, span, type Run } from "./steps"


const TIME = { hour: "numeric", minute: "2-digit" } as const
const nameOf = (r: { task: string; title: string; url: string }) => r.task || r.title || hostOf(r.url) || "A run"

export function ReplaysView() {
  const { hidden } = usePane()
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [live, setLive] = useState<Live[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const back = useCallback(() => setOpen(null), [])
  const has = !!webPages?.engine
  useEffect(() => {
    if (hidden || open || !has) return
    let stop = false
    const read = () => void engine("agents:live").then((l) => { if (!stop) setLive(Array.isArray(l) ? l : []) }, () => {})
    read()
    const timer = setInterval(() => { if (document.visibilityState === "visible") read() }, 1000)
    return () => { stop = true; clearInterval(timer) }
  }, [hidden, open, has])
  const stepped = live.map((l) => `${l.run}@${l.at}`).join(" ")
  useEffect(() => {
    if (hidden || !has) return
    let stop = false
    void engine("agents:runs").then((r) => { if (!stop) setRuns(Array.isArray(r) ? r : []) }, () => { if (!stop) setRuns([]) })
    return () => { stop = true }
  }, [hidden, open, has, stepped])
  const days = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const found = (runs ?? []).filter((r) => { const hay = [r.by, r.task, r.summary, r.title, r.url, ...r.hosts].join(" ").toLowerCase(); return words.every((w) => hay.includes(w)) })
    const out: { day: string; runs: Run[] }[] = []
    for (const r of [...found].sort((a, b) => b.end - a.end)) {
      const day = iso(new Date(r.end))
      if (out[out.length - 1]?.day !== day) out.push({ day, runs: [] })
      out[out.length - 1].runs.push(r)
    }
    return out
  }, [runs, q])
  const kept = useKeptCount("web-viewer:runs", runs?.length)
  if (open) return <Replay run={open} info={runs?.find((r) => r.run === open)} live={live.some((l) => l.run === open)} back={back} />
  if (!has) return <div className="mx-auto h-full max-w-[720px] overflow-y-auto px-4 pt-6"><PageHeader title="Agents in the browser" /><p className="text-[15px] text-muted-foreground">Agents use the browser in Vaultite's desktop app.</p></div>
  const nothing = runs && !runs.length && !live.length
  return (
    <div className="h-full overflow-y-auto overscroll-contain [scrollbar-gutter:stable]" data-web-replays-scroller>
    <div className="@container mx-auto max-w-[1040px] px-4 pt-6 pb-10" data-web-replays>
      <PageHeader title="Agents in the browser" subtitle="What agents do in web pages, live, and each step they took, kept on this Mac for two weeks" />
      {nothing ? <Empty /> : (
        <>
          {live.length > 0 && (
            <section className="mb-6" data-web-live-list>
              <SidebarHeading title="Now" open />
              <div className="grid grid-cols-1 gap-3 px-1.5 pt-1 @xl:grid-cols-2 @4xl:grid-cols-3">
                {live.map((l) => <LiveCard key={l.tab} live={l} replay={setOpen} />)}
              </div>
            </section>
          )}
          <FilterField value={q} onChange={setQ} placeholder="Search by agent, task, summary or site" />
          {!runs ? <Loading count={kept} /> : !days.length
            ? <p className="px-1.5 pt-4 text-[15px] text-muted-foreground">{q ? `No run matches "${q}".` : "No past runs yet: they show here once an agent's done."}</p> : (
            <div className="mt-3 flex flex-col gap-4" data-size-up>
              {days.map((d) => (
                <section key={d.day} data-web-replays-day={d.day}>
                  <SidebarHeading title={dayTitle(d.day)} open />
                  <div className="flex flex-col">{d.runs.map((r) => <RunRow key={r.run} r={r} open={() => setOpen(r.run)} />)}</div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
    </div>
  )
}

function dayTitle(day: string) {
  const name = fmtDay(day)
  return name === "Today" || name === "Yesterday" ? `${name} · ${fmtLongDay(day)}` : fmtLongDay(day)
}

function Empty() {
  return (
    <div className="flex flex-col items-center px-6 pt-16 text-center" data-web-replays-empty>
      <span className="mb-4 grid size-14 place-items-center rounded-full" style={{ background: "color-mix(in srgb, var(--purple) 14%, transparent)" }}>
        <Bot className="size-7 text-ink-(--purple)" strokeWidth={1.75} />
      </span>
      <p className="text-[17px] font-semibold">No agent has used the browser yet</p>
      <p className="mt-1.5 max-w-[440px] text-[15px] leading-[21px] text-muted-foreground">
        When an agent opens a web page, you can watch it here as it works, then replay each step it took, with a picture of the page after each.
      </p>
    </div>
  )
}

function Loading({ count: n }: { count: number }) {
  return (
    <div className="loading-in mt-3 flex flex-col" aria-busy data-web-replays-loading="">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex gap-3 px-2 py-2">
          <span className="h-[70px] w-[112px] shrink-0 rounded-[6px] bg-foreground/[0.05]" />
          <span className="flex flex-1 flex-col gap-1.5 pt-1 text-[14px]"><Bar w={i % 2 ? "40%" : "55%"} /><Bar w="70%" /><Bar w="30%" /></span>
        </div>
      ))}
    </div>
  )
}

function RunRow({ r, open }: { r: Run; open: () => void }) {
  const box = useRef<HTMLButtonElement>(null)
  const near = useNearScreen(box)
  const cover = useShot(r.run, r.shots[r.shots.length - 1], true, near)
  const more = r.hosts.length - 1
  return (
    <button ref={box} type="button" onClick={open} data-web-replay={r.run}
      className="group flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-[10px] px-2 py-2 text-left hover:bg-foreground/[0.04]">
      <span className="relative h-[70px] w-[112px] shrink-0 overflow-hidden rounded-[6px] bg-muted ring-[0.5px] ring-border">
        {cover ? <img src={cover} alt="" draggable={false} className="size-full object-cover object-top" />
          : cover === null && <Globe className="absolute top-1/2 left-1/2 size-6 -translate-1/2 text-tertiary" strokeWidth={1.5} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[15px] font-medium">{nameOf(r)}</span>
          <span className="shrink-0 text-[13px] text-muted-foreground">{r.by || "An agent"}</span>
        </span>
        {r.summary && <span className="truncate text-[13px] text-muted-foreground">{r.summary}</span>}
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-tertiary tabular-nums">
          {r.hosts[0] && <><SiteIcon host={r.hosts[0]} className="size-3.5 shrink-0" /><span className="min-w-0 truncate">{r.hosts[0]}{more > 0 ? ` +${more}` : ""}</span><span>·</span></>}
          <span className="shrink-0">{dateText(r.start, TIME)}</span><span>·</span>
          <span className="shrink-0">{span(r.end - r.start)}</span><span>·</span>
          <span className="shrink-0">{count(r.steps)} {r.steps === 1 ? "step" : "steps"}</span>
          {r.failed > 0 && <><span>·</span><span className="shrink-0 font-medium text-ink-(--red)">{count(r.failed)} failed</span></>}
        </span>
      </span>
      <Activity r={r} />
    </button>
  )
}

function Activity({ r }: { r: Run }) {
  const most = Math.max(1, ...r.activity)
  return (
    <span className="hidden h-8 w-[132px] shrink-0 items-end gap-px @2xl:flex" aria-hidden data-web-replay-activity>
      {r.activity.map((n, i) => (
        <span key={i} className="flex-1 rounded-[1px]" style={{
          height: n ? `${Math.max(12, Math.sqrt(n / most) * 100)}%` : 2,
          background: r.fails[i] ? "var(--red)" : n ? "color-mix(in srgb, var(--foreground) 32%, transparent)" : "color-mix(in srgb, var(--foreground) 8%, transparent)",
        }} />
      ))}
    </span>
  )
}

function LiveCard({ live: l, replay }: { live: Live; replay: (run: string) => void }) {
  const show = () => {
    if (!l.appTab) { const p = agentPage(l.tab); if (p) void openAsTab(p); return }
    if (!selectPane(l.appTab)) void get<{ tabs: LiveTab[] }>("web-viewer/tabs").then((r) => { const t = r.tabs.find((x) => x.tab === l.tab); if (t) showAppTab(t) }, (e) => notifyError(e, "Couldn't show the tab"))
  }
  const [paused, choose] = useChosen(!!l.paused)
  const pause = () => choose(!paused, () => engine("agents:pause", l.tab, !paused), paused ? "Couldn't resume it" : "Couldn't pause it")
  const k = l.step?.action ? kindOf(l.step) : null
  const state = l.asking ? "Needs you" : paused ? "Paused" : "Live"
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border-[0.5px] border-border bg-card" data-web-live={l.tab}>
      <button type="button" onClick={show} aria-label={`Show ${l.title || hostOf(l.url)}`}
        className="relative block aspect-[16/10] w-full cursor-pointer overflow-hidden border-b-[0.5px] border-border bg-muted">
        {l.shot ? <img src={l.shot} alt="" className="size-full object-cover object-top" />
          : <Globe className="absolute top-1/2 left-1/2 size-7 -translate-1/2 text-tertiary" strokeWidth={1.5} />}
        <span className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-background/90 py-0.5 pr-2 pl-1.5 text-[11px] font-medium shadow-sm">
          <span className={cn("size-1.5 rounded-full", state === "Live" && "motion-safe:animate-pulse")}
            style={{ background: state === "Live" ? "var(--green)" : state === "Paused" ? "var(--gray)" : "var(--orange)" }} />{state}
        </span>
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 pt-2.5 pb-2.5">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[14px] font-medium">{nameOf(l)}</span>
          <span className="shrink-0 text-[12px] text-muted-foreground">{l.by || "An agent"}</span>
        </span>
        {l.summary && <span className="line-clamp-2 text-[12px] leading-[16px] text-muted-foreground">{l.summary}</span>}
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-tertiary">
          {l.asking ? <span className="line-clamp-2 text-foreground">{l.asking}</span> : l.step && l.at && k ? (
            <>
              <k.icon className="size-3.5 shrink-0" strokeWidth={2} style={{ color: k.color }} />
              <span className="min-w-0 truncate">{said(l.step)}</span>
              <span className="shrink-0 tabular-nums">· {dateText(l.at, TIME)}</span>
            </>
          ) : <><SiteIcon url={l.url} className="size-3.5 shrink-0" /><span className="truncate">{hostOf(l.url)}</span></>}
        </span>
        <div className="mt-auto flex flex-wrap items-center gap-1 pt-2">
          <Button look="secondary" size="small" onClick={show}>{l.appTab ? "Show tab" : "Open as tab"}</Button>
          <Button look="quiet" size="small" onClick={pause} data-web-live-pause={paused ? "resume" : "pause"}>
            {paused ? <Play className="size-3.5" strokeWidth={2.25} /> : <Pause className="size-3.5" strokeWidth={2.25} />}{paused ? "Resume" : "Pause"}
          </Button>
          {l.run && <Button look="quiet" size="small" className="ml-auto" onClick={() => replay(l.run!)} data-web-live-steps>Steps</Button>}
        </div>
      </div>
    </div>
  )
}
