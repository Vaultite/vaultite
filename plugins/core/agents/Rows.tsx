import { Fragment, useEffect, useMemo, useRef } from "react"
import { EarlierRow, foldsAway, isViewOpen, useEarlier, useGlide, useHold, useSteady, type AgentRun } from "@vaultite"
import { useFoldAfter } from "@plugins/terminal/fold"
import { Row } from "./Row"
import { useNow, useWhere } from "./runs"
import { showing, useMarks } from "./marks"
import { FOLDED, SHELVES, shelfOf, shelve, type Shelf } from "./shelves"
import { useView, type Group, type Sort } from "./view"

const ORDER: AgentRun["state"][] = ["needs", "working", "waiting", "done"]
const EARLIER = "agents:earlier"
const latest = (r: AgentRun) => Math.max(r.at, r.since ?? 0)
const sortRuns = (list: AgentRun[], by: Sort) =>
  by === "recent" ? [...list].sort((a, b) => latest(b) - latest(a)) : ORDER.flatMap((s) => list.filter((r) => r.state === s))

function groupOf(by: Group, r: AgentRun, where: string | undefined) {
  if (by === "project") return r.project ?? ""
  if (by === "machine") return where ?? ""
  if (by === "account") return r.account ?? ""
  return ""
}
const OTHER: Record<Group, string> = { none: "", state: "", project: "No repository", machine: "This machine", account: "Other accounts" }

function Heading({ name, count, attr }: { name: string; count: number; attr: Record<string, string> }) {
  return (
    <div className="flex h-7 min-w-0 items-center gap-2 truncate pt-1.5 pl-1.5 text-[12px] font-medium whitespace-nowrap text-tertiary max-md:min-h-11 max-md:text-[15px]"
      data-glide={`group:${name}`} {...attr}>
      <span className="truncate">{name}</span><span className="font-normal tabular-nums">{count}</span>
    </div>
  )
}

type Props = { list: AgentRun[]; open: boolean; tab: string; page?: boolean }

export function Rows(p: Props) {
  const view = useView()
  return p.open && view.group !== "none" && view.group !== "state" ? <Grouped {...p} by={view.group} sort={view.sort} /> : <Shelves {...p} sort={view.sort} />
}

function useShelves(list: AgentRun[], sort: Sort, held: boolean, now: number, page?: boolean) {
  const marks = useMarks(), after = useFoldAfter()
  const sorted = useMemo(() => sortRuns(list, sort), [list, sort])
  const folds = (r: AgentRun) => !page && foldsAway(r, now, !!r.to && isViewOpen(r.to), after)
  const away = (r: AgentRun) => !r.shell && FOLDED.includes(shelfOf(r, marks[r.id], now, folds(r)))
  const { front, earlier } = useSteady(sorted, held, away)
  const out = shelve(front.filter((r) => !r.shell), marks, now, () => false)
  const back = shelve(earlier, marks, now, () => true)
  for (const [s, rs] of back) out.set(s, [...(out.get(s) ?? []), ...rs])
  return { out, shells: front.filter((r) => r.shell) }
}

