// The Companion page's blocks (pages/Companion.md): its talk a day at a time (asks, answers, jobs, a press's Details;
// compact in the Conversations panel) and what its services used. Data: companion conversation, usage, press-media.
import { useEffect, useState, useSyncExternalStore } from "react"
import { AudioLines, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, CircleDashed, CircleDot, CirclePause, CircleStop, ExternalLink, Image, Mic } from "lucide-react"
import { addDays, Button, cn, Empty, HeadingButton, fmtLongDay, fmtStamp, Loading, notifyError, op, openTab, Panel, today, useTick } from "@vaultite"
import type { Exchange, PressLine, Spent } from "./conversation"
import { getState, subscribe } from "./live"
import { Arrow } from "./Overlay"

/** jobs.ts' JobCard, `at` its start (companion conversation). */
export type JobCard = { id: string; title: string; state: string; link: string | null; at: number; result?: string; where?: string; now?: string; ended?: number }
export type Day = { day: string; exchanges: Exchange[]; spent: Spent[]; jobs: JobCard[] }
type UsageRow = { service: string; today: Spent; week: Spent; left?: { used: number; limit: number; resets?: number; unit: string }; billing?: string }

/** How often a shown page asks again (ms): new asks come as they're made. */
const EVERY = 5000
/** An op's answer, asked again every `every` ms while the window is seen, when the companion's state moves, and at
 *  `again()` (an ask just sent). */
export function useOp<T>(id: string, params: Record<string, unknown>, every = EVERY) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState<unknown>(null)
  const [asked, setAsked] = useState(0)
  const key = JSON.stringify(params)
  // (its live state: a new say or ask moves this)
  const said = useSyncExternalStore(subscribe, () => getState().said.length)
  useEffect(() => {
    let on = true
    const ask = () => { if (document.visibilityState === "visible") op<T>(id, params).then((d) => { if (on) { setData(d); setError(null) } }, (e) => on && setError(e)) }
    ask()
    const t = setInterval(ask, every)
    return () => { on = false; clearInterval(t) }
  }, [id, key, said, every, asked])
  return { data, error, again: () => setAsked((n) => n + 1) }
}

