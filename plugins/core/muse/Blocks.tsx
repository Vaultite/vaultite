// A Muse agent's blocks, live from GET /api/muse...: on an agent machine (`machine:`) this server reads it through
// Machines; on another Vaultite server, that server reads its own. Files open in Machines' file view when it can.
import { type ReactNode, useState } from "react"
import { Brain, CalendarClock, ChevronRight, FolderOpen, MessagesSquare, Moon, Newspaper } from "lucide-react"
import { Bar, type BlockCtx, Empty, fmtAgo, List, Loading, LoadingRows, machinePath, Markdown, openView, Panel, Row, Section, Segmented, Stat, useKeptCount, useLive, useMachines, useTick } from "@vaultite"
import { MuseIcon } from "./marks"

const TINT = "var(--blue)"
type Persona = { name: string; text: string; modified: string; unfilled: string[] }
export type Overview = { machine: string; label: string; home: string; name: string; files: Persona[]
  connectors: { name: string; status: string }[]; jobs: { id: string; enabled: boolean; archived: boolean; mode: string; schedule: string; task: string; by: string }[]
  objectives: { id: string; outcome: string; at: string }[]; counts: { runs: number; dreams: number; notes: number } }
export type Run = { id: string; kind: string; title: string; first: string; last: string; items: number; tools: number; model: string; tokens: number }
type Fact = { kind: string; confidence: string; text: string; quote: string; at: string }
export type Memory = { facts: string[]; modified: string; days: { date: string; modified: string; facts: Fact[]; notes: string[] }[]
  bank: { name: string; items: string[]; modified: string }[]; people: number; notes: number }
export type Dreams = { dreams: { date: string; text: string; modified: string; path: string }[]; total: number; synthesis: { text: string; modified: string } | null }
export type Feed = { stories: { title: string; text: string; links: { url: string; note: string }[]; beat: string; date: string; part: string; path: string }[]; slots: number }

const str = (v: unknown) => (typeof v === "string" ? v : "")

/** A block's data: this server's route (with `machine` for an agent machine), or another Vaultite server's; asked again
 *  every five minutes while shown. */
function useMuse<T>(route: string, options: Record<string, unknown>, params: Record<string, unknown> = {}) {
  const machine = str(options.machine)
  const machines = useMachines()
  const m = machine ? machines?.find((x) => x.id === machine) : null
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
  const elsewhere = !!m && !m.dial && !m.self
  if (machine && !elsewhere) q.set("machine", machine)
  const path = `${route}${q.size ? `?${q}` : ""}`
  const tick = useTick(300_000)
  const { data, error } = useLive<T>(machine && !machines ? null : elsewhere ? machinePath(machine, path) : path, tick)
  return { data, error: data ? null : error, files: m?.dial ? m.id : "" }
}

/** Why a block has nothing to show, in words. */
const why = (error: string | null, what: string) =>
  !error ? null : /404/.test(error) ? "No Muse agent found. Connect its machine in Machines, or set the block's machine." : /502/.test(error)
    ? "Its machine isn't connected right now." : /403/.test(error) ? `Only this machine's owner can read ${what}.` : `Couldn't read ${what}.`

/** Open a file of an agent machine in Machines' file view (`<id>|<folder>|<file>`). */
const openFile = (machine: string, file: string) => openView(`machine-files/${machine}|${file.slice(0, file.lastIndexOf("/")) || "/"}|${file}`, { newTab: true })

function Fold({ title, meta, children, open: initial = false }: { title: ReactNode; meta?: ReactNode; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial)
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex min-h-11 w-full cursor-pointer items-center gap-1.5 text-left text-[15px] hover:text-foreground">
        <ChevronRight className={`size-4 shrink-0 text-tertiary transition-transform ${open ? "rotate-90" : ""}`} strokeWidth={2.5} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {meta && <span className="shrink-0 text-[13px] text-muted-foreground">{meta}</span>}
      </button>
      {open && <div className="pb-3 pl-5.5">{children}</div>}
    </div>
  )
}