function Shelves({ list, open, tab, page, sort }: Props & { sort: Sort }) {
  const box = useRef<HTMLDivElement>(null)
  const held = useHold(box)
  const now = useNow(open)
  const where = useWhere()
  const { out, shells } = useShelves(list, sort, held, now, page)
  const [settledOpen, openSettled] = useEarlier(EARLIER), [snoozedOpen, openSnoozed] = useEarlier("agents:snoozed")
  useEffect(() => showing(list, out.get("needs") ?? []))
  const row = (r: AgentRun) => <Row key={r.id} r={r} open={open} tab={tab} page={page} where={where(r)} />
  const front = SHELVES.filter((s) => !FOLDED.includes(s.id)).map((s) => [s.id, s.label, out.get(s.id) ?? []] as const)
  const fold = (s: Shelf, label: string, unfolded: boolean, unfold: () => void) => {
    const rs = out.get(s) ?? []
    return rs.length > 0 && <Fragment key={s}>
      <EarlierRow label={label} count={rs.length} open={unfolded} onClick={unfold} data-agent-shelf={s} data-agent-earlier={s === "settled" ? (unfolded ? "open" : "closed") : undefined} />
      {unfolded && rs.map(row)}
    </Fragment>
  }
  const order = [...front.flatMap(([id, , rs]) => (rs.length ? [`shelf:${id}`, ...rs.map((r) => r.id)] : [])), ...shells.map((r) => r.id), "|",
    ...(snoozedOpen ? out.get("snoozed") ?? [] : []).map((r) => r.id), ...(settledOpen ? out.get("settled") ?? [] : []).map((r) => r.id)]
  useGlide(box, order.join("\n"))
  if (!open) return <div ref={box} className="flex flex-col gap-px" data-agent-rows>{[...front.flatMap(([, , rs]) => rs), ...shells].map(row)}</div>
  return (
    <div ref={box} className="flex flex-col gap-px" data-agent-rows data-held={held || undefined} data-shelves>
      {front.map(([id, label, rs]) => rs.length > 0 && <Fragment key={id}><Heading name={label} count={rs.length} attr={{ "data-agent-shelf": id }} />{rs.map(row)}</Fragment>)}
      {shells.length > 0 && <><Heading name="Shells" count={shells.length} attr={{ "data-agent-shelf": "shells" }} />{shells.map(row)}</>}
      {fold("snoozed", "Snoozed", snoozedOpen, openSnoozed)}
      {fold("settled", "Settled", settledOpen, openSettled)}
    </div>
  )
}

function Grouped({ list, open, tab, page, by, sort }: Props & { by: Group; sort: Sort }) {
  const box = useRef<HTMLDivElement>(null)
  const held = useHold(box)
  const [unfolded, unfold] = useEarlier(EARLIER)
  const where = useWhere(), marks = useMarks()
  const now = useNow(open), after = useFoldAfter()
  const sorted = useMemo(() => sortRuns(list, sort), [list, sort])
  const away = useMemo(() => new Set([...shelve(sorted, marks, now, () => false)].flatMap(([s, rs]) => (FOLDED.includes(s) ? rs.map((r) => r.id) : []))), [sorted, marks, now])
  const { front, earlier } = useSteady(sorted, held, (r) => away.has(r.id) || (!page && foldsAway(r, now, !!r.to && isViewOpen(r.to), after)))
  useEffect(() => showing(list, front.filter((r) => r.state === "needs" || r.state === "done")))
  const groups = useMemo(() => {
    const m = new Map<string, AgentRun[]>()
    for (const r of front) {
      const g = groupOf(by, r, where(r)) || OTHER[by]
      m.set(g, [...(m.get(g) ?? []), r])
    }
    return [...m.keys()].sort((a, b) => Number(a === OTHER[by]) - Number(b === OTHER[by])).map((k) => [k, m.get(k) ?? []] as const)
  }, [by, front, where])
  useGlide(box, [...groups.flatMap(([k, rs]) => [`group:${k}`, ...rs.map((r) => r.id)]), "|", ...(unfolded ? earlier.map((r) => r.id) : [])].join("\n"))
  const row = (r: AgentRun) => <Row key={r.id} r={r} open={open} tab={tab} page={page} where={where(r)} />
  return (
    <div ref={box} className="flex flex-col gap-px" data-agent-rows data-held={held || undefined} data-group={by}>
      {groups.map(([k, rs]) => <Fragment key={k}><Heading name={k} count={rs.length} attr={{ "data-agent-group": k }} />{rs.map(row)}</Fragment>)}
      {earlier.length > 0 && <EarlierRow count={earlier.length} open={unfolded} onClick={unfold} data-agent-earlier={unfolded ? "open" : "closed"} />}
      {unfolded && earlier.map(row)}
    </div>
  )
}
