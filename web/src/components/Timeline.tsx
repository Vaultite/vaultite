// A `## Timeline` section drawn newest first. Add writes a line through the server (placed by date, as an AI's would
// be), and the change comes back into the editor like any other.
import { useState, type FormEvent } from "react"
import { Circle, Plus, StickyNote } from "lucide-react"
import type { TimelineKind } from "@/core/define"
import { fmtDay, fmtMin, today } from "@/core/data"
import { post } from "@/core/http"
import { notifyError } from "@/core/notify"
import { CONTACT_KINDS, parseTimeline, strayLines, type Entry } from "../../../core/timeline.ts"
import { useSheetGuard } from "@/components/DetailSheet"
import { Empty, List } from "@/components/kit"
import { Markdown } from "@/components/Markdown"
import { capitalize, cn } from "@/lib/utils"

const NOTE: TimelineKind = { label: "Note", icon: StickyNote }

/** `path`: the file it's in, which Add writes to (left out, or read-only: no Add). */
export function TimelineSection({ text, title, kinds, path }: { text: string; title: string; kinds: Record<string, TimelineKind>; path?: string }) {
  const items = parseTimeline(text).sort((a, b) => b.date.localeCompare(a.date))
  // Lines that aren't entries (no date) are drawn as they are, after them: nothing typed there is hidden.
  const stray = strayLines(text)
  const [shown, setShown] = useState(25)
  const [adding, setAdding] = useState(false)
  return (
    <div className="file-timeline">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-[20px] leading-[25px] font-bold">{title}</h2>
        {path && !adding && (
          <button type="button" onClick={() => setAdding(true)}
            className="-mr-2 flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-[6px] px-2 text-[15px] text-primary hover:bg-foreground/[0.06] md:min-h-7 md:text-[13px]">
            <Plus className="size-4" strokeWidth={2.25} />Add
          </button>
        )}
      </div>
      {path && adding && <AddEntry path={path} kinds={kinds} close={() => setAdding(false)} />}
      {!items.length ? (!stray.length && !adding && <Empty>Nothing yet.</Empty>) : (
        <List>{items.slice(0, shown).map((i, n) => <EntryRow key={`${i.date}-${n}`} i={i} kinds={kinds} />)}</List>
      )}
      {items.length > shown && (
        <button type="button" onClick={() => setShown(items.length)} className="min-h-11 cursor-pointer text-[15px] text-primary hover:underline">
          Show all {items.length}
        </button>
      )}
      {!!stray.length && <div className="mt-2 text-[15px] text-muted-foreground"><Markdown text={stray.join("\n")} /></div>}
    </div>
  )
}

/** Add to a file's timeline where it has none yet (a person's profile): the same form, and the line comes with its
 *  `## Timeline` section (the server makes it at the file's end). */
export function AddToTimeline({ path, kinds }: { path: string; kinds: Record<string, TimelineKind> }) {
  const [adding, setAdding] = useState(false)
  if (adding) return <AddEntry path={path} kinds={kinds} close={() => setAdding(false)} />
  return (
    <button type="button" onClick={() => setAdding(true)}
      className="-ml-2 flex min-h-11 cursor-pointer items-center gap-1 rounded-[6px] px-2 text-[15px] text-primary hover:bg-foreground/[0.06] md:min-h-7 md:text-[13px]">
      <Plus className="size-4" strokeWidth={2.25} />Add to timeline
    </button>
  )
}

const field = "h-11 min-w-0 rounded-[8px] border-[0.5px] border-border bg-card px-2.5 text-[16px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/40 md:h-7.5 md:text-[13px]"

