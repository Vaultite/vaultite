import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { Check, X } from "lucide-react"
import { Button, cn, haptic, Markdown, notify, notifyError, op, ink, useCommandKeys, useCommands, usePane } from "@vaultite"
import { ClaudeIcon } from "./ClaudeIcon"
import { QuestionPicker } from "@plugins/inbox/Questions"
import { type Ask, TINT, STRONG } from "./chatbits"
import { rec, str } from "./inputs"
import { EditDiff } from "./chatbits"

export type AskKeys = { yes?: () => void; no?: () => void; also?: () => void; pick?: (n: number) => void }

export function AskCard({ e, id, pending, docked, of, bind }: { e: Ask; id: string; pending: boolean; docked?: boolean
  of?: [number, number]
  bind?: (k: AskKeys | null) => void }) {
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const answer = async (a: Record<string, unknown>, said: string) => {
    if (busy) return
    setBusy(true)
    haptic("medium")
    try { await op("claude-code.chat-answer", { id, ask: e.id, ...a }) } catch (err) { setBusy(false); notifyError(err, "Couldn't answer it"); return }
    notify(said)
  }
  const plan = e.kind === "plan" ? splitPlan(e.plan ?? "") : null
  const head = e.kind === "permission" ? e.title : e.kind === "question" ? (e.questions?.length === 1 && e.questions[0].header) || "Claude asks" : plan!.title
  const click = (sel: string) => { const b = root.current?.querySelector<HTMLButtonElement>(sel); if (b && !b.disabled) b.click() }
  const acts: Acts = e.kind === "permission" ? {
    yes: () => void answer({ allow: true }, "Allowed"), no: () => void answer({ allow: false }, "Denied"),
    ...(e.always ? { also: () => void answer({ allow: true, always: true }, "Allowed from now on") } : {}),
  } : e.kind === "plan" ? {
    yes: () => void answer({ allow: true, mode: "acceptEdits" }, "Approved: edits go ahead"), no: () => void answer({ allow: false }, "Kept planning"),
    also: () => void answer({ allow: true, mode: "default" }, "Approved"),
  } : { yes: () => click("[data-send-answers]"), pick: (n) => click(`[data-question="0"] [data-option="${n}"]`) }
  useLayoutEffect(() => {
    if (!bind || !docked || !pending) return
    bind(acts)
    return () => bind(null)
  })
  if (!pending) {
    const ok = !!e.answer && !/^(Denied|Kept planning|Stopped)/.test(e.answer)
    return (
      <div data-entry="ask" data-answered className="-mx-1.5 flex min-h-7 items-start gap-2 px-1.5 text-[13px] text-muted-foreground max-md:text-[15px]">
        {ok ? <Check className="mt-[3px] size-3.5 shrink-0 text-[var(--green)]" strokeWidth={2.5} /> : <X className="mt-[3px] size-3.5 shrink-0" strokeWidth={2.5} />}
        <span className="min-w-0 break-words"><span className="text-foreground/80">{e.kind === "permission" ? e.detail || e.title : e.title}</span>{e.answer ? ` · ${e.answer}` : " · No longer asked"}</span>
      </div>
    )
  }
  return (
    <div ref={root} data-entry="ask" data-ask={e.kind} data-docked={docked || undefined}
      className={cn("rounded-card border-[0.5px] border-border bg-card", docked ? "chat-lift" : "chat-rest")}>
      {docked && <AskCommands kind={e.kind} acts={acts} root={root} />}
      <div className="chat-ask-x chat-ask-head flex items-start gap-2.5">
        <ClaudeIcon className="mt-[3px] size-4 shrink-0" style={{ color: ink(TINT) }} />
        <div className="min-w-0 flex-1">
          <p data-ask-head className={cn("break-words", e.kind === "question" ? "text-[13px] leading-[22px] font-medium text-muted-foreground max-md:text-[15px]" : "text-[15px] leading-[22px] font-semibold max-md:text-[17px] max-md:leading-[24px]")}>{head}</p>
          {e.kind === "permission" && e.detail && e.detail !== str(rec(e.input).command) && <p className="text-[13px] leading-[19px] break-words text-muted-foreground max-md:text-[15px] max-md:leading-[21px]">{e.detail}</p>}
        </div>
        {of && of[1] > 1 && <span className="shrink-0 pt-0.5 text-[12px] text-tertiary tabular-nums">{of[0]} of {of[1]}</span>}
      </div>
      {e.kind === "permission" ? <Permission e={e} busy={busy} acts={acts} />
        : e.kind === "question" ? (
          <div className="chat-ask-x chat-answers pt-2 pb-4">
            <div className="chat-question overflow-y-auto overscroll-contain"><QuestionPicker qs={e.questions ?? []} busy={busy} answer={(a, said) => void answer(a, said)} ownBelow={docked} /></div>
            {docked && <p className="mt-3 text-[12px] text-tertiary max-md:hidden">{e.questions?.length === 1 && !e.questions[0].multi ? "Press a number to pick it, or type your own answer below" : "Press a number to pick it"}</p>}
          </div>
        )
        : <Plan text={plan!.body} busy={busy} acts={acts} />}
    </div>
  )
}

type Acts = AskKeys
type Answering = { busy: boolean; acts: Acts }
const BIG = "chat-act whitespace-nowrap max-md:h-11 max-md:px-3 max-md:text-[16px]"