/** Folds on their way: Fold's row with a bar for its title. */
function FoldSkeleton({ count }: { count: number }) {
  return (
    <div className="loading-in hairline" aria-busy>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex min-h-11 items-center gap-1.5 text-[15px]">
          <span className="size-4 shrink-0" />
          <span className="min-w-0 flex-1"><Bar w={i % 2 ? "35%" : "45%"} /></span>
        </div>
      ))}
    </div>
  )
}

const dot = <span className="size-2 shrink-0" />
/** As many skeleton rows as last time, or the Loading line when there were none. */
const rows = (n: number, lead?: boolean, meta = true) => (n ? <LoadingRows count={n} lead={lead && dot} meta={meta} /> : <Loading />)

const when = (s: string) => (s && !Number.isNaN(Date.parse(s)) ? fmtAgo(s) : "")

/** ```block-muse: who it is, how much it has done, and what's left to tell it. */
export function MuseBlock({ options = {} }: Partial<BlockCtx>) {
  const { data, error, files } = useMuse<Overview>("muse", options)
  const todo = data?.files.filter((f) => f.unfilled.length) ?? []
  const persona = useKeptCount(`muse:${str(options.machine)}:files`, data?.files.length)
  return (
    <Panel title={data?.name ?? "Muse"} icon={MuseIcon} tint={TINT}
      action={files && <button type="button" onClick={() => openView(`machine-files/${files}`, { newTab: true })} data-tip="Browse its files"
        className="flex size-8 cursor-pointer items-center justify-center rounded-[7px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"><FolderOpen className="size-4" /></button>}>
      {error ? <Loading error={why(error, "this agent")} /> : !data ? (
        <div className="loading-in space-y-4" aria-busy>
          <p className="text-[13px]"><Bar w="45%" /></p>
          <div className="grid grid-cols-2 gap-4 @md:grid-cols-4">
            {["Runs", "Dreams", "Daily notes", "Connectors"].map((l) => <Stat key={l} label={l} value={<Bar w="1.4em" />} />)}
          </div>
          <Section title="Who it is">{persona ? <FoldSkeleton count={persona} /> : <Loading />}</Section>
        </div>
      ) : (
        <div className="space-y-4" data-muse={data.machine || "here"}>
          <p className="text-[13px] text-muted-foreground">Muse agent{data.label ? ` on ${data.label}` : ""} · <span className="font-mono">{data.home}</span></p>
          <div className="grid grid-cols-2 gap-4 @md:grid-cols-4">
            <Stat label="Runs" value={data.counts.runs} />
            <Stat label="Dreams" value={data.counts.dreams} />
            <Stat label="Daily notes" value={data.counts.notes} />
            <Stat label="Connectors" value={data.connectors.filter((c) => c.status === "connected").length} hint={`of ${data.connectors.length}`} />
          </div>
          {todo.length > 0 && (
            <Section title="Left to tell it">
              <List>{todo.map((f) => (
                <Row key={f.name} title={f.name} meta={f.unfilled.join(", ")} wrap data-unfilled={f.name}
                  onOpen={files ? () => openFile(files, `${data.home}/${f.name}`) : undefined} />
              ))}</List>
            </Section>
          )}
          <Section title="Who it is">
            <div className="hairline">{data.files.map((f) => (
              <Fold key={f.name} title={f.name} meta={when(f.modified)}>
                <div className="max-h-96 overflow-y-auto text-[15px]"><Markdown text={f.text} /></div>
              </Fold>
            ))}</div>
          </Section>
        </div>
      )}
    </Panel>
  )
}

const KIND_TINT: Record<string, string> = { Conversation: "var(--blue)", Feed: "var(--teal)", Proactive: "var(--green)", "Self-improvement": "var(--purple)",
  Scheduled: "var(--orange)", Onboarding: "var(--pink)" }

