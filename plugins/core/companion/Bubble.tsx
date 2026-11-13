import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Check, Pin, TextCursorInput, X } from "lucide-react"
import { Chat, cn, fmtTime, keyHint, Markdown, notifyError, op } from "@vaultite"
import { type Agent, answer, getState, type Note, pin, sawSays, sendMoment, sawShown, subscribe, tintOf, viewOf } from "./live"
import { presence, STATUS } from "../../../core/desktop/cursor"
import { coarse, unsent } from "./overlaykit"
import { posIn } from "./spots"

const placeSay = (id: string) => op("companion.place", { id }).catch((e) => notifyError(e, "Couldn't put it in the note"))

const ICON = "grid size-6 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground [@media(pointer:coarse)]:size-9"

export function SayActions({ n, small }: { n: Note; small?: boolean }) {
  const icon = small ? "size-3" : "size-3.5"
  return <>
    {n.placed ? <TextCursorInput className={cn(icon, "m-1.5 shrink-0 text-muted-foreground")} aria-label="In the note" />
      : <button type="button" aria-label="Put in note" data-tip="Put in note" className={ICON} onClick={(e) => { e.stopPropagation(); void placeSay(n.id) }}><TextCursorInput className={icon} /></button>}
    {n.pinned ? <Pin className={cn(icon, "m-1.5 shrink-0 text-muted-foreground")} aria-label="Pinned" />
      : <button type="button" aria-label="Pin as a comment" data-tip="Pin as a comment" className={ICON} onClick={(e) => { e.stopPropagation(); pin(n.id) }}><Pin className={icon} /></button>}
  </>
}

export function Popover({ a, close, menu, phone }: { a: Agent; close: () => void; menu: (e: React.MouseEvent) => void
  phone?: boolean }) {
  const s = useSyncExternalStore(subscribe, getState)
  const [draft, setDraft] = useState("")
  const mine = s.said.filter((n) => n.agent === a.name)
  useEffect(() => { sawSays(mine.map((n) => n.id)) }, [mine.length])
  const send = () => {
    const text = draft.trim()
    if (!text) return
    const v = a.path ? viewOf(a.path) : null, pos = v ? posIn(v, a) : null
    if (!sendMoment({ kind: "ask", agent: a.name, path: a.path, line: v && pos !== null ? v.state.doc.lineAt(pos).number : a.line, text })) return unsent()
    close()
  }
  return (
    <Chat name={a.name} tint={tintOf(a.name)} items={mine} draft={draft} setDraft={setDraft} send={send} close={close} more={(e) => { close(); menu(e) }}
      words={(n) => <Markdown text={n.text ?? ""} className="companion-md" />} time={(t) => fmtTime(new Date(t).toISOString())} actions={(n) => <SayActions n={n as Note} />}
      busy={a.state === "thinking" || a.state === "reading"} focus={!phone && !coarse.matches} phone={phone} className={phone ? "pointer-events-auto" : "pointer-events-auto absolute top-0 left-0"}
      style={phone ? { width: "100%", maxWidth: "none" } : undefined} />
  )
}

export const CORNER = "data-[side=right]:data-up:rounded-bl-[4px] data-[side=left]:data-up:rounded-br-[4px] data-[side=right]:not-data-up:rounded-tl-[4px] data-[side=left]:not-data-up:rounded-tr-[4px]"

export const readMs = (text: string) => 1500 + text.split(/\s+/).length * 220

