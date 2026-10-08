// A cards file as a page (its cards and when each comes back), the review sheet (cards due, mixed across files), and
// the `lessons` block.
import {
  detailPath, Empty, haptic, Loading, Markdown, notifyError, op, openDetail, openFile, Panel, Row, SheetHead, useCommands, useLive,
  type BlockCtx, type PageCtx, type Store,
} from "@vaultite"
import { BookOpenCheck, Check, Layers } from "lucide-react"
import { useMemo, useState } from "react"
import { clozeText, lessonCards, parseCards } from "./format.ts"
import { next, nextDue, queue, RATINGS, span, type Due, type Memory, type Rating, type Source } from "./schedule.ts"
import type { State } from "./types.ts"

const STATE = "lessons/state"
const btn = "cursor-pointer rounded-[8px] px-4 py-2 text-[15px]"
const primary = `${btn} bg-primary text-primary-foreground hover:opacity-90`

/** Every cards file, and each finished lesson's recall questions (the server's `sources`, plugin.ts). */
function sourcesOf(s: Store): Source[] {
  const decks = (s.decks ?? []).filter((d) => !d.archived).map((d) => ({ id: d.id, title: d.title, cards: parseCards(d.notes) }))
  const lessons = (s.lessons ?? []).filter((l) => !l.archived && l.steps > 0 && l.step >= l.steps)
    .map((l) => ({ id: l.id, title: l.title, cards: lessonCards(l.notes) })).filter((x) => x.cards.length)
  return [...decks, ...lessons]
}

const day = (iso: string) => iso.slice(0, 10)

