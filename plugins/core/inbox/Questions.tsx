// What a session asks, in its sheet, laid out as its terminal's picker: options numbered, Type something, Chat about this
// (not a dialog read off its screen: closed). One question answers on a tap or Enter; several, with Send answers.
import { useState } from "react"
import { ArrowUp, Check, MessagesSquare } from "lucide-react"
import { Button, cn, haptic, notify, notifyError, op } from "@vaultite"
import type { InboxEvent, Question } from "./types"

const row = "flex min-h-11 items-center gap-3 rounded-[10px] border-[0.5px] px-3.5 py-2.5 text-left transition-colors"
const label = "block text-[17px] leading-[22px] md:text-[14px] md:leading-[20px]"
const num = "w-5 shrink-0 self-start text-[17px] leading-[22px] text-muted-foreground tabular-nums md:text-[14px] md:leading-[20px]"

export function Questions({ e }: { e: InboxEvent & { questions: Question[] } }) {
  const qs = e.questions
  const [picked, setPicked] = useState<number[][]>(() => qs.map(() => []))
  const [typed, setTyped] = useState<string[]>(() => qs.map(() => ""))
  const [sending, setSending] = useState(false)
  // (one question of one option at a time: a tap is the answer, as in its terminal)
  const tapSends = qs.length === 1 && !qs[0].multi
  const open = !qs.some((q) => q.closed)
  // A single-select's own answer counts while none of its options is picked; a multi-select's goes with its picks.
  const own = (qi: number) => (qs[qi].multi || !picked[qi].length ? typed[qi].trim() : "")
  const answered = (qi: number) => picked[qi].length > 0 || !!own(qi)
  const run = async (params: Record<string, unknown>, said: string) => {
    if (sending) return
    setSending(true)
    haptic("medium")
    try {
      await op("inbox.answer", { id: e.id, ...params })
      notify(said)
    } catch (err) {
      notifyError(err, "Couldn't answer it")
    } finally {
      setSending(false)
    }
  }
  const send = (picks: number[][], texts: string[]) => {
    const one = qs.length === 1 && !qs[0].multi ? texts[0] || qs[0].options[picks[0][0] - 1]?.label : ""
    void run({ answer: "pick", picks: picks.map((p) => p.join(",")), ...(texts.some(Boolean) ? { typed: texts } : {}) }, one ? `Answered: ${one}` : "Answered")
  }
  const choose = (qi: number, n: number) => {
    if (tapSends) return send([[n]], [""])
    haptic("selection")
    setPicked((was) => was.map((p, i) => (i !== qi ? p : !qs[qi].multi ? [n] : p.includes(n) ? p.filter((x) => x !== n) : [...p, n].sort())))
  }
  const type = (qi: number, text: string) => {
    setTyped((was) => was.map((t, i) => (i === qi ? text : t)))
    // (typing in a single-select's row picks it, as moving onto it does in the terminal)
    if (!qs[qi].multi && text.trim()) setPicked((was) => was.map((p, i) => (i === qi ? [] : p)))
  }
  const sendAll = () => send(picked.map((p, i) => (own(i) && !qs[i].multi ? [] : p)), qs.map((_, i) => own(i)))
  return (
    <div className="mb-5 flex flex-col gap-5" data-questions>
      {qs.map((q, qi) => {
        const mine = own(qi)
        return (
          <div key={qi} className="flex flex-col gap-2" data-question={qi}>
            {q.header && qs.length > 1 && <div className="text-[13px] font-medium text-muted-foreground">{q.header}</div>}
            <div className="text-[17px] leading-[24px] font-semibold md:text-[15px] md:leading-[22px]">{q.question}</div>
            {q.multi && <div className="-mt-1 text-[13px] text-muted-foreground">Pick any of them</div>}
            <div className="flex flex-col gap-2" role={q.multi ? "group" : "radiogroup"} aria-label={q.question}>
              {q.options.map((o, oi) => {
                const on = picked[qi].includes(oi + 1)
                return (
                  <button key={oi} type="button" disabled={sending} role={q.multi ? "checkbox" : "radio"} aria-checked={on} data-option={oi + 1}
                    onClick={() => choose(qi, oi + 1)}
                    className={cn(row, "cursor-pointer disabled:cursor-progress", on ? "border-primary bg-primary/10" : "border-border hover:bg-foreground/[0.04]")}>
                    <span className={num}>{oi + 1}.</span>
                    <span className="min-w-0 flex-1">
                      <span className={label}>{o.label}</span>
                      {o.description && <span className="block text-[15px] leading-[20px] text-muted-foreground md:text-[13px] md:leading-[18px]">{o.description}</span>}
                    </span>
                    {on && <Check className="size-4 shrink-0 text-primary" strokeWidth={2.5} />}
                  </button>
                )
              })}
              {!q.closed && (
                <label data-option={q.options.length + 1} data-typed={mine ? "on" : "off"}
                  className={cn(row, "cursor-text py-1.5 focus-within:border-primary", mine ? "border-primary bg-primary/10" : "border-border")}>
                  <span className={cn(num, "self-center")}>{q.options.length + 1}.</span>
                  <input value={typed[qi]} disabled={sending} placeholder="Type something" aria-label={`Your own answer to: ${q.question}`}
                    enterKeyHint={tapSends ? "send" : "done"} autoComplete="off"
                    onChange={(ev) => type(qi, ev.target.value)}
                    onKeyDown={(ev) => {
                      if (ev.key !== "Enter" || ev.nativeEvent.isComposing || !typed[qi].trim()) return
                      ev.preventDefault()
                      if (tapSends) send([[]], [typed[qi].trim()])
                      else if (qs.every((_, i) => answered(i))) sendAll()
                    }}
                    className="min-w-0 flex-1 bg-transparent py-1 text-[17px] leading-[22px] outline-none placeholder:text-muted-foreground md:text-[14px] md:leading-[20px]" />
                  {tapSends && mine
                    ? <Button look="primary" className="size-8 shrink-0 rounded-full p-0 md:size-6.5" busy={sending} aria-label="Send" data-send-typed onClick={() => send([[]], [mine])}>
                        <ArrowUp className="size-4" strokeWidth={2.5} />
                      </Button>
                    : mine && <Check className="size-4 shrink-0 text-primary" strokeWidth={2.5} />}
                </label>
              )}
            </div>
          </div>
        )
      })}
      {!tapSends && (
        <div className="flex">
          <Button look="primary" className="h-11 px-4 md:h-8" busy={sending} disabled={!qs.every((_, i) => answered(i))} onClick={sendAll} data-send-answers>
            Send answers
          </Button>
        </div>
      )}
      {open && (
        <div className="flex flex-col gap-2 border-t-[0.5px] border-border pt-3">
          <button type="button" disabled={sending} data-chat-about
            onClick={() => void run({ answer: "chat" }, "Sent: it'll ask what you'd like to clarify")}
            className={cn(row, "cursor-pointer border-border hover:bg-foreground/[0.04] disabled:cursor-progress")}>
            {qs.length === 1 ? <span className={num}>{qs[0].options.length + 2}.</span> : <MessagesSquare className="size-4 shrink-0 text-muted-foreground" />}
            <span className={cn(label, "min-w-0 flex-1")}>Chat about this</span>
          </button>
        </div>
      )}
    </div>
  )
}