/** ```block-muse-runs: its latest runs, each opening its conversation. */
export function MuseRuns({ options = {} }: Partial<BlockCtx>) {
  const recent = typeof options.recent === "number" ? options.recent : 10
  const { data, error } = useMuse<{ total: number; runs: Run[] }>("muse/runs", options, { limit: recent })
  const [kind, setKind] = useState("all")
  const kinds = [...new Set(data?.runs.map((r) => r.kind) ?? [])]
  const shown = data?.runs.filter((r) => kind === "all" || r.kind === kind) ?? []
  const machine = str(options.machine)
  const kept = useKeptCount(`muse:${machine}:runs`, data?.runs.length)
  return (
    <Panel title="Runs" icon={MessagesSquare} tint={TINT}>
      {!data ? (error ? <Loading error={why(error, "its runs")} /> : rows(kept, true)) : !data.runs.length ? <Empty>No runs yet.</Empty> : (
        <div className="space-y-2">
          {kinds.length > 1 && <Segmented label="Kind of run" value={kinds.includes(kind) ? kind : "all"} onChange={setKind} className="overflow-x-auto"
            options={[{ value: "all", label: "All" }, ...kinds.map((k) => ({ value: k, label: k }))]} />}
          <List>{shown.map((r) => (
            <Row key={r.id} data-run={r.id} title={r.title} onOpen={() => openView(`muse-session/${machine ? `${machine}:` : ""}${r.id}`)}
              lead={<span className="size-2 shrink-0 rounded-full" style={{ background: KIND_TINT[r.kind] ?? "var(--gray)" }} data-tip={r.kind} />}
              meta={[r.kind, when(r.last || r.first), r.tools ? `${r.tools} tool call${r.tools === 1 ? "" : "s"}` : "", r.tokens ? `${Math.round(r.tokens / 1000)}k tokens` : ""].filter(Boolean).join(" · ")} />
          ))}</List>
          {data.total > data.runs.length && <p className="text-[13px] text-muted-foreground">The latest {data.runs.length} of {data.total} runs.</p>}
        </div>
      )}
    </Panel>
  )
}

const SURE: Record<string, string> = { high: "var(--green)", medium: "var(--orange)", low: "var(--gray)" }