export function DeckPage({ path, body, store }: PageCtx) {
  const { data } = useLive<State>(STATE)
  const id = path.replace(/\.md$/, "")
  const cards = useMemo(() => parseCards(body), [body])
  if (!cards.length) return <Markdown text={body} full from={path} />
  const mem = data?.reviews[id] ?? {}
  const now = new Date()
  const due = data ? queue([{ id, title: "", cards }], data.reviews, now, data.newPerDay).length : 0
  const fresh = cards.filter((c) => !mem[c.key]).length
  return (
    <div className="pb-16">
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="flex-1 text-[15px] text-muted-foreground">
          {cards.length} cards{fresh ? `, ${fresh} new` : ""}{data && !due ? (nextDue([{ id, title: "", cards }], data.reviews, now) ? `, next review ${day(nextDue([{ id, title: "", cards }], data.reviews, now)!)}` : "") : ""}
        </div>
        {due > 0 && <button type="button" className={primary} onClick={() => openDetail(detailPath("review", id))}>Review {due}</button>}
      </div>
      <div className="flex flex-col gap-3">
        {cards.map((c) => {
          const m = mem[c.key]
          return (
            <div key={c.key} className="rounded-[12px] border border-border bg-card p-3">
              <div className="flex items-start gap-3">
                <Markdown text={clozeText(c, true)} inline className="flex-1 font-semibold" store={store} />
                <span className="shrink-0 text-[13px] text-muted-foreground">{!m ? "New" : Date.parse(m.due) <= now.getTime() ? "Due" : `In ${span(now, m.due)}`}</span>
              </div>
              {c.answer && <Markdown text={c.answer} full from={path} className="mt-1 text-muted-foreground" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Rate({ m, retention, onRate }: { m: Memory | undefined; retention: number; onRate: (g: Rating) => void }) {
  const now = new Date()
  return (
    <div className="mt-6 grid grid-cols-4 gap-2">
      {RATINGS.map((r, i) => (
        <button key={r} type="button" onClick={() => onRate((i + 1) as Rating)}
          className="flex min-h-11 cursor-pointer flex-col items-center rounded-[8px] border border-border py-2 text-[15px] capitalize hover:border-primary">
          {r}<span className="text-[12px] text-muted-foreground">{span(now, next(m, (i + 1) as Rating, now, retention).due)}</span>
        </button>
      ))}
    </div>
  )
}

function Session({ data, sources, only }: { data: State; sources: Source[]; only?: string }) {
  const [list, setList] = useState<Due[]>(() => queue(only ? sources.filter((s) => s.id === only) : sources, data.reviews, new Date(), data.newPerDay))
  const [mem, setMem] = useState(data.reviews)
  const [i, setI] = useState(0)
  const [shown, setShown] = useState(false)
  const c = list[i]
  const rate = (g: Rating) => {
    if (!c) return
    setMem((r) => ({ ...r, [c.source]: { ...r[c.source], [c.key]: next(r[c.source]?.[c.key], g, new Date(), data.retention) } }))
    haptic()
    op("cards.review", { source: c.source, card: c.key, rating: RATINGS[g - 1] }).catch((e) => notifyError(e, "Couldn't save the review"))
    if (g === 1) setList((l) => [...l, c])
    setI(i + 1)
    setShown(false)
  }
  useCommands(() => [
    { id: "lessons:show-answer", name: "Show the card's answer", keys: ["Space"], when: () => !!c && !shown, run: () => setShown(true) },
    ...RATINGS.map((r, n) => ({ id: `lessons:${r}`, name: `Rate the card ${r}`, keys: [String(n + 1)], when: () => !!c && shown, run: () => rate((n + 1) as Rating) })),
  ], [c, shown, i])

  if (!c) {
    const nxt = nextDue(sources, mem, new Date())
    return (
      <div className="mt-6 flex items-center gap-2 text-[15px]">
        <Check className="size-5 text-[var(--green)]" />
        {i ? `Done: ${i} reviewed.` : "Nothing to review."}{nxt ? ` Next ones ${day(nxt)}.` : ""}
      </div>
    )
  }
  return (
    <div>
      <div className="mb-4 flex justify-between text-[13px] text-muted-foreground">
        <button type="button" className="cursor-pointer hover:underline" onClick={() => openFile(`${c.source}.md`)}>{c.title}</button>
        <span>{c.fresh ? "New · " : ""}{list.length - i} left</span>
      </div>
      <div className="rounded-[12px] border border-border bg-card p-5">
        <Markdown text={clozeText(c, shown)} full className="text-[17px] font-semibold" />
        {shown && c.answer && <Markdown text={c.answer} full className="mt-4 border-t border-border pt-4" />}
      </div>
      {shown ? <Rate m={mem[c.source]?.[c.key]} retention={data.retention} onRate={rate} />
        : <button type="button" className={`mt-6 w-full ${primary}`} onClick={() => setShown(true)}>Show answer</button>}
    </div>
  )
}

export function Review({ store, source }: { store: Store; source?: string }) {
  const { data } = useLive<State>(STATE)
  const sources = useMemo(() => sourcesOf(store), [store])
  return (
    <>
      <SheetHead icon={Layers} tint="var(--lessons)" kicker="Review" title={source ? (sources.find((s) => s.id === source)?.title ?? "Cards") : "Your cards"} />
      {data ? <Session data={data} sources={sources} only={source} /> : <Loading />}
    </>
  )
}

export function LessonsBlock({ store }: BlockCtx) {
  const { data } = useLive<State>(STATE)
  const lessons = (store.lessons ?? []).filter((l) => !l.archived)
  const decks = (store.decks ?? []).filter((d) => !d.archived)
  const sources = useMemo(() => sourcesOf(store), [store])
  const now = new Date()
  const due = data ? queue(sources, data.reviews, now, data.newPerDay).length : 0
  const nxt = data && !due ? nextDue(sources, data.reviews, now) : null
  const order = [...lessons].sort((a, b) => Number(a.step >= a.steps) - Number(b.step >= b.steps) || b.step - a.step)
  return (
    <Panel title="Lessons" icon={BookOpenCheck} tint="var(--lessons)"
      action={due > 0 && <button type="button" className="cursor-pointer text-[15px] text-primary hover:underline" onClick={() => openDetail(detailPath("review"))}>Review {due}</button>}>
      {!lessons.length && !decks.length ? <Empty>No lessons or cards yet. Ask an agent to teach you a note.</Empty> : (
        <div className="flex flex-col">
          {data && !due && sources.length > 0 && <Empty>Nothing to review{nxt ? ` until ${day(nxt)}` : ""}.</Empty>}
          {order.map((l) => (
            <Row key={l.id} title={l.title} onOpen={() => openFile(`${l.id}.md`)}
              meta={l.step >= l.steps ? "Done" : l.step ? `Step ${l.step + 1} of ${l.steps}` : `${l.steps} steps`}
              right={<div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><div className="h-full bg-[var(--lessons)]" style={{ width: `${l.steps ? Math.min(1, l.step / l.steps) * 100 : 0}%` }} /></div>} />
          ))}
          {decks.map((d) => <Row key={d.id} title={d.title} meta={`${d.cards} cards`} onOpen={() => openFile(`${d.id}.md`)} />)}
        </div>
      )}
    </Panel>
  )
}
