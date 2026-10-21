// Agents' runs in the browser, to replay: each agent's steps (opened, clicked, typed...) with the page as it was after
// each, kept on this Mac a fortnight (electron/browser/agent.ts).
import { useEffect, useState } from "react"
import { Bot, ChevronLeft, ChevronRight, Globe } from "lucide-react"
import { cn, dateText, notifyError, SidebarRow, webPages } from "@vaultite"
import { hostOf } from "./address"

type Run = { run: string; by: string; steps: number; start: number; end: number; title: string; url: string }
type Step = { t: number; tab: number; by: string; url: string; title: string; action: string; ref?: string; name?: string; value?: string; shot: string | null }

const TIME = { hour: "numeric", minute: "2-digit", second: "2-digit" } as const
const DAY = { month: "short", day: "numeric" } as const
const time = (t: number) => dateText(t, TIME)
const said = (s: Step) => {
  const what = { open: "Opened", navigate: "Went to", click: "Clicked", dblclick: "Double-clicked", hover: "Pointed at", fill: "Filled", type: "Typed in",
    press: "Pressed", check: "Checked", uncheck: "Unchecked", select: "Picked", scroll: "Scrolled" }[s.action] ?? s.action
  const on = s.name ? ` “${s.name}”` : ""
  const value = s.value ? (s.action === "fill" || s.action === "type" || s.action === "select" ? `: ${s.value}` : ` ${s.value}`) : ""
  return `${what}${on}${value}`
}

export function ReplaysView() {
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    void Promise.resolve(webPages?.engine?.("agents:runs")).then((r) => setRuns(Array.isArray(r) ? (r as Run[]) : []), () => setRuns([]))
  }, [])
  if (open) return <Replay run={open} back={() => setOpen(null)} />
  return (
    <div className="mx-auto max-w-[640px] px-4 pt-4 pb-10" data-web-replays>
      <h1 className="mb-1 text-[20px] font-semibold">Agents in the browser</h1>
      <p className="mb-4 text-[13px] text-muted-foreground">What agents did in web pages, step by step, kept on this Mac for two weeks.</p>
      {!webPages?.engine ? <p className="text-[13px] text-tertiary">Agents use the browser in Vaultite's desktop app.</p>
        : runs && !runs.length ? <p className="text-[13px] text-tertiary">No agent has used the browser yet.</p>
        : (
          <div className="flex flex-col gap-px">
            {(runs ?? []).map((r) => (
              <SidebarRow key={r.run} icon={Bot} label={<span className="flex min-w-0 items-baseline gap-1.5"><span className="truncate">{r.by || "An agent"}</span>
                <span className="min-w-0 truncate text-[12px] text-muted-foreground">{r.title || hostOf(r.url)}</span></span>} open
                data-web-replay={r.run} onClick={() => setOpen(r.run)}>
                <span className="mr-1 shrink-0 text-[11px] text-tertiary">{dateText(r.start, DAY)} · {r.steps} {r.steps === 1 ? "step" : "steps"}</span>
              </SidebarRow>
            ))}
          </div>
        )}
    </div>
  )
}

function Replay({ run, back }: { run: string; back: () => void }) {
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [at, setAt] = useState(0)
  useEffect(() => {
    void Promise.resolve(webPages?.engine?.("agents:run", run)).then((r) => { const s = Array.isArray(r) ? (r as Step[]) : []; setSteps(s); setAt(Math.max(0, s.length - 1)) },
      (e) => { notifyError(e, "Couldn't read the run"); back() })
  }, [run, back])
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
            <li key={x.t}>
              <button type="button" onClick={() => setAt(i)} className={cn("flex w-full cursor-pointer flex-col rounded-[6px] px-2 py-1 text-left", i === at ? "bg-foreground/[0.07]" : "hover:bg-foreground/[0.04]")}>
                <span className="truncate text-[13px]">{said(x)}</span>
                <span className="truncate text-[11px] text-tertiary">{time(x.t)} · {hostOf(x.url)}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="flex min-w-0 flex-1 flex-col items-center overflow-auto p-4">
          {s?.shot ? <img src={s.shot} alt={said(s)} className="max-w-full rounded-[6px] shadow-sm ring-[0.5px] ring-border" />
            : s ? <div className="flex flex-col items-center pt-16 text-center text-[13px] text-tertiary"><Globe className="mb-3 size-8" strokeWidth={1.5} />No picture of this step: the tab wasn't on screen.</div> : null}
          {s && <p className="mt-2 max-w-full truncate text-[12px] text-tertiary">{s.title} · {s.url}</p>}
        </div>
      </div>
    </div>
  )
}