/** The form Add opens: a kind, the day (today), minutes and what it was about. Enter adds, Escape closes. */
function AddEntry({ path, kinds, close }: { path: string; kinds: Record<string, TimelineKind>; close: () => void }) {
  const [kind, setKind] = useState("call")
  const [date, setDate] = useState(today)
  const [min, setMin] = useState("")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const note = kind === "note"
  useSheetGuard(() => notes.trim() ? [notes.trim()] : [])
  const ready = /^\d{4}-\d\d-\d\d$/.test(date) && (!note || !!notes.trim()) && (!min || Number(min) > 0)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    try {
      await post("timeline", { path, date, kind, duration_min: !note && min ? Number(min) : null, notes: notes.trim() })
      close()
    } catch (err) { notifyError(err, "Couldn't add it") } finally { setBusy(false) }
  }
  return (
    <form data-no-edit onSubmit={submit} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close() } }}
      aria-label={`Add to ${path.split("/").pop()!.replace(/\.md$/i, "")}'s timeline`}
      className="mt-1 mb-3 flex flex-col gap-2.5 rounded-[10px] bg-foreground/[0.04] p-3">
      <div role="radiogroup" aria-label="Kind" className="flex flex-wrap gap-1.5">
        {[...CONTACT_KINDS, "note"].map((k) => {
          const d = kinds[k] ?? (k === "note" ? NOTE : { label: capitalize(k), icon: Circle })
          const on = k === kind
          return (
            <button key={k} type="button" role="radio" aria-checked={on} onClick={() => setKind(k)}
              className={cn("flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[15px] md:min-h-7 md:px-2.5 md:text-[13px]",
                on ? cn("font-semibold", !d.tint && "bg-card shadow-[0_1px_3px_rgb(0_0_0/0.12)]") : "text-foreground/80 hover:bg-foreground/[0.06]")}
              style={on && d.tint ? { background: `color-mix(in srgb, ${d.tint} 16%, transparent)`, color: d.tint } : undefined}>
              <d.icon className="size-3.5 shrink-0" strokeWidth={2.25} />{d.label}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Day" className={cn(field, "w-40")} />
        {!note && (
          <label className="flex items-center gap-1.5 text-[15px] text-muted-foreground md:text-[13px]">
            <input type="number" inputMode="numeric" min={1} value={min} onChange={(e) => setMin(e.target.value)} placeholder="0"
              aria-label="Minutes" className={cn(field, "w-20")} />
            min
          </label>
        )}
      </div>
      <input autoFocus value={notes} onChange={(e) => setNotes(e.target.value)} spellCheck
        placeholder={note ? "What to remember" : "What it was about (optional)"} aria-label="Text" className={cn(field, "w-full")} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={close} className="min-h-11 cursor-pointer rounded-[8px] px-3 text-[15px] hover:bg-foreground/[0.06] md:min-h-7 md:text-[13px]">Cancel</button>
        <button type="submit" disabled={!ready || busy}
          className="min-h-11 cursor-pointer rounded-[8px] bg-primary px-4 text-[15px] font-semibold text-primary-foreground disabled:cursor-default disabled:opacity-50 md:min-h-7 md:text-[13px]">Add</button>
      </div>
    </form>
  )
}

/** One entry: a known kind (tinted icon), a note (grey) or anything else (a dot). Full text, no truncation. */
function EntryRow({ i, kinds }: { i: Entry; kinds: Record<string, TimelineKind> }) {
  const note = i.kind === "note"
  const k = kinds[i.kind] ?? (note ? NOTE : { label: capitalize(i.kind), icon: Circle })
  const tint = !note && k.tint
  return (
    <div className="flex gap-3 py-3">
      <span className={cn("mt-px grid size-8 shrink-0 place-items-center rounded-full", !tint && "bg-muted text-muted-foreground")}
        style={tint ? { background: `color-mix(in srgb, ${tint} 16%, transparent)`, color: tint } : undefined}>
        <k.icon className="size-4" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] leading-[20px] font-semibold">
            {k.label}{i.duration_min ? <span className="font-normal text-muted-foreground"> · {fmtMin(i.duration_min)}</span> : null}
          </span>
          <span className="shrink-0 text-[13px] text-muted-foreground">{fmtDay(i.date)}</span>
        </div>
        {i.subject && <div className="text-[15px] leading-[20px] font-medium break-words"><Markdown inline text={i.subject} /></div>}
        {i.notes && <p className="mt-0.5 text-[15px] leading-[20px] break-words whitespace-pre-wrap text-foreground/80"><Markdown inline text={i.notes} /></p>}
        {i.url && (
          <a href={i.url} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-[15px] text-primary hover:underline">
            {i.url.replace(/^https?:\/\/(www\.)?/, "")}
          </a>
        )}
      </div>
    </div>
  )
}
