import { useState, type ReactNode } from "react"
import { ChevronRight, MessageSquarePlus } from "lucide-react"
import { Button, cn, notify } from "@vaultite"
import { type DiffLine, type FileDiff, type Hunk, splitRows } from "./diffparse"
import { addChip } from "./chips"

export type DiffMode = "stacked" | "split"
type Note = { at: string; line: DiffLine } | null
type Ctx = { chat: string; path: string; note: Note; setNote: (n: Note) => void }

const ADD = "bg-[color-mix(in_srgb,var(--green)_14%,transparent)]"
const DEL = "bg-[color-mix(in_srgb,var(--red)_12%,transparent)]"
const tint = (l: DiffLine | null) => (l?.k === "add" ? ADD : l?.k === "del" ? DEL : "")
const sign = (l: DiffLine) => (l.k === "add" ? "+" : l.k === "del" ? "−" : " ")
const lineNo = (l: DiffLine) => l.b ?? l.a ?? 0
const keyOf = (l: DiffLine) => `${l.k}:${l.a ?? ""}:${l.b ?? ""}`
const BIG = 800
const STATUS: Record<FileDiff["status"], string> = { added: "Added", deleted: "Deleted", renamed: "Renamed", modified: "" }

export function DiffFile({ f, mode, chat }: { f: FileDiff; mode: DiffMode; chat: string }) {
  const size = f.hunks.reduce((n, h) => n + h.lines.length, 0)
  const [open, setOpen] = useState(size <= BIG)
  const [note, setNote] = useState<Note>(null)
  const ctx: Ctx = { chat, path: f.path, note, setNote }
  return (
    <section data-diff-file={f.path} className="border-b-[0.5px] border-border">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="sticky top-0 z-[1] flex h-9 w-full cursor-pointer items-center gap-2 bg-background px-3 text-left text-[13px] hover:bg-foreground/[0.03]">
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} strokeWidth={2} />
        <span className="min-w-0 truncate font-medium">{f.from && f.status === "renamed" ? `${f.from} → ${f.path}` : f.path}</span>
        {STATUS[f.status] && <span className="shrink-0 text-tertiary">{STATUS[f.status]}</span>}
        <Counts f={f} />
      </button>
      {open && (f.binary ? <p className="px-9 pb-3 text-[13px] text-muted-foreground">A binary file</p>
        : <div className="overflow-x-auto pb-2 font-mono text-[12px] leading-[19px]">{f.hunks.map((h, n) => <HunkView key={n} h={h} mode={mode} ctx={ctx} />)}</div>)}
    </section>
  )
}

export function Counts({ f }: { f: { added: number; removed: number } }) {
  return (
    <span className="ml-auto flex shrink-0 gap-1.5 text-[12px] tabular-nums">
      <span className="text-ink-(--green)">+{f.added}</span><span className="text-ink-(--red)">−{f.removed}</span>
    </span>
  )
}

function HunkView({ h, mode, ctx }: { h: Hunk; mode: DiffMode; ctx: Ctx }) {
  return (
    <div data-hunk>
      <div className="bg-foreground/[0.03] px-3 py-0.5 text-tertiary select-none">{h.head}</div>
      {mode === "split" ? splitRows(h).map((r, n) => <Commented key={n} at={`s${n}`} line={r.right ?? r.left} ctx={ctx}>
        <SplitRow left={r.left} right={r.right} ctx={ctx} at={`s${n}`} />
      </Commented>)
        : h.lines.map((l) => <Commented key={keyOf(l)} at={keyOf(l)} line={l} ctx={ctx}><StackedRow l={l} ctx={ctx} at={keyOf(l)} /></Commented>)}
    </div>
  )
}

function Commented({ at, line, ctx, children }: { at: string; line: DiffLine | null; ctx: Ctx; children: ReactNode }) {
  return <>{children}{line && ctx.note?.at === at && <CommentBox line={line} ctx={ctx} />}</>
}

function Gutter({ n }: { n?: number }) {
  return <span aria-hidden className="w-10 shrink-0 pr-2 text-right text-tertiary select-none">{n ?? ""}</span>
}

function NoteButton({ l, ctx, at }: { l: DiffLine; ctx: Ctx; at: string }) {
  return (
    <button type="button" aria-label={`Comment on line ${lineNo(l)}`} data-diff-comment onClick={() => ctx.setNote({ at, line: l })}
      className="grid w-5 shrink-0 cursor-pointer place-items-center text-muted-foreground opacity-0 group-hover/line:opacity-100 focus-visible:opacity-100 hover:text-foreground">
      <MessageSquarePlus className="size-3.5" strokeWidth={2} />
    </button>
  )
}

function StackedRow({ l, ctx, at }: { l: DiffLine; ctx: Ctx; at: string }) {
  return (
    <div data-diff-line={l.k} className={cn("group/line flex min-w-max pr-3 whitespace-pre", tint(l))}>
      <NoteButton l={l} ctx={ctx} at={at} /><Gutter n={l.a} /><Gutter n={l.b} />
      <span aria-hidden className={cn("w-4 shrink-0 select-none", l.k === "add" ? "text-ink-(--green)" : "text-ink-(--red)")}>{sign(l)}</span>
      <span>{l.text || " "}</span>
    </div>
  )
}

function Half({ l }: { l: DiffLine | null }) {
  return (
    <div className={cn("flex min-w-0 flex-1 overflow-hidden whitespace-pre", tint(l), !l && "bg-foreground/[0.02]")}>
      <Gutter n={l ? lineNo(l) : undefined} /><span className="truncate">{l ? l.text || " " : ""}</span>
    </div>
  )
}

function SplitRow({ left, right, ctx, at }: { left: DiffLine | null; right: DiffLine | null; ctx: Ctx; at: string }) {
  const l = right ?? left
  return (
    <div data-diff-split className="group/line flex pr-3">
      {l ? <NoteButton l={l} ctx={ctx} at={at} /> : <span className="w-5 shrink-0" />}
      <Half l={left?.k === "add" ? null : left} /><Half l={right?.k === "del" ? null : right} />
    </div>
  )
}

function CommentBox({ line, ctx }: { line: DiffLine; ctx: Ctx }) {
  const [text, setText] = useState("")
  const add = () => {
    if (!text.trim()) return
    addChip(ctx.chat, { path: ctx.path, line: lineNo(line), text: line.text, comment: text })
    ctx.setNote(null)
    notify("Added to the thread's next message")
  }
  return (
    <div data-diff-note className="my-1 ml-5 max-w-xl rounded-control border-[0.5px] border-border bg-card p-2 font-sans">
      <textarea autoFocus value={text} rows={2} onChange={(e) => setText(e.target.value)} aria-label="Comment"
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add() } else if (e.key === "Escape") ctx.setNote(null) }}
        placeholder={`Comment on line ${lineNo(line)}…`} className="w-full resize-none bg-transparent text-[13px] outline-none placeholder:text-muted-foreground" />
      <div className="mt-1 flex justify-end gap-1.5">
        <Button look="quiet" size="small" onClick={() => ctx.setNote(null)}>Cancel</Button>
        <Button look="secondary" size="small" disabled={!text.trim()} onClick={add} data-diff-note-add>Add to chat</Button>
      </div>
    </div>
  )
}