export function Bubble({ n, tint, maxWidth, room, drawn, hold }: { n: Note; tint: string; maxWidth: number; drawn: boolean
  room: number
  hold: (on: boolean) => void }) {
  const [replying, setReplying] = useState(!!n.question)
  const [draft, setDraft] = useState("")
  const [inside, setInside] = useState(false)
  const [gone, setGone] = useState(false)
  const box = useRef<HTMLDivElement>(null), field = useRef<HTMLInputElement>(null)
  useEffect(() => { setReplying(!!n.question); setDraft(""); setGone(false) }, [n.id])
  const held = !gone && (inside || !!draft || (replying && !n.question))
  useEffect(() => { hold(held); return () => hold(false) }, [held])
  useEffect(() => { sawShown(n.id) }, [n.id])
  useEffect(() => {
    if (n.seen) return
    const t = setTimeout(() => { if (document.visibilityState === "visible" && document.hasFocus()) sawSays([n.id]) }, readMs(n.text ?? ""))
    return () => clearTimeout(t)
  }, [n.id])
  const send = () => {
    const text = draft.trim()
    if (!text) return
    if (!answer(n.id, "reply", text)) return unsent()
    setDraft("")
    setGone(true)
  }
  const close = () => { answer(n.id, "dismiss"); setGone(true) }
  const open = () => { setReplying(true); requestAnimationFrame(() => field.current?.focus()) }
  if (gone) return null
  return (
    <div ref={box} key={n.id} data-companion-bubble={n.id} data-floats data-question={n.question || undefined} role={n.question ? "group" : undefined} aria-label={n.question ? "A question" : undefined}
      onPointerEnter={(e) => { if (e.pointerType !== "touch") setInside(true) }} onPointerLeave={(e) => { if (e.pointerType !== "touch") setInside(false) }}
      onFocus={() => setInside(true)} onBlur={(e) => { if (!box.current?.contains(e.relatedTarget)) setInside(false) }}
      onClick={(e) => { if (!drawn && !replying && !(e.target instanceof Element && e.target.closest("button, a"))) open() }}
      className={cn("group/bubble companion-pop pointer-events-auto absolute top-0 left-0 flex w-max min-w-[104px] flex-col rounded-[12px] border border-border/60 text-[13.5px] leading-snug text-foreground shadow-lg",
        n.question ? "bg-[color-mix(in_srgb,var(--c)_9%,var(--background))]" : "bg-background", !replying && !drawn && "cursor-text", CORNER)}
      style={{ "--c": tint, maxWidth, boxShadow: `0 0 0 ${n.question ? 2 : 1.5}px color-mix(in srgb, ${tint} ${n.question ? 70 : 45}%, transparent), 0 8px 24px rgba(0,0,0,.12)` } as React.CSSProperties}>
      <div style={{ maxHeight: `min(50vh, 360px, ${room}px)` }} className="edge-fade-y min-w-0 overflow-y-auto overscroll-contain px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Markdown text={n.text ?? ""} className="companion-md" />
      </div>
      {!drawn && (
        <div className={cn("absolute -top-[22px] right-2 z-[1] flex rounded-[8px] border border-border/60 bg-background shadow-sm transition-opacity group-data-[side=left]/bubble:right-auto group-data-[side=left]/bubble:left-2",
          "[@media(pointer:coarse)]:static [@media(pointer:coarse)]:-mt-1 [@media(pointer:coarse)]:justify-end [@media(pointer:coarse)]:border-0 [@media(pointer:coarse)]:bg-transparent [@media(pointer:coarse)]:px-1 [@media(pointer:coarse)]:shadow-none",
          inside || replying ? "opacity-100" : "opacity-0 group-hover/bubble:opacity-100 [@media(pointer:coarse)]:opacity-100")}>
          <SayActions n={n} small />
          <button type="button" aria-label="Close" data-tip={`Close (${keyHint("Escape")})`} className={ICON} onClick={(e) => { e.stopPropagation(); close() }}><X className="size-3" /></button>
        </div>
      )}
      {replying && !drawn && (
        <input ref={field} autoFocus={!n.question} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Reply" aria-label={`Reply to ${n.agent}`} enterKeyHint="send"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
            else if (e.key === "Escape") { e.preventDefault(); if (draft) setDraft(""); else close() }
          }}
          className="mx-1.5 mb-1.5 h-7 min-w-[180px] rounded-[7px] border border-border/70 bg-background px-2 text-[13px] outline-none focus:border-foreground/30 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-[17px]" />
      )}
    </div>
  )
}

export function Fan({ agents, up, right, pop, close, keep }: { agents: Agent[]; up: boolean; right: boolean; pop: (name: string) => void; close: (focusFlag?: boolean) => void; keep: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const move = (e: React.KeyboardEvent, by: number) => {
    const chips = [...box.current!.querySelectorAll<HTMLElement>("button")], i = chips.findIndex((c) => c === document.activeElement)
    e.preventDefault()
    chips[(i + by + chips.length) % chips.length]?.focus()
  }
  return (
    <div ref={box} role="menu" aria-label="Agents here" data-companion-fan onPointerEnter={keep} onPointerLeave={() => close()}
      onKeyDown={(e) => { if (e.key === "ArrowDown") move(e, 1); else if (e.key === "ArrowUp") move(e, -1); else if (e.key === "Escape") { e.preventDefault(); close(true) } }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget) && !e.relatedTarget?.closest("[data-companion-flag]")) close() }}
      className={cn("companion-pop pointer-events-auto absolute flex flex-col gap-1", right ? "right-[-6px] items-end" : "left-[13px] items-start", up ? "bottom-[22px] flex-col-reverse" : "top-[40px]")}>
      {agents.map((x) => (
        <button key={x.name} type="button" role="menuitem" data-agent={x.name} onClick={() => pop(x.name)}
          className="flex h-6 cursor-pointer items-center gap-1 rounded-full px-2 text-[11.5px] font-semibold whitespace-nowrap text-white shadow-sm outline-offset-2 hover:brightness-110 max-sm:h-9 max-sm:px-3 max-sm:text-[14px]"
          style={{ background: `var(--${x.tint})` }}>
          {x.name}<span className="font-medium opacity-85">{x.asks ? "needs you" : STATUS[x.state]}</span>
          <Mark mark={presence(x, { age: 3 }).mark} />
        </button>
      ))}
    </div>
  )
}

export function Mark({ mark, label, at }: { mark: ReturnType<typeof presence>["mark"]; label?: string; at?: number }) {
  if (mark === "dots") return <span className="companion-dots" data-companion-sign="dots" aria-label={label} aria-hidden={!label || undefined}><i /><i /><i /></span>
  if (mark === "wave") return <span className="companion-wave" data-companion-sign="wave" aria-label={label} aria-hidden={!label || undefined}><i /><i /><i /></span>
  if (mark === "tick") return <Check key={at} data-companion-sign="tick" className="companion-seen size-3" strokeWidth={3} aria-label="seen" />
  return null
}