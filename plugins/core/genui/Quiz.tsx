// ChatGPT's <LearningQuiz>: a question at a time, each answer's feedback, a hint, the score at the end, and a new quiz
// asked of the AI chat.
import { useContext, useState } from "react"
import { cn, haptic, namedIcon } from "@vaultite"
import { HostCtx } from "./parts"

type Option = { value: string; label: string; feedback?: string }
type Question = { id?: string; type?: string; question: string; options: Option[]; correctValues?: string[]; hint?: string }

const questionsOf = (v: unknown): Question[] =>
  (Array.isArray(v) ? v : []).filter((q) => q && typeof q === "object" && typeof (q as Question).question === "string")
    .map((q) => ({ ...(q as Question), options: Array.isArray((q as Question).options) ? (q as Question).options.map((o) => ({ ...o, value: String(o.value ?? o.label) })) : [] }))

export function Quiz({ p }: { p: Record<string, unknown> }) {
  const host = useContext(HostCtx)
  const qs = questionsOf(p.questions)
  const [at, setAt] = useState(0)
  const [picked, setPicked] = useState<Record<number, string[]>>({})
  const [hint, setHint] = useState(false)
  if (!qs.length) return null
  const done = at >= qs.length
  const right = (i: number) => { const c = qs[i].correctValues ?? [], a = picked[i] ?? []; return a.length === c.length && a.every((x) => c.includes(x)) }
  const score = qs.filter((_, i) => right(i)).length
  const Check = namedIcon("circle-check"), X = namedIcon("circle-x"), Bulb = namedIcon("lightbulb")
  const title = typeof p.title === "string" ? p.title : "Quiz"
  const next = typeof p.nextQuizQuery === "string" ? p.nextQuizQuery : ""
  return (
    <div className="flex flex-col gap-4 rounded-[16px] border-[0.5px] border-border bg-card p-4 md:p-5" data-quiz>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[15px] font-semibold">{title}</div>
        <div className="text-[13px] text-muted-foreground tabular-nums">{done ? `${score} of ${qs.length}` : `${at + 1} of ${qs.length}`}</div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]"><div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${((done ? qs.length : at) / qs.length) * 100}%` }} /></div>
      {done ? (
        <div className="flex flex-col items-start gap-3">
          <div className="text-[22px] font-semibold tracking-tight">{score === qs.length ? "All right!" : `${score} of ${qs.length} right`}</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="h-8 cursor-pointer rounded-[8px] bg-foreground/[0.07] px-3.5 text-[14px] font-medium hover:bg-foreground/[0.11]" onClick={() => { setAt(0); setPicked({}); setHint(false) }}>Try again</button>
            {next && <button type="button" className="h-8 cursor-pointer rounded-[8px] bg-primary px-3.5 text-[14px] font-medium text-primary-foreground hover:bg-primary/85" onClick={() => host.action("issueNewTurn", [next])}>New questions</button>}
          </div>
        </div>
      ) : (() => {
        const q = qs[at], answered = (picked[at] ?? []).length > 0, many = q.type === "multi_select" || (q.correctValues?.length ?? 0) > 1
        const correct = q.correctValues ?? []
        const choose = (v: string) => {
          if (answered && !many) return
          haptic("selection")
          setPicked((x) => ({ ...x, [at]: many ? ((x[at] ?? []).includes(v) ? (x[at] ?? []).filter((y) => y !== v) : [...(x[at] ?? []), v]) : [v] }))
        }
        const shown = answered && !many
        return (
          <div className="flex flex-col gap-3">
            <div className="text-[18px] leading-[26px] font-semibold">{q.question}</div>
            <div className="flex flex-col gap-2">
              {q.options.map((o) => {
                const mine = (picked[at] ?? []).includes(o.value), ok = correct.includes(o.value)
                return (
                  <button key={o.value} type="button" onClick={() => choose(o.value)}
                    className={cn("flex cursor-pointer flex-col gap-1 rounded-[10px] border-[0.5px] px-3.5 py-2.5 text-left text-[15px] transition-colors",
                      shown && ok ? "border-[var(--green)] bg-[color-mix(in_oklab,var(--green)_12%,transparent)]" : shown && mine ? "border-[var(--red)] bg-[color-mix(in_oklab,var(--red)_12%,transparent)]" : mine ? "border-primary bg-primary/10" : "border-border hover:bg-foreground/[0.04]")}>
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">{o.label}</span>
                      {shown && ok && Check && <Check className="size-4 shrink-0 text-[var(--green)]" />}
                      {shown && mine && !ok && X && <X className="size-4 shrink-0 text-[var(--red)]" />}
                    </span>
                    {shown && (mine || ok) && o.feedback && <span className="text-[13px] text-muted-foreground">{o.feedback}</span>}
                  </button>
                )
              })}
            </div>
            {hint && q.hint && !shown && <p className="flex gap-2 text-[14px] text-muted-foreground">{Bulb && <Bulb className="mt-0.5 size-4 shrink-0" />}{q.hint}</p>}
            <div className="flex gap-2">
              {q.hint && !shown && !hint && <button type="button" className="h-8 cursor-pointer rounded-[8px] px-3 text-[14px] font-medium text-muted-foreground hover:bg-foreground/[0.06]" onClick={() => setHint(true)}>Hint</button>}
              {(shown || (many && answered)) && <button type="button" className="h-8 cursor-pointer rounded-[8px] bg-primary px-3.5 text-[14px] font-medium text-primary-foreground hover:bg-primary/85" onClick={() => { setAt(at + 1); setHint(false) }}>{at + 1 < qs.length ? "Next" : "See score"}</button>}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
