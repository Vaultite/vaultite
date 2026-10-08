// A lesson drawn one step at a time: each step's question opens the next, right or wrong (the why matters more than
// the score). Where the user is: the file's `step`.
import { detailPath, Markdown, openDetail, scrollPage, setProperty, type PageCtx } from "@vaultite"
import { Check, RotateCcw, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { parseLesson, shuffled, type Question, type Step } from "./format.ts"

const btn = "cursor-pointer rounded-[8px] px-4 py-2 text-[15px]"
const primary = `${btn} bg-primary text-primary-foreground hover:opacity-90`

function Choice({ q, answered, onAnswer }: { q: Extract<Question, { kind: "choice" }>; answered: boolean; onAnswer: () => void }) {
  const opts = useMemo(() => shuffled(q.options, q.text), [q])
  const [picked, setPicked] = useState<number | null>(null)
  const shown = answered || picked != null
  return (
    <>
      <div className="mt-3 flex flex-col gap-2">
        {opts.map((o, i) => {
          const tone = !shown ? "hover:border-primary" : o.right ? "border-[var(--green)] bg-[var(--green)]/10"
            : picked === i ? "border-[var(--red)] bg-[var(--red)]/10" : "opacity-60"
          return (
            <button key={i} type="button" disabled={shown} onClick={() => { setPicked(i); onAnswer() }}
              className={`flex cursor-pointer flex-col items-start rounded-[8px] border border-border px-3 py-2.5 text-left text-[15px] disabled:cursor-default ${tone}`}>
              <span className="flex w-full items-center gap-2">
                <span className="flex-1"><Markdown text={o.text} inline /></span>
                {shown && o.right && <Check className="size-4 text-[var(--green)]" />}
                {shown && picked === i && !o.right && <X className="size-4 text-[var(--red)]" />}
              </span>
              {shown && o.why && (o.right || picked === i) && <span className="mt-1 text-[14px] text-muted-foreground"><Markdown text={o.why} inline /></span>}
            </button>
          )
        })}
      </div>
      {shown && picked != null && <p className="mt-3 text-[15px] font-medium" style={{ color: opts[picked].right ? "var(--green)" : "var(--red)" }}>{opts[picked].right ? "Right." : "Not quite."}</p>}
      {shown && q.why && <Markdown text={q.why} full className="mt-2 text-muted-foreground" />}
    </>
  )
}

function Recall({ q, answered, onAnswer }: { q: Extract<Question, { kind: "recall" }>; answered: boolean; onAnswer: () => void }) {
  if (!answered) return (
    <>
      <p className="mt-2 text-[14px] text-muted-foreground">Answer in your head first, then check.</p>
      <button type="button" className={`mt-3 ${primary}`} onClick={onAnswer}>Show answer</button>
    </>
  )
  return <div className="mt-3 border-l-2 border-[var(--green)] pl-3"><Markdown text={q.answer} full /></div>
}

function Order({ q, answered, onAnswer }: { q: Extract<Question, { kind: "order" }>; answered: boolean; onAnswer: () => void }) {
  const items = useMemo(() => {
    const s = shuffled(q.items.map((_, i) => i), q.text)
    return s.every((x, i) => x === i) ? s.reverse() : s
  }, [q])
  const [chosen, setChosen] = useState<number[]>([])
  const full = answered || chosen.length === q.items.length
  const pick = (i: number) => {
    const c = [...chosen, i]
    setChosen(c)
    if (c.length === q.items.length) onAnswer()
  }
  if (full) {
    const mine = answered && chosen.length < q.items.length ? q.items.map((_, i) => i) : chosen
    const right = mine.every((x, i) => x === i)
    return (
      <>
        <ol className="mt-3 flex flex-col gap-2">
          {q.items.map((t, i) => (
            <li key={i} className="flex items-center gap-2 rounded-[8px] border border-border px-3 py-2 text-[15px]">
              <span className="w-5 text-muted-foreground">{i + 1}.</span>
              <span className="flex-1"><Markdown text={t} inline /></span>
              {mine[i] === i ? <Check className="size-4 text-[var(--green)]" /> : <X className="size-4 text-[var(--red)]" />}
            </li>
          ))}
        </ol>
        {chosen.length === q.items.length && <p className="mt-3 text-[15px] font-medium" style={{ color: right ? "var(--green)" : "var(--red)" }}>{right ? "Right order." : "Not quite: this is the order."}</p>}
        {q.why && <Markdown text={q.why} full className="mt-2 text-muted-foreground" />}
      </>
    )
  }
  return (
    <>
      <p className="mt-2 text-[14px] text-muted-foreground">Tap them in order.</p>
      <div className="mt-3 flex flex-col gap-2">
        {items.map((i) => {
          const at = chosen.indexOf(i)
          return (
            <button key={i} type="button" disabled={at >= 0} onClick={() => pick(i)}
              className="flex cursor-pointer items-center gap-2 rounded-[8px] border border-border px-3 py-2.5 text-left text-[15px] hover:border-primary disabled:cursor-default disabled:opacity-50">
              <span className="w-5 text-muted-foreground">{at >= 0 ? `${at + 1}.` : ""}</span>
              <span className="flex-1"><Markdown text={q.items[i]} inline /></span>
            </button>
          )
        })}
      </div>
      {chosen.length > 0 && <button type="button" className="mt-2 cursor-pointer text-[14px] text-muted-foreground hover:text-foreground" onClick={() => setChosen([])}>Start again</button>}
    </>
  )
}

function Ask({ q, answered, onAnswer, guess }: { q: Question; answered: boolean; onAnswer: () => void; guess: boolean }) {
  return (
    <div className="mt-4 rounded-[12px] border border-border bg-card p-4">
      {guess && <div className="mb-1 text-[13px] font-semibold text-[var(--lessons)]">Guess first: it's fine to be wrong</div>}
      <Markdown text={q.text} inline className="font-semibold" />
      {q.kind === "choice" ? <Choice q={q} answered={answered} onAnswer={onAnswer} />
        : q.kind === "recall" ? <Recall q={q} answered={answered} onAnswer={onAnswer} />
        : <Order q={q} answered={answered} onAnswer={onAnswer} />}
    </div>
  )
}

function StepView({ s, path, past, onNext }: { s: Step; path: string; past: boolean; onNext?: () => void }) {
  const [answered, setAnswered] = useState(past)
  const body = s.body && <Markdown text={s.body} full from={path} />
  const ask = s.question && <Ask q={s.question} answered={answered} onAnswer={() => setAnswered(true)} guess={s.first} />
  const ready = !s.question || answered
  return (
    <>
      <h2 className="mb-2 text-[20px] font-semibold">{s.title}</h2>
      {s.first ? <>{ask}{answered && <div className="mt-4">{body}</div>}</> : <>{body}{ask}</>}
      {onNext && ready && <button type="button" className={`mt-4 ${primary}`} onClick={onNext}>Continue</button>}
    </>
  )
}

function Bar({ at, total }: { at: number; total: number }) {
  return (
    <div className="mb-5 flex items-center gap-3 text-[13px] text-muted-foreground">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-[var(--lessons)] transition-all" style={{ width: `${total ? (Math.min(at, total) / total) * 100 : 0}%` }} />
      </div>
      {at >= total ? "Done" : `${at + 1} of ${total}`}
    </div>
  )
}

export function LessonPage({ path, body, fm }: PageCtx) {
  const { intro, steps } = useMemo(() => parseLesson(body), [body])
  const saved = Math.min(Math.max(Number(fm.step) || 0, 0), steps.length)
  const [at, setAt] = useState(saved)
  const [seen, setSeen] = useState(saved)
  if (seen !== saved) { setSeen(saved); setAt(saved) }
  const last = useRef<HTMLDivElement>(null)
  const moved = useRef(false)
  useEffect(() => {
    const el = last.current, pane = el?.closest<HTMLElement>("[data-pane], #main-scroll")
    if (moved.current && el && pane) scrollPage(pane.scrollTop + el.getBoundingClientRect().top - pane.getBoundingClientRect().top - 16, true)
  }, [at])
  const go = (n: number) => { moved.current = n > 0; setAt(n); void setProperty(path, "step", n || undefined) }
  const recalls = steps.filter((s) => s.question?.kind === "recall").length
  if (!steps.length) return <Markdown text={body} full from={path} />

  const shown: ReactNode[] = steps.slice(0, at + 1).map((s, i) => (
    <div key={i} ref={i === at ? last : undefined} className="mt-8 first:mt-0">
      <StepView s={s} path={path} past={i < at} onNext={i === at ? () => go(i + 1) : undefined} />
    </div>
  ))
  return (
    <div className="pb-16">
      <Bar at={at} total={steps.length} />
      {intro && <div className="mb-8"><Markdown text={intro} full from={path} /></div>}
      {shown}
      {at >= steps.length && (
        <div ref={last} className="mt-10 rounded-[12px] border border-[var(--green)] p-4 text-[15px]">
          <div className="flex items-center gap-2 font-semibold"><Check className="size-5 text-[var(--green)]" /> Done: all {steps.length} steps</div>
          {recalls > 0 && <p className="mt-2 text-muted-foreground">Its {recalls === 1 ? "recall question is" : `${recalls} recall questions are`} now in your cards, to come back before you forget.</p>}
          <div className="mt-3 flex gap-4">
            {recalls > 0 && <button type="button" className={primary} onClick={() => openDetail(detailPath("review"))}>Review cards</button>}
            <button type="button" onClick={() => go(0)} className="flex cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground">
              <RotateCcw className="size-4" /> Start over
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
