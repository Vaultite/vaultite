// An OpenClaw agent's memory (its workspace's files, GET /api/openclaw/memory) and the scheduled jobs (GET
// /api/openclaw/cron), read only; `machine:` another machine's, `account:` another agent's.
import { Brain, CalendarClock } from "lucide-react"
import { type BlockCtx, Empty, fmtAgo, fmtMin, List, Loading, machinePath, Markdown, Panel, Row, Section, useLive, useMachines } from "@vaultite"

type File = { name: string; text: string; modified: string | null }
export type Memory = { agent: string; dir: string; files: File[]; notes: (File & { date: string })[] }
export type Job = { id: string; name: string; description: string; enabled: boolean; agent: string; schedule: string; task: string
  next: string | null; last: string | null; status: string; error: string }

const str = (v: unknown) => (typeof v === "string" ? v : "")

/** Where a block reads from: another machine's API (`machine:`), one agent (`account:`), and how to say the machine. */
function useWhere(options: Record<string, unknown>) {
  const machine = str(options.machine), account = str(options.account)
  const m = useMachines()?.find((x) => x.id === machine)
  return { machine: m?.self ? "" : machine, account, on: machine && !m?.self ? ` on ${m?.label ?? machine}` : "" }
}

/** ```block-openclaw-memory: an agent's identity, soul, user and memory files and its latest daily notes. */
export function MemoryBlock({ options = {} }: Partial<BlockCtx>) {
  const { machine, account, on } = useWhere(options)
  const notes = typeof options.notes === "number" ? options.notes : 2
  const { data, error } = useLive<Memory>(machinePath(machine, `openclaw/memory?notes=${notes}${account ? `&account=${encodeURIComponent(account)}` : ""}`))
  const title = `OpenClaw memory${data && data.agent !== "main" ? `, ${data.agent}` : ""}`
  return (
    <Panel title={title} icon={Brain} tint="var(--red)">
      {!data ? <Loading error={error && `Couldn't read OpenClaw${on}.`} /> : !data.files.length && !data.notes.length
        ? <Empty>Nothing in its workspace yet.</Empty> : (
        <div className="space-y-4">
          {[...data.files.map((f) => ({ ...f, label: f.name })), ...data.notes.map((n) => ({ ...n, label: `Daily note, ${n.date}` }))].map((f) => (
            <Section key={f.label} title={<>{f.label}{f.modified && <span className="font-normal"> · {fmtAgo(f.modified)}</span>}</>}>
              <div className="max-h-80 overflow-y-auto text-[15px]" data-memory={f.name}><Markdown text={f.text} /></div>
            </Section>
          ))}
        </div>
      )}
    </Panel>
  )
}

/** "in 3h", or "due now", for a job's next run. */
const until = (s: string) => {
  const m = (new Date(s).getTime() - Date.now()) / 60000
  return m <= 0 ? "due now" : `in ${m < 48 * 60 ? fmtMin(Math.round(m)) : `${Math.round(m / 1440)} days`}`
}

/** ```block-openclaw-cron: the scheduled jobs, each with when it runs, its last run and the next. */
export function CronBlock({ options = {} }: Partial<BlockCtx>) {
  const { machine, account, on } = useWhere(options)
  const { data, error } = useLive<Job[]>(machinePath(machine, `openclaw/cron${account ? `?account=${encodeURIComponent(account)}` : ""}`))
  return (
    <Panel title="OpenClaw scheduled jobs" icon={CalendarClock} tint="var(--red)">
      {!data ? <Loading error={error && `Couldn't read OpenClaw${on}.`} /> : !data.length ? <Empty>No scheduled jobs.</Empty> : (
        <List>
          {data.map((j) => (
            <Row key={j.id} data-job={j.id}
              lead={<span className="size-2 shrink-0 rounded-full" data-tip={j.status === "error" ? j.error || "Its last run failed" : j.enabled ? "On" : "Off"}
                style={{ background: !j.enabled ? "var(--gray)" : j.status === "error" ? "var(--red)" : j.status === "running" ? "var(--blue)" : "var(--green)" }} />}
              title={<span className="font-semibold">{j.name}</span>}
              meta={[j.schedule, !j.enabled && "off", j.status === "running" ? "running now" : j.last && `last ${fmtAgo(j.last)}`,
                j.next && `next ${until(j.next)}`, j.task].filter(Boolean).join(" · ")} />
          ))}
        </List>
      )}
    </Panel>
  )
}