/** ```block-muse-memory: what it knows, what it learned lately, and its memory bank. */
export function MuseMemory({ options = {} }: Partial<BlockCtx>) {
  const notes = typeof options.notes === "number" ? options.notes : 3
  const { data, error } = useMuse<Memory>("muse/memory", options, { notes })
  const facts = useKeptCount(`muse:${str(options.machine)}:facts`, data?.facts.length)
  return (
    <Panel title="What it knows" icon={Brain} tint={TINT}>
      {error ? <Loading error={why(error, "its memory")} /> : !data ? <Section title="Long-term memory">{rows(facts, false, false)}</Section> : (
        <div className="space-y-4">
          <Section title={<>Long-term memory{data.modified && <span className="font-normal"> · {when(data.modified)}</span>}</>}>
            {data.facts.length ? <List>{data.facts.map((f, i) => <Row key={i} wrap title={<span className="whitespace-pre-wrap">{f}</span>} />)}</List> : <Empty>Nothing yet.</Empty>}
          </Section>
          {data.days.map((d) => (
            <Section key={d.date} title={`Learned on ${d.date}`}>
              {!d.facts.length && !d.notes.length ? <Empty>Nothing noted.</Empty> : (
                <List>
                  {d.facts.map((f, i) => (
                    <Row key={`f${i}`} wrap data-fact={f.confidence} title={<span className="whitespace-pre-wrap">{f.text}</span>}
                      lead={<span className="size-2 shrink-0 rounded-full" style={{ background: SURE[f.confidence] ?? "var(--gray)" }} data-tip={`${f.kind}, ${f.confidence} confidence`} />}
                      meta={f.quote ? `From: "${f.quote}"` : undefined} />
                  ))}
                  {d.notes.map((n, i) => <Row key={`n${i}`} wrap title={<span className="text-muted-foreground">{n}</span>} />)}
                </List>
              )}
            </Section>
          ))}
          {(data.bank.some((b) => b.items.length) || data.people > 0) && (
            <Section title="Memory bank">
              <div className="hairline">
                {data.bank.filter((b) => b.items.length).map((b) => (
                  <Fold key={b.name} title={b.name.replace(/^./, (c) => c.toUpperCase())} meta={`${b.items.length}`}>
                    <ul className="list-disc space-y-1 pl-4 text-[14px]">{b.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </Fold>
                ))}
                {data.people > 0 && <Row title="People" right={data.people} />}
              </div>
            </Section>
          )}
        </div>
      )}
    </Panel>
  )
}

/** ```block-muse-dreams: its latest dream, the ones before folded, and what it understands of you. */
export function MuseDreams({ options = {} }: Partial<BlockCtx>) {
  const n = typeof options.dreams === "number" ? options.dreams : 2
  const { data, error, files } = useMuse<Dreams>("muse/dreams", options, { dreams: n })
  const [first, ...rest] = data?.dreams ?? []
  return (
    <Panel title="Dreams" icon={Moon} tint={TINT}>
      {!data ? <Loading error={why(error, "its dreams")} /> : (
        <div className="space-y-4">
          {!first ? <Empty>No dreams yet: it dreams at night, about what happened that day.</Empty> : (
            <div data-dream={first.date}>
              <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
                <span className="flex-1">{first.date}</span>
                {files && <button type="button" className="cursor-pointer font-normal hover:text-foreground" onClick={() => openFile(files, first.path)}>Open file</button>}
              </div>
              <div className="text-[15px] leading-[22px]"><Markdown text={first.text} /></div>
            </div>
          )}
          {rest.length > 0 && <div className="hairline">{rest.map((d) => (
            <Fold key={d.date} title={d.date}><div className="text-[15px] leading-[22px]"><Markdown text={d.text} /></div></Fold>
          ))}</div>}
          {data.total > data.dreams.length && <p className="text-[13px] text-muted-foreground">{data.total} dreams in all.</p>}
          {data.synthesis && (
            <div className="hairline"><Fold title="What it understands of you" meta={when(data.synthesis.modified)}>
              <div className="text-[15px]"><Markdown text={data.synthesis.text} /></div>
            </Fold></div>
          )}
        </div>
      )}
    </Panel>
  )
}

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return u } }

/** ```block-muse-feed: the stories of the feed it writes for you. */
export function MuseFeed({ options = {} }: Partial<BlockCtx>) {
  const n = typeof options.stories === "number" ? options.stories : 6
  const { data, error } = useMuse<Feed>("muse/feed", options, { stories: n })
  const stories = useKeptCount(`muse:${str(options.machine)}:feed`, data?.stories.length, 3, 6)
  return (
    <Panel title="Feed" icon={Newspaper} tint={TINT}>
      {!data ? (error || !stories ? <Loading error={why(error, "its feed")} /> : (
        <div className="loading-in space-y-5" aria-busy>
          {Array.from({ length: stories }, (_, i) => (
            <div key={i}>
              <div className="text-[12px]"><Bar w="10em" /></div>
              <div className="mt-0.5 text-[17px] leading-[22px]"><Bar w={i % 2 ? "55%" : "70%"} /></div>
              <div className="mt-1 text-[15px] leading-[21px]"><Bar w="90%" /><br /><Bar w="60%" /></div>
            </div>
          ))}
        </div>
      )) : !data.stories.length ? <Empty>Nothing in its feed yet.</Empty> : (
        <div className="space-y-5">
          {data.stories.map((s, i) => (
            <article key={i} data-story={s.date} className="min-w-0">
              <div className="text-[12px] font-semibold tracking-wide text-muted-foreground">{s.date} · {s.part} · {s.beat}</div>
              <h3 className="mt-0.5 text-[17px] leading-[22px] font-semibold text-balance">
                {s.links[0] ? <a href={s.links[0].url} target="_blank" rel="noreferrer" className="hover:underline">{s.title}</a> : s.title}
              </h3>
              {s.text && <div className="mt-1 text-[15px] leading-[21px] text-muted-foreground"><Markdown text={s.text} /></div>}
              {s.links.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">{s.links.map((l) => (
                  <a key={l.url} href={l.url} target="_blank" rel="noreferrer" data-tip={l.note || l.url}
                    className="inline-flex h-7 max-w-full items-center truncate rounded-full bg-muted px-2.5 text-[12px] text-muted-foreground hover:text-foreground">{host(l.url)}</a>
                ))}</div>
              )}
            </article>
          ))}
        </div>
      )}
    </Panel>
  )
}

