// Agents in the browser: the tabs agents work in now, live (Show tab, Pause), then past runs, searched, to replay step
// by step with the page as it was after each, kept on this Mac a fortnight (electron/browser/agent.ts).
import { useCallback, useEffect, useMemo, useState } from "react"
import { Bot, ChevronLeft, ChevronRight, Globe, Pause, Play } from "lucide-react"
import { Button, cn, dateText, FilterField, get, notifyError, selectTab, SidebarHeading, SidebarRow, useChosen, usePane, webPages } from "@vaultite"
import { hostOf } from "./address"
import type { LiveTab } from "./livetabs"
import { showAppTab } from "./LiveView"
import { agentPage, openAsTab } from "./agentpages"

type Run = { run: string; by: string; task: string; summary: string; steps: number; start: number; end: number; title: string; url: string }
type Step = { t: number; tab: number; by: string; url: string; title: string; action: string; ref?: string; name?: string; value?: string
  fields?: { name?: string; ref: string; value?: string }[]; shot: string | null }
type Live = { tab: number; appTab: string; by: string; task: string; summary: string; url: string; title: string; run: string | null; at: number | null
  step: Partial<Step> | null; paused: boolean; asking: string | null; shot: string | null }

const TIME = { hour: "numeric", minute: "2-digit", second: "2-digit" } as const
const DAY = { month: "short", day: "numeric" } as const
const time = (t: number) => dateText(t, TIME)
const said = (s: Partial<Step>) => {
  if (s.action === "form") return `Filled ${(s.fields ?? []).map((f) => `${f.name || f.ref}: ${f.value ?? ""}`).join(", ")}`
  const what = { open: "Opened", navigate: "Went to", click: "Clicked", dblclick: "Double-clicked", hover: "Pointed at", fill: "Filled", type: "Typed in",
    press: "Pressed", check: "Checked", uncheck: "Unchecked", select: "Picked", scroll: "Scrolled", upload: "Uploaded", evaluate: "Ran", run: "Ran a script",
    help: "Asked the user", pdf: "Saved as PDF" }[s.action ?? ""] ?? s.action ?? ""
  const on = s.name ? ` “${s.name}”` : ""
  const value = s.value && s.action !== "run" ? (s.action === "fill" || s.action === "type" || s.action === "select" ? `: ${s.value}` : ` ${s.value}`) : ""
  return `${what}${on}${value}`
}
const groupOf = (x: { by: string; task: string }) => [x.by || "An agent", x.task].filter(Boolean).join("/")

