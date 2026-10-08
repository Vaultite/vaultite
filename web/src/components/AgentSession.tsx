// A coding agent's session read back in a tab, re-read every 10 s while shown so a running one keeps up; Resume in
// terminal when Terminal is on. `@<machine>` ids are another machine's.
import { useEffect, useState } from "react"
import { ChevronRight, CircleAlert, History, SquareTerminal, User } from "lucide-react"
import { Empty } from "@/components/kit"
import { Markdown } from "@/components/Markdown"
import type { AgentSource } from "@/components/AgentUsage"
import { openAgent } from "@/core/agents"
import { fmtDay, fmtTime, iso, numberText, today } from "@/core/data"
import { get } from "@/core/http"
import { machinePath, splitMachine } from "@/core/machines"
import { useEnabled } from "@/core/plugins"
import { cn } from "@/lib/utils"

export type Tool = { kind: "tool"; id: string; name: string; summary: string; input: string; result: string | null; error: boolean; at: string }
export type Said = { kind: "user" | "assistant"; text: string; at: string }
export type Entry = Said | Tool
export type Head = { title: string; cwd: string; model: string; first: string; last: string; branch: string }
export type SessionPage = Head & { id: string; project: string; start: number; total: number; entries: Entry[] }

const PAGE = 150
const EVERY = 10_000

function useSession(src: AgentSource, full: string, want: number) {
  const [data, setData] = useState<SessionPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let on = true
    const [id, machine] = splitMachine(full)
    const load = () => get<SessionPage>(machinePath(machine, `${src.path}/session/${encodeURIComponent(id)}?limit=${want}`))
      .then((d) => { if (on) { setData(d); setError(null) } }).catch((e) => on && setError(String(e)))
    load()
    const t = setInterval(() => { if (!document.hidden) load() }, EVERY)
    return () => { on = false; clearInterval(t) }
  }, [src.path, full, want])
  return { data, error }
}

/** "Tue 29 Sep, 10:04" (today: just the time). */
function when(at: string) {
  if (!at) return ""
  const day = iso(new Date(at))
  return day === today() ? fmtTime(at) : `${fmtDay(day)}, ${fmtTime(at)}`
}

const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~")

function ToolLine({ t }: { t: Tool }) {
  const [open, setOpen] = useState(false)
  return (
    <div data-tool={t.name}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="group flex h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-[5px] px-1 text-left text-[13px] hover:bg-foreground/[0.04]">
        <ChevronRight className={cn("size-3.5 shrink-0 text-tertiary transition-transform", open && "rotate-90")} strokeWidth={2.5} />
        <span className="shrink-0 font-medium text-muted-foreground">{t.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-tertiary">{t.summary}</span>
        {t.error && <CircleAlert className="size-3.5 shrink-0 text-[var(--red)]" strokeWidth={2.25} aria-label="Failed" />}
      </button>
      {open && (
        <div className="mb-2 ml-6 space-y-2">
          <pre className="max-h-72 overflow-auto rounded-[8px] bg-muted px-3 py-2 font-mono text-[12px] leading-[17px] whitespace-pre-wrap break-words">{t.input}</pre>
          {t.result !== null && (
            <pre className={cn("max-h-72 overflow-auto rounded-[8px] border-[0.5px] border-border px-3 py-2 font-mono text-[12px] leading-[17px] whitespace-pre-wrap break-words",
              t.error ? "text-[var(--red)]" : "text-muted-foreground")}>{t.result || "(no output)"}</pre>
          )}
        </div>
      )}
    </div>
  )
}

function Message({ src, e }: { src: AgentSource; e: Said }) {
  const you = e.kind === "user"
  const Icon = you ? User : src.icon
  return (
    <div className={cn("min-w-0", you && "rounded-[10px] bg-muted px-3 py-2.5")} data-entry={e.kind}>
      <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
        <Icon className="size-3.5 shrink-0" strokeWidth={2.25} style={you ? undefined : { color: src.tint }} />
        {you ? "You" : src.speaker ?? src.label}
        {e.at && <span className="font-normal text-tertiary">{fmtTime(e.at)}</span>}
      </div>
      <Markdown text={e.text} className="min-w-0 break-words" />
    </div>
  )
}

export function AgentSession({ src, id }: { src: AgentSource; id: string }) {
  const [want, setWant] = useState(PAGE)
  const { data, error } = useSession(src, id, want)
  const on = useEnabled()
  const machine = splitMachine(id)[1]
  if (!data) {
    const gone = machine ? "This session isn't on that machine any more, or it's private." : "This session isn't on this machine any more, or it's private."
    return <div className="pt-4">{error ? <Empty>{/404/.test(error) ? gone : /502/.test(error) ? "That machine isn't answering." : "Couldn't read this session."}</Empty> : <p className="text-[15px] text-muted-foreground">Loading…</p>}</div>
  }
  // Tool calls in a row are drawn together, tight; messages get room around them.
  const groups: { at: number; entries: Entry[] }[] = []
  data.entries.forEach((e, i) => {
    const last = groups[groups.length - 1]
    if (e.kind === "tool" && last?.entries[0].kind === "tool") last.entries.push(e)
    else groups.push({ at: data.start + i, entries: [e] })
  })
  return (
    <article className="pb-10" data-agent-session={data.id} data-claude-session={src.agent === "claude" ? data.id : undefined}>
      <header className="mb-6 pt-2">
        <div className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: src.tint }}>
          <src.icon className="size-4" />{src.label} session
        </div>
        <h1 className="text-[28px] leading-[34px] font-bold text-balance break-words max-md:hidden">{data.title || "Untitled session"}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          {data.project && <span>{data.project}</span>}
          {data.model && <span>{data.model}</span>}
          {data.first && <span>{when(data.first)}{data.last && data.last !== data.first ? ` to ${when(data.last)}` : ""}</span>}
          {data.branch && <span>{data.branch}</span>}
        </div>
        {data.cwd && <div className="mt-1 truncate font-mono text-[12px] text-tertiary" data-tip={data.cwd} data-tip-trunc>{home(data.cwd)}</div>}
        {on("terminal") && (
          <button type="button" data-resume onClick={() => openAgent(src.agent, { resume: data.id, machine })}
            data-tip={`Resumes it in ${home(data.cwd) || "the vault"}`}
            className="mt-4 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[7px] bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:opacity-90 active:opacity-80">
            <SquareTerminal className="size-4" strokeWidth={2} />Resume in terminal
          </button>
        )}
      </header>
      {data.start > 0 && (
        <button type="button" onClick={() => setWant(want + PAGE)}
          className="mb-4 flex h-8 cursor-pointer items-center gap-1.5 rounded-[7px] px-2 text-[13px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground">
          <History className="size-4" strokeWidth={2} />Show earlier ({numberText(data.start)} more)
        </button>
      )}
      {!data.entries.length ? <Empty>Nothing was said in this session.</Empty> : (
        <div className="space-y-4">
          {groups.map(({ at, entries: g }) => (g[0].kind === "tool"
            ? <div key={at} className="-mx-1">{(g as Tool[]).map((t, j) => <ToolLine key={t.id || j} t={t} />)}</div>
            : <Message key={at} src={src} e={g[0] as Said} />))}
        </div>
      )}
    </article>
  )
}