function AskCommands({ kind, acts, root }: { kind: Ask["kind"]; acts: Acts; root: RefObject<HTMLDivElement | null> }) {
  const { focused } = usePane()
  const live = useRef(acts)
  useLayoutEffect(() => { live.current = acts })
  useCommands(() => {
    if (!focused) return []
    const here = () => { const a = document.activeElement, chat = root.current?.closest("[data-chat]"); return !a || a === document.body || !!chat?.contains(a) }
    return [
      ...(kind !== "question" ? [
        { id: "claude-code:ask-yes", name: kind === "plan" ? "Approve Claude's plan" : "Allow what Claude asks", keys: ["Enter"], keysWhen: here, run: () => live.current.yes?.() },
        { id: "claude-code:ask-no", name: kind === "plan" ? "Keep Claude planning" : "Deny what Claude asks", keys: ["Escape"], keysWhen: here, run: () => live.current.no?.() },
        { id: "claude-code:ask-also", name: kind === "plan" ? "Approve Claude's plan, asking before edits" : "Always allow what Claude asks", keys: ["Mod+Enter"], keysWhen: here, run: () => live.current.also?.() },
      ] : [{ id: "claude-code:ask-yes", name: "Send answers to Claude", keys: ["Enter"], keysWhen: here, unlisted: true, run: () => live.current.yes?.() }]),
      ...(kind === "question" ? Array.from({ length: 9 }, (_, i) => ({ id: `claude-code:ask-${i + 1}`, name: `Pick answer ${i + 1}`, keys: [String(i + 1)], keysWhen: here, unlisted: true,
        run: () => live.current.pick?.(i + 1) })) : []),
    ]
  }, [focused, kind])
  return null
}

function Key({ id, strong }: { id: string; strong?: boolean }) {
  const k = useCommandKeys(id)
  if (!k) return null
  return <kbd className={cn("ml-0.5 rounded-chip px-1 font-keys text-[11px] leading-[16px] max-md:hidden", strong ? "chat-key-strong" : "bg-foreground/[0.07] text-muted-foreground")}>{k}</kbd>
}

function Actions({ children }: { children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = row.current
    if (!el) return
    let width = -1
    const fit = () => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      delete el.dataset.stack
      if (el.scrollWidth > el.clientWidth + 1) el.dataset.stack = ""
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return <div ref={row} data-actions className="chat-actions chat-ask-x flex items-center gap-2 pt-3">{children}</div>
}

function Permission({ e, busy, acts }: { e: Ask } & Answering) {
  const i = rec(e.input)
  const body = str(i.command) ? <pre className="max-h-[30dvh] overflow-auto rounded-control bg-muted px-3 py-2 font-mono text-[12px] leading-[17px] whitespace-pre-wrap break-words max-md:text-[13px] max-md:leading-[18px]">{str(i.command)}</pre>
    : (e.tool === "Edit" || e.tool === "MultiEdit") && (str(i.old_string) || str(i.new_string)) ? <div className="max-h-[30dvh] overflow-y-auto"><EditDiff file={str(i.file_path)} edits={[{ old_string: str(i.old_string), new_string: str(i.new_string) }]} /></div>
    : null
  return (
    <>
      {body && <div className="chat-ask-x pt-2.5">{body}</div>}
      <Actions>
        <Button look="primary" className={cn(STRONG, BIG)} busy={busy} data-answer="allow" onClick={acts.yes}><Check className="size-4 max-md:hidden" />Allow<Key id="claude-code:ask-yes" strong /></Button>
        {e.always && <Button className={BIG} disabled={busy} data-answer="always" data-tip={`From now on in this project: ${e.always}`} onClick={acts.also}>
          Always allow<Key id="claude-code:ask-also" /></Button>}
        <Button look="quiet" className={BIG} disabled={busy} data-answer="deny" onClick={acts.no}>Deny<Key id="claude-code:ask-no" /></Button>
      </Actions>
    </>
  )
}

function Plan({ text, busy, acts }: { text: string } & Answering) {
  return (
    <>
      <div className="chat-plan chat-ask-x mt-2.5 overflow-y-auto overscroll-contain rounded-control py-3 text-[14px] leading-[22px] max-md:text-[16px] max-md:leading-[24px]">
        <Markdown text={text} className="min-w-0 break-words" />
      </div>
      <Actions>
        <Button look="primary" className={cn(STRONG, BIG)} busy={busy} data-answer="approve-edits" data-tip="Claude makes its edits without asking" onClick={acts.yes}>
          <Check className="size-4 max-md:hidden" />Approve<Key id="claude-code:ask-yes" strong /></Button>
        <Button className={BIG} disabled={busy} data-answer="approve" data-tip="Approve, and Claude asks before each edit" onClick={acts.also}>
          Approve, ask for edits<Key id="claude-code:ask-also" /></Button>
        <Button look="quiet" className={BIG} disabled={busy} data-answer="keep" onClick={acts.no}>Keep planning<Key id="claude-code:ask-no" /></Button>
      </Actions>
    </>
  )
}

function splitPlan(plan: string): { title: string; body: string } {
  const m = /^\s*#{1,6}\s+(.+?)\s*#*\s*\n/.exec(plan)
  if (!m) return { title: "Claude's plan", body: plan }
  const t = m[1].replace(/[*_`]/g, "").trim()
  return { title: /^(the )?plan$/i.test(t) ? "Claude's plan" : t, body: plan.slice(m[0].length) }
}