/** A day's talk in order: its exchanges and the jobs started that day, oldest first. */
export function talkOf(d: Day | null, day: string) {
  const on = new Date(`${day}T12:00`).toDateString()
  return [...(d?.exchanges ?? []).map((e) => ({ t: e.t, e })), ...(d?.jobs ?? []).filter((j) => j.at && new Date(j.at).toDateString() === on).map((j) => ({ t: j.at, j }))]
    .sort((a, b) => a.t - b.t) as ({ t: number; e: Exchange; j?: undefined } | { t: number; j: JobCard; e?: undefined })[]
}

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
const secs = (s?: number) => (s === undefined ? "" : s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`)
const money = (d?: number) => (!d ? "" : d < 0.01 ? "under 1¢" : `$${d.toFixed(2)}`)
const SERVICE: Record<string, string> = { soniox: "Soniox", openai: "OpenAI realtime", elevenlabs: "ElevenLabs", apple: "This Mac's recognizer", mac: "This Mac's voice", parakeet: "Parakeet" }
const nameOf = (s: string) => SERVICE[s] ?? s.charAt(0).toUpperCase() + s.slice(1)

/** A job's state as a mark and a word, the same everywhere (jobs.ts' lifecycle). */
const STATES: Record<string, { icon: typeof CircleDot; tint: string; word: string }> = {
  starting: { icon: CircleDashed, tint: "var(--muted-foreground)", word: "Starting" },
  working: { icon: CircleDot, tint: "var(--blue)", word: "Working" },
  "needs you": { icon: CirclePause, tint: "var(--orange)", word: "Needs you" },
  "ready for review": { icon: CircleCheck, tint: "var(--purple)", word: "Ready for review" },
  done: { icon: CircleCheck, tint: "var(--green)", word: "Done" }, failed: { icon: CircleAlert, tint: "var(--red)", word: "Failed" },
  stopped: { icon: CircleStop, tint: "var(--muted-foreground)", word: "Stopped" },
}

/** ```block-companion-conversation: the day's asks and answers, jobs inline, oldest first. */
export function ConversationBlock() {
  const [day, setDay] = useState(today)
  const { data, error } = useOp<Day>("companion.conversation", { day })
  const name = useSyncExternalStore(subscribe, () => getState().name)
  const shown = data?.day === day ? data : null
  const isToday = day === today()
  const items = talkOf(shown, day).map((x) => (x.e ? <Turn key={`e${x.e.seq}-${x.e.t}`} e={x.e} name={name} /> : <Job key={`j${x.j.id}`} j={x.j} />))
  const nav = (
    <div className="flex items-center gap-0.5">
      <HeadingButton icon={ChevronLeft} label="Day before" onClick={() => setDay((d) => addDays(d, -1))} />
      {!isToday && <Button look="quiet" size="small" onClick={() => setDay(today())}>Today</Button>}
      <HeadingButton icon={ChevronRight} label="Day after" disabled={isToday} className="disabled:cursor-default disabled:opacity-40" onClick={() => setDay((d) => addDays(d, 1))} />
    </div>
  )
  return (
    <div data-companion-conversation className="min-w-0">
      <Panel title={isToday ? "Today" : fmtLongDay(day)} action={nav}>
        {!shown ? <Loading error={error ? "Couldn't read the companion's talk." : undefined} />
          : !items.length ? <Empty>{isToday ? `Nothing yet today. Hold ⌃⌥ anywhere and ask ${name}.` : "Nothing that day."}</Empty>
          : <div className="flex flex-col gap-4">{items}</div>}
      </Panel>
    </div>
  )
}

/** One exchange: their words on the right, its answer on the left, Details under it. `compact`: a sidebar's, at its
 *  sizes, where they asked cut to a line and no Details (the page has them). */
export function Turn({ e, name, tint = "var(--orange)", compact }: { e: Exchange; name: string; tint?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const did = e.did.filter((d) => d !== "pointed")
  // (its answer still to come: asked under 2 min ago, nothing said, done or done to it)
  const waiting = !e.said.length && !did.length && e.total === undefined && Date.now() - e.t < 120_000
  const words = compact ? "text-[13px] leading-[18px]" : "text-[15px] leading-[20px]", meta = compact ? "text-[11.5px] leading-[15px]" : "text-[12px]"
  return (
    <div className={cn("flex flex-col", compact ? "gap-1" : "gap-1.5")} data-companion-turn>
      <div className="flex flex-col items-end gap-0.5">
        <div className={cn("bg-foreground/[0.06] whitespace-pre-wrap select-text", words, compact ? "max-w-[88%] rounded-[12px] rounded-br-[4px] px-2.5 py-1.5" : "max-w-[85%] rounded-[14px] rounded-br-[4px] px-3 py-2")}>{e.text || (e.kind === "point" ? "Look at this" : "")}</div>
        <div className={cn("flex max-w-full min-w-0 items-center gap-1 text-muted-foreground", meta)} data-tip={fmtStamp(e.t)}>
          {e.voice && <Mic className="size-3 shrink-0" aria-label="Said" />}<span className={cn(compact && "truncate")}>{time(e.t)}{e.where ? ` · ${e.where}` : ""}</span>
        </div>
      </div>
      <div className={cn("flex gap-2", compact ? "max-w-[92%]" : "max-w-[85%]")}>
        <Arrow tint={tint} size={compact ? 14 : 16} className={cn("shrink-0", compact ? "mt-[2px]" : "mt-[3px]")} aria-label={name} />
        <div className="min-w-0 flex-1">
          {e.said.length ? <div className={cn("whitespace-pre-wrap select-text", words)}>{e.said.join("\n\n")}</div>
            : <div className={cn("text-muted-foreground", words, waiting && "animate-pulse")}>{did.length ? "" : waiting ? "Thinking…" : "No words kept for this answer."}</div>}
          <div className={cn("mt-0.5 flex flex-wrap items-center gap-x-1.5 text-muted-foreground", meta)}>
            {did.length > 0 && <span>{did.join(", ")}</span>}
            {!compact && e.word !== undefined && <span>{did.length ? "· " : ""}first word in {secs(e.word)}</span>}
            {!compact && (e.press || e.shot) && (
              <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="-mx-1 flex cursor-pointer items-center gap-0.5 rounded-[5px] px-1 hover:bg-foreground/[0.05] hover:text-foreground">
                Details<ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} strokeWidth={2.5} />
              </button>
            )}
          </div>
          {open && <Details e={e} />}
        </div>
      </div>
    </div>
  )
}

/** What a press logged, step by step, with its timings, cost, picture and audio. */
function Details({ e }: { e: Exchange }) {
  const [media, setMedia] = useState<{ wav: string | null; png: string | null } | null>(null)
  useEffect(() => {
    let on = true
    op<{ wav: string | null; png: string | null }>("companion.press-media", { ...(e.press ? { press: e.press.id } : {}), ...(e.shot ? { shot: e.shot } : {}) })
      .then((m) => on && setMedia(m), (err) => { if (on) { setMedia({ wav: null, png: null }); notifyError(err, "Couldn't read its press") } })
    return () => { on = false }
  }, [e.press?.id, e.shot])
  const steps = e.press?.steps ?? []
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-[10px] border border-border p-3" data-companion-details>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
        {e.word !== undefined && <><dt className="text-muted-foreground">First word</dt><dd className="tabular-nums">{secs(e.word)} after the ask</dd></>}
        {e.total !== undefined && <><dt className="text-muted-foreground">Done</dt><dd className="tabular-nums">{secs(e.total)} after the ask</dd></>}
        {e.press?.cost ? <><dt className="text-muted-foreground">Cost</dt><dd>{money(e.press.cost)}</dd></> : null}
      </dl>
      {steps.length > 0 && (
        <table className="w-full text-[12px] leading-[17px]">
          <tbody>{steps.map((s, i) => <tr key={i} className="align-top"><td className="w-14 pr-2 text-right text-muted-foreground tabular-nums">{((Number(s.ms) || 0) / 1000).toFixed(2)}</td><td className="pr-2 font-medium whitespace-nowrap">{s.ev}</td><td className="text-muted-foreground break-words select-text">{stepText(s)}</td></tr>)}</tbody>
        </table>
      )}
      {!media ? <Loading /> : (
        <div className="flex flex-col gap-2">
          {media.wav && <div className="flex items-center gap-2"><AudioLines className="size-4 text-muted-foreground" /><audio controls preload="none" src={`data:audio/wav;base64,${media.wav}`} className="h-8 w-full" /></div>}
          {media.png && <a href={`data:image/png;base64,${media.png}`} target="_blank" rel="noreferrer" aria-label="Its picture of the screen"><img src={`data:image/png;base64,${media.png}`} alt="The screen as they asked" className="max-h-64 rounded-[6px] border border-border object-contain" /></a>}
          {!media.wav && !media.png && <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground"><Image className="size-3.5" />No audio or picture kept.</span>}
        </div>
      )}
    </div>
  )
}
/** A step's fields as words: what it says beyond its name and time. */
const stepText = (s: PressLine) => Object.entries(s).filter(([k]) => !["t", "press", "kind", "ev", "ms"].includes(k)).map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ")

/** A job as a card in the talk: its state, where it runs, what it's doing, and its session a click away. */
export function Job({ j }: { j: JobCard }) {
  useTick(30_000)
  const st = STATES[j.state] ?? STATES.working, Icon = st.icon
  const long = Math.max(0, ((j.ended ?? Date.now()) - j.at) / 60_000)
  return (
    <div className="glass flex max-w-[85%] flex-col gap-1 rounded-[12px] border border-border px-3 py-2.5" data-companion-job={j.id} data-state={j.state}>
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0" style={{ color: st.tint }} strokeWidth={2.25} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{j.title || "A job"}</span>
        {j.link && <Button look="quiet" size="small" onClick={() => openTab(j.link!)}>Open</Button>}
      </div>
      <div className="text-[13px] text-muted-foreground">
        {st.word}{j.where ? ` · ${j.where}` : ""} · {long < 1 ? "under a minute" : `${Math.round(long)} min`}
      </div>
      {(j.now || j.result) && <div className="line-clamp-3 text-[13px] leading-[18px] select-text">{j.now && !/done|failed|stopped|review/.test(j.state) ? j.now : j.result}</div>}
    </div>
  )
}

/** A job as a row in a sidebar's talk: its state's mark, its title and state; a click opens its session. */
export function JobRow({ j }: { j: JobCard }) {
  const st = STATES[j.state] ?? STATES.working, Icon = st.icon
  const body = <>
    <Icon className="size-3.5 shrink-0" style={{ color: st.tint }} strokeWidth={2.25} />
    <span className="line-clamp-2 min-w-0 flex-1 leading-[17px] font-medium">{j.title || "A job"}</span>
    <span className="shrink-0 text-[11.5px] text-muted-foreground">{st.word}</span>
  </>
  const cls = "flex min-h-7 w-full items-center gap-1.5 rounded-[7px] border border-border/60 px-2 py-1 text-left text-[13px]"
  return j.link
    ? <button type="button" className={cn(cls, "cursor-pointer hover:border-border hover:bg-foreground/[0.03]")} onClick={() => openTab(j.link!)} data-companion-job={j.id} data-state={j.state}>{body}</button>
    : <div className={cls} data-companion-job={j.id} data-state={j.state}>{body}</div>
}

/** ```block-companion-usage: what each service the companion uses used today and this week, and what's left. */
export function UsageBlock() {
  const { data, error } = useOp<{ services: UsageRow[] }>("companion.usage", {}, 60_000)
  return (
    <div data-companion-usage className="min-w-0">
      <Panel title="Usage">
        {!data ? <Loading error={error ? "Couldn't count what it used." : undefined} />
          : !data.services.length ? <Empty>Nothing used this week.</Empty>
          : <div className="hairline">{data.services.map((s) => <Service key={s.service} s={s} />)}</div>}
      </Panel>
    </div>
  )
}
function Service({ s }: { s: UsageRow }) {
  const left = s.left ? Math.max(0, s.left.limit - s.left.used) : null, low = s.left ? left! / Math.max(1, s.left.limit) < 0.1 : false
  const use = (x: Spent) => [x.uses ? `${x.uses} ${x.uses === 1 ? "use" : "uses"}` : "none", x.seconds ? `${Math.round(x.seconds / 60) || "<1"} min heard` : "", money(x.cost)].filter(Boolean).join(", ")
  return (
    <div className="flex min-h-11 items-center gap-3 py-2" data-companion-service={s.service}>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] leading-[20px]">{nameOf(s.service)}</div>
        <div className="text-[13px] text-muted-foreground">Today {use(s.today)} · this week {use(s.week)}</div>
      </div>
      <div className={cn("shrink-0 text-right text-[13px] tabular-nums", low ? "font-medium text-[var(--red)]" : "text-muted-foreground")}>
        {s.left ? <span data-tip={s.left.resets ? `Resets ${fmtStamp(s.left.resets)}` : undefined}>{left!.toLocaleString()} {s.left.unit} left</span>
          : s.billing ? <a href={s.billing} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground hover:underline">Balance<ExternalLink className="size-3" /></a> : null}
      </div>
    </div>
  )
}