export function ReplaysView() {
  const { hidden } = usePane()
  const engine = webPages?.engine
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [live, setLive] = useState<Live[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const back = useCallback(() => setOpen(null), [])
  // Live: read every second while shown (each with a fresh picture of its page).
  useEffect(() => {
    if (hidden || open || !engine) return
    let stop = false
    const read = () => void Promise.resolve(engine("agents:live")).then((l) => { if (!stop) setLive(Array.isArray(l) ? (l as Live[]) : []) }, () => {})
    read()
    const timer = setInterval(() => { if (document.visibilityState === "visible") read() }, 1000)
    return () => { stop = true; clearInterval(timer) }
  }, [hidden, open, engine])
  // Past runs: again whenever a live one took a step.
  const stepped = live.map((l) => `${l.run}@${l.at}`).join(" ")
  useEffect(() => {
    if (hidden || open || !engine) return
    void Promise.resolve(engine("agents:runs")).then((r) => setRuns(Array.isArray(r) ? (r as Run[]) : []), () => setRuns([]))
  }, [hidden, open, engine, stepped])
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (runs ?? []).filter((r) => { const hay = [r.by, r.task, r.summary, r.title, r.url].join(" ").toLowerCase(); return words.every((w) => hay.includes(w)) })
  }, [runs, q])
  if (open) return <Replay run={open} live={live.some((l) => l.run === open)} back={back} />
  if (!engine) return <p className="mx-auto max-w-[720px] px-4 pt-6 text-[13px] text-tertiary">Agents use the browser in Vaultite's desktop app.</p>
  return (
    <div className="@container mx-auto max-w-[960px] px-4 pt-4 pb-10" data-web-replays>
      <h1 className="mb-1 text-[20px] font-semibold">Agents in the browser</h1>
      <p className="mb-4 text-[13px] text-muted-foreground">What agents are doing in web pages now, and what they did, step by step, kept on this Mac for two weeks.</p>
      {live.length > 0 && (
        <section className="mb-5" data-web-live-list>
          <SidebarHeading title="Now" open />
          <div className="grid grid-cols-1 gap-2 px-1.5 pt-1 @4xl:grid-cols-2">
            {live.map((l) => <LiveCard key={l.tab} live={l} replay={setOpen} />)}
          </div>
        </section>
      )}
      <SidebarHeading title="Runs" open />
      <div className="mb-2 px-1.5"><FilterField value={q} onChange={setQ} placeholder="Search by agent, task or summary" /></div>
      {runs && !shown.length ? <p className="px-1.5 pt-2 text-[13px] text-tertiary">{q ? `No run matches "${q}".` : "No agent has used the browser yet."}</p> : (
        <div className="flex flex-col gap-px" data-size-up>
          {shown.map((r) => (
            <SidebarRow key={r.run} icon={Bot} open data-web-replay={r.run} onClick={() => setOpen(r.run)}
              label={<span className="flex min-w-0 items-baseline gap-1.5"><span className="shrink-0 truncate">{groupOf(r)}</span>
                <span className="min-w-0 truncate text-[12px] text-muted-foreground">{r.summary || r.title || hostOf(r.url)}</span></span>}>
              <span className="mr-1 shrink-0 text-[11px] text-tertiary">{dateText(r.start, DAY)} · {r.steps} {r.steps === 1 ? "step" : "steps"}</span>
            </SidebarRow>
          ))}
        </div>
      )}
    </div>
  )
}