/** ```block-muse-setup: its scheduled jobs, connectors and self-improvement objectives. */
export function MuseSetup({ options = {} }: Partial<BlockCtx>) {
  const { data, error } = useMuse<Overview>("muse", options)
  const on = data?.connectors.filter((c) => c.status === "connected") ?? []
  const off = data?.connectors.filter((c) => c.status !== "connected") ?? []
  const jobs = useKeptCount(`muse:${str(options.machine)}:jobs`, data?.jobs.length)
  return (
    <Panel title="Setup" icon={CalendarClock} tint={TINT}>
      {error ? <Loading error={why(error, "how it's set up")} /> : !data ? (
        <div className="space-y-4">
          <Section title="Scheduled jobs">{rows(jobs, true)}</Section>
          <Section title="Connectors">
            <div className="loading-in flex flex-wrap gap-1.5 py-1" aria-busy>
              {["6em", "8em", "5em"].map((w) => <span key={w} className="skeleton h-7 rounded-full" style={{ width: w }} />)}
            </div>
          </Section>
        </div>
      ) : (
        <div className="space-y-4">
          <Section title="Scheduled jobs">
            {!data.jobs.length ? <Empty>No scheduled jobs.</Empty> : <List>{data.jobs.map((j) => (
              <Row key={`${j.id}${j.archived}`} data-job={j.id} wrap title={j.id.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase())}
                lead={<span className="size-2 shrink-0 rounded-full" style={{ background: j.enabled ? "var(--green)" : "var(--gray)" }} data-tip={j.archived ? "Archived" : j.enabled ? "On" : "Off"} />}
                meta={[j.schedule, j.archived && "archived", j.by === "system" && "built in", j.task].filter(Boolean).join(" · ")} />
            ))}</List>}
          </Section>
          <Section title="Connectors">
            {!data.connectors.length ? <Empty>None.</Empty> : (
              <>
                <div className="flex flex-wrap gap-1.5 py-1">{on.length ? on.map((c) => (
                  <span key={c.name} className="inline-flex h-7 items-center rounded-full bg-[color-mix(in_oklab,var(--green)_16%,transparent)] px-2.5 text-[13px]">{c.name.replace(/_/g, " ")}</span>
                )) : <span className="text-[14px] text-muted-foreground">None connected.</span>}</div>
                {off.length > 0 && <div className="hairline"><Fold title={`${off.length} more available`}>
                  <p className="text-[14px] text-muted-foreground">{off.map((c) => c.name.replace(/_/g, " ")).join(", ")}</p>
                </Fold></div>}
              </>
            )}
          </Section>
          {data.objectives.length > 0 && (
            <Section title="What it's working on">
              <List>{data.objectives.map((o) => (
                <Row key={o.id} title={o.id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())} right={o.outcome || "not run"} meta={o.at ? `Last run ${when(o.at)}` : undefined} />
              ))}</List>
            </Section>
          )}
        </div>
      )}
    </Panel>
  )
}

