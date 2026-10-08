// What Hermes keeps about itself and the user (GET /api/hermes/memory) and its scheduled jobs (GET /api/hermes/cron),
// read only; another machine's through Machines (`machine:`), a profile's with `account:`.
import { Brain, CalendarClock } from "lucide-react"
import { type BlockCtx, dateText, Empty, fmtAgo, fmtTime, List, Loading, machinePath, Markdown, Panel, Row, Section, useLive, useMachines } from "@vaultite"

export type Memory = { account: string; soul: string | null; memory: string[] | null; user: string[] | null }
export type Job = { id: string; name: string; prompt: string; schedule: string; enabled: boolean; next: string | null
  last: string | null; status: string | null; error: string | null }

const str = (v: unknown) => (typeof v === "string" ? v : "")

/** A block's route on its machine and home, and what to call that machine when it doesn't answer. */
function useHermes<T>(route: string, options: Record<string, unknown>) {
  const machine = str(options.machine), account = str(options.account)
  const machines = useMachines()
  const m = machine ? machines?.find((x) => x.id === machine) : null
  const there = m && !m.self ? machine : ""
  const { data, error } = useLive<T>(machinePath(there, `${route}${account ? `?account=${encodeURIComponent(account)}` : ""}`))
  return { data, error: data ? null : error, where: there ? ` on ${m?.label ?? machine}` : "" }
}

function Entries({ list, none }: { list: string[] | null; none: string }) {
  if (!list) return <Empty>{none}</Empty>
  if (!list.length) return <Empty>Empty.</Empty>
  return <List>{list.map((e, i) => <Row key={i} wrap title={<span className="whitespace-pre-wrap">{e}</span>} />)}</List>
}

/** ```block-hermes-memory: its SOUL.md, then each entry of MEMORY.md (its notes) and USER.md (about the user). */
export function HermesMemory({ options = {} }: Partial<BlockCtx>) {
  const { data, error, where } = useHermes<Memory>("hermes/memory", options)
  return (
    <Panel title="Hermes memory" icon={Brain} tint="var(--purple)">
      {!data ? <Loading error={error && `Couldn't read Hermes' memory${where || " on this machine"}.`} /> : (
        <div className="space-y-4">
          <Section title="Its soul (SOUL.md)">
            {data.soul?.trim() ? <div className="text-[15px]"><Markdown text={data.soul} /></div> : <Empty>No SOUL.md.</Empty>}
          </Section>
          <Section title="What it noted (MEMORY.md)"><Entries list={data.memory} none="No MEMORY.md." /></Section>
          <Section title="What it knows about you (USER.md)"><Entries list={data.user} none="No USER.md." /></Section>
        </div>
      )}
    </Panel>
  )
}

const when = (s: string) => (Number.isNaN(Date.parse(s)) ? s : `${dateText(new Date(s), { weekday: "short", day: "numeric", month: "short" })} ${fmtTime(s)}`)

/** ```block-hermes-cron: each scheduled job, its schedule, its next run and how its last one went. */
export function HermesCron({ options = {} }: Partial<BlockCtx>) {
  const { data, error, where } = useHermes<{ jobs: Job[] }>("hermes/cron", options)
  return (
    <Panel title="Hermes scheduled jobs" icon={CalendarClock} tint="var(--purple)">
      {!data ? <Loading error={error && `Couldn't read Hermes' jobs${where || " on this machine"}.`} /> : !data.jobs.length ? <Empty>No scheduled jobs.</Empty> : (
        <List>
          {data.jobs.map((j) => {
            const bad = !!j.status && j.status !== "ok"
            return (
              <Row key={j.id || j.name} data-job={j.id} wrap title={<span className="font-semibold">{j.name}</span>}
                lead={<span className="size-2 shrink-0 rounded-full" style={{ background: !j.enabled ? "var(--gray)" : bad ? "var(--red)" : "var(--green)" }}
                  data-tip={!j.enabled ? "Paused" : bad ? `Last run: ${j.status}` : "On"} />}
                meta={[j.schedule, !j.enabled ? "paused" : j.next && `next ${when(j.next)}`,
                  j.last ? `last ran ${Number.isNaN(Date.parse(j.last)) ? j.last : fmtAgo(j.last)}${j.status ? ` (${j.status})` : ""}` : "never ran",
                  j.error].filter(Boolean).join(" · ")} />
            )
          })}
        </List>
      )}
    </Panel>
  )
}