/** A tab an agent is at work in: its page as it is now, who, what for and its last step. */
function LiveCard({ live: l, replay }: { live: Live; replay: (run: string) => void }) {
  // (its container from the owner's list: the tab may be gone, made anew there)
  // (an agent's page in the background opens as a tab)
  const show = () => {
    if (!l.appTab) { const p = agentPage(l.tab); if (p) void openAsTab(p); return }
    if (!selectTab(l.appTab)) void get<{ tabs: LiveTab[] }>("web-viewer/tabs").then((r) => { const t = r.tabs.find((x) => x.tab === l.tab); if (t) showAppTab(t) }, (e) => notifyError(e, "Couldn't show the tab"))
  }
  const [paused, choose] = useChosen(!!l.paused)
  const pause = () => choose(!paused, () => Promise.resolve(webPages?.engine?.("agents:pause", l.tab, !paused)), paused ? "Couldn't resume it" : "Couldn't pause it")
  return (
    <div className="flex min-w-0 overflow-hidden rounded-[8px] border-[0.5px] border-border bg-card" data-web-live={l.tab}>
      <button type="button" onClick={show} aria-label={`Show ${l.title || hostOf(l.url)}`}
        className="relative block aspect-[16/10] w-[42%] max-w-[240px] shrink-0 cursor-pointer self-start overflow-hidden border-r-[0.5px] border-border bg-muted">
        {l.shot ? <img src={l.shot} alt="" className="size-full object-cover object-top" />
          : <Globe className="absolute top-1/2 left-1/2 size-7 -translate-1/2 text-tertiary" strokeWidth={1.5} />}
        {(paused || l.asking) && (
          <span className="absolute top-2 left-2 rounded-[6px] bg-background/90 px-1.5 py-0.5 text-[11px] font-medium">{paused ? "Paused" : "Needs you"}</span>
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 pt-2 pb-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
          <Bot className="size-3.5 shrink-0" strokeWidth={2} style={{ color: "var(--purple)" }} /><span className="truncate">{groupOf(l)}</span>
        </span>
        {l.summary && <span className="line-clamp-2 text-[12px] text-muted-foreground">{l.summary}</span>}
        <span className="truncate text-[12px] text-tertiary">{l.asking ?? (l.step && l.at ? `${said(l.step)} · ${time(l.at)}` : hostOf(l.url))}</span>
        <div className="mt-auto flex flex-wrap items-center gap-1 pt-1.5">
          <Button look="secondary" size="small" onClick={show}>{l.appTab ? "Show tab" : "Open as tab"}</Button>
          <Button look="quiet" size="small" onClick={pause} data-web-live-pause={paused ? "resume" : "pause"}>
            {paused ? <Play className="size-3.5" strokeWidth={2.25} /> : <Pause className="size-3.5" strokeWidth={2.25} />}{paused ? "Resume" : "Pause"}
          </Button>
          {l.run && <Button look="quiet" size="small" onClick={() => replay(l.run!)}>Steps</Button>}
        </div>
      </div>
    </div>
  )
}

function Replay({ run, live, back }: { run: string; live: boolean; back: () => void }) {
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [at, setAt] = useState(0)
  useEffect(() => {
    let stop = false, last = -1
    // (a live run's new steps come in; at its last step, the view follows them)
    const read = () => void Promise.resolve(webPages?.engine?.("agents:run", run)).then((r) => {
      if (stop) return
      const s = Array.isArray(r) ? (r as Step[]) : []
      setSteps(s)
      setAt((a) => (last < 0 || a === last ? Math.max(0, s.length - 1) : a))
      last = s.length - 1
    }, (e) => { if (!stop) { notifyError(e, "Couldn't read the run"); back() } })
    read()
    const timer = live ? setInterval(() => { if (document.visibilityState === "visible") read() }, 2000) : 0
    return () => { stop = true; clearInterval(timer) }
  }, [run, live, back])
  const s = steps?.[at]
  return (
    <div className="flex h-full min-h-0 flex-col" data-web-replay-steps={steps?.length ?? 0}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b-[0.5px] border-border px-2">
        <button type="button" onClick={back} className="flex h-7 cursor-pointer items-center gap-1 rounded-[6px] px-2 text-[13px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
          <ChevronLeft className="size-4" strokeWidth={2} />Runs
        </button>
        <span className="min-w-0 flex-1 truncate text-[13px]">{s ? `${s.by || "An agent"} · ${time(s.t)} · ${said(s)}` : ""}</span>
        <button type="button" aria-label="Previous step" disabled={!steps || at === 0} onClick={() => setAt(at - 1)}
          className="grid size-7 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] disabled:opacity-40"><ChevronLeft className="size-4" /></button>
        <span className="text-[12px] text-tertiary tabular-nums">{steps ? `${at + 1} of ${steps.length}` : ""}</span>
        <button type="button" aria-label="Next step" disabled={!steps || at >= steps.length - 1} onClick={() => setAt(at + 1)}
          className="grid size-7 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] disabled:opacity-40"><ChevronRight className="size-4" /></button>
      </div>
      <div className="flex min-h-0 flex-1">
        <ol className="w-[260px] shrink-0 overflow-y-auto border-r-[0.5px] border-border p-1.5">
          {(steps ?? []).map((x, i) => (
            <li key={`${x.t}-${i}`}>
              <button type="button" onClick={() => setAt(i)} className={cn("flex w-full cursor-pointer flex-col rounded-[6px] px-2 py-1 text-left", i === at ? "bg-foreground/[0.07]" : "hover:bg-foreground/[0.04]")}>
                <span className="truncate text-[13px]">{said(x)}</span>
                <span className="truncate text-[11px] text-tertiary">{time(x.t)} · {hostOf(x.url)}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="flex min-w-0 flex-1 flex-col items-center overflow-auto p-4">
          {s?.action === "run" && s.value && <pre className="mb-3 max-h-48 w-full overflow-auto rounded-[6px] bg-muted p-2 text-[12px]">{s.value}</pre>}
          {s?.shot ? <img src={s.shot} alt={said(s)} className="max-w-full rounded-[6px] shadow-sm ring-[0.5px] ring-border" />
            : s ? <div className="flex flex-col items-center pt-16 text-center text-[13px] text-tertiary"><Globe className="mb-3 size-8" strokeWidth={1.5} />No picture of this step.</div> : null}
          {s && <p className="mt-2 max-w-full truncate text-[12px] text-tertiary">{s.title} · {s.url}</p>}
        </div>
      </div>
    </div>
  )
}
