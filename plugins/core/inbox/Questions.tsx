// What a session asks, in a session's sheet: each question with its options, as it shows them in its terminal. One
// question is answered by tapping an option; several, or a multi-select, by picking each, then Send answers.
import { useState } from "react"
import { Check } from "lucide-react"
import { Button, cn, haptic, notify, notifyError, op } from "@vaultite"
import type { InboxEvent, Question } from "./types"

export function Questions({ e }: { e: InboxEvent & { questions: Question[] } }) {
  const qs = e.questions
  const [picked, setPicked] = useState<number[][]>(() => qs.map(() => []))
  const [sending, setSending] = useState(false)
  // (one question of one option at a time: a tap is the answer, as in its terminal)
  const tapSends = qs.length === 1 && !qs[0].multi
  const send = async (picks: number[][]) => {
    if (sending) return
    setSending(true)
    haptic("medium")
    try {
      await op("inbox.answer", { id: e.id, answer: "pick", picks: picks.map((p) => p.join(",")) })
      notify(qs.length === 1 && !qs[0].multi ? `Answered: ${qs[0].options[picks[0][0] - 1]?.label}` : "Answered")
    } catch (err) {
      notifyError(err, "Couldn't answer it")
    } finally {
      setSending(false)
    }
  }
  const choose = (qi: number, n: number) => {
    if (tapSends) return void send([[n]])
    haptic("selection")
    setPicked((was) => was.map((p, i) => (i !== qi ? p : !qs[qi].multi ? [n] : p.includes(n) ? p.filter((x) => x !== n) : [...p, n].sort())))
  }
  return (
    <div className="mb-5 flex flex-col gap-5" data-questions>
      {qs.map((q, qi) => (
        <div key={qi} className="flex flex-col gap-2" data-question={qi}>
          {q.header && qs.length > 1 && <div className="text-[13px] font-medium text-muted-foreground">{q.header}</div>}
          <div className="text-[17px] leading-[24px] font-semibold md:text-[15px] md:leading-[22px]">{q.question}</div>
          {q.multi && <div className="-mt-1 text-[13px] text-muted-foreground">Pick any of them</div>}
          <div className="flex flex-col gap-2" role={q.multi ? "group" : "radiogroup"} aria-label={q.question}>
            {q.options.map((o, oi) => {
              const mine = picked[qi].includes(oi + 1)
              return (
                <button key={oi} type="button" disabled={sending} role={q.multi ? "checkbox" : "radio"} aria-checked={mine} data-option={oi + 1}
                  onClick={() => choose(qi, oi + 1)}
                  className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] border-[0.5px] px-3.5 py-2.5 text-left transition-colors disabled:cursor-progress",
                    mine ? "border-primary bg-primary/10" : "border-border hover:bg-foreground/[0.04]")}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] leading-[22px] md:text-[14px] md:leading-[20px]">{o.label}</span>
                    {o.description && <span className="block text-[15px] leading-[20px] text-muted-foreground md:text-[13px] md:leading-[18px]">{o.description}</span>}
                  </span>
                  {mine && <Check className="size-4 shrink-0 text-primary" strokeWidth={2.5} />}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      {!tapSends && (
        <div className="flex">
          <Button look="primary" className="h-11 px-4 md:h-8" busy={sending} disabled={picked.some((p) => !p.length)} onClick={() => void send(picked)} data-send-answers>
            Send answers
          </Button>
        </div>
      )}
    </div>
  )
}
