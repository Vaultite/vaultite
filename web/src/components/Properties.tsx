// A file's properties: a row per key edited in place, each change rewriting only its own line; a key's input is its
// vault-wide type's (core/proptypes.ts) when it has one. Nested values are shown and edited in source mode.
import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { Braces, Calendar, CalendarClock, ChevronRight, Forward, Hash, Link, List, Plus, SquareCheck, Tags, Text, X, type LucideIcon } from "lucide-react"
import { PROP_TYPES, typeOf, typeProblem, type PropType, type PropTypes } from "../../../core/proptypes.ts"
import { op } from "@/core/http"
import { fromLocal, propKind, readProps, renameProp, setProp, toLocal, typedNumber, type PropKind } from "@/core/frontmatter"
import { notifyError } from "@/core/notify"
import { menuBelow } from "@/components/ContextMenu"
import { Switch } from "@/components/kit"
import { keepPropsOpen, propsOpen } from "@/core/viewstate"
import { cn } from "@/lib/utils"

function Field({ value, onCommit, readOnly, placeholder, className, inputMode, autoFocus, type, step }: {
  value: string; onCommit: (v: string) => void; readOnly: boolean; placeholder?: string; className?: string
  inputMode?: "text" | "decimal"; autoFocus?: boolean; type?: "date" | "datetime-local"; step?: number
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => { if (v !== value) onCommit(v) }
  // Read-only (reading, or a file that can't be changed): the whole value as text, wrapped, never cut off mid-word.
  if (readOnly) {
    return <div className={cn("min-h-8 px-1.5 py-1.5 text-[15px] leading-5 break-words", !value && "text-muted-foreground", className)}>{value || placeholder}</div>
  }
  return (
    <input value={v} readOnly={readOnly} placeholder={placeholder} inputMode={inputMode} spellCheck={false} autoFocus={autoFocus} type={type} step={step}
      onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur() } if (e.key === "Escape") { setV(value); (e.target as HTMLInputElement).blur() } }}
      className={cn("h-8 w-full min-w-0 rounded-[6px] bg-transparent px-1.5 text-[15px] outline-none placeholder:text-muted-foreground",
        !readOnly && "hover:bg-foreground/[0.04] focus:bg-foreground/[0.06]", className)} />
  )
}

function Chips({ items, onChange, readOnly }: { items: unknown[]; onChange: (v: unknown[]) => void; readOnly: boolean }) {
  const [draft, setDraft] = useState("")
  const add = () => {
    const parts = draft.split(",").map((s) => s.trim()).filter(Boolean)
    if (parts.length) onChange([...items, ...parts])
    setDraft("")
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add() }
    if (e.key === "Backspace" && !draft && items.length) onChange(items.slice(0, -1))
  }
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1 px-1 py-1">
      {items.map((x, i) => (
        <span key={`${i}-${String(x)}`} className="flex min-h-6 max-w-full items-center gap-0.5 rounded-[12px] bg-muted pr-1 pl-2.5 text-[13px] leading-[18px]">
          <span className="min-w-0 py-[3px] break-words">{String(x)}</span>
          {!readOnly && (
            <button type="button" aria-label={`Remove ${String(x)}`} onClick={() => onChange(items.filter((_, k) => k !== i))}
              className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground">
              <X className="size-3" strokeWidth={2.5} />
            </button>
          )}
          {readOnly && <span className="w-1.5" />}
        </span>
      ))}
      {!readOnly && (
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={add} placeholder={items.length ? "" : "Add"}
          aria-label="Add an item" spellCheck={false}
          className="h-6 w-20 min-w-0 flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-muted-foreground" />
      )}
    </div>
  )
}

function summary(v: unknown): string {
  if (Array.isArray(v)) return `${v.length} ${v.length === 1 ? "item" : "items"}`
  if (v && typeof v === "object") return Object.entries(v).map(([k, x]) => `${k}: ${typeof x === "object" ? "…" : String(x)}`).join(", ")
  return String(v ?? "")
}

/** A UTC time the file's kind keeps (its `stamps`: a note's created), shown in local time with what's stored in the
 *  tooltip; the app keeps it, so it isn't edited here. Any other key's value is the user's, whatever its name. */
const utc = (stamps: string[], k: string, v: unknown) => stamps.includes(k) && typeof v === "string" && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(v)

/** Each type's icon, and a value's own when the key has none. */
const ICONS: Record<PropType | PropKind, LucideIcon> = {
  text: Text, list: List, number: Hash, checkbox: SquareCheck, date: Calendar, datetime: CalendarClock, tags: Tags, aliases: Forward,
  link: Link, complex: Braces,
}
const LABELS: Record<PropType, string> = {
  text: "Text", list: "List", number: "Number", checkbox: "Checkbox", date: "Date", datetime: "Date and time", tags: "Tags", aliases: "Aliases", link: "Link",
}

/** The input a declared type draws, when the value is empty or of it; else null (the value's own, with a note). */
function typedKind(type: PropType | null, v: unknown): PropKind | "datetime" | null {
  if (!type || (v !== null && v !== undefined && v !== "" && typeProblem(type, v))) return null
  switch (type) {
    case "number": return "number"
    case "checkbox": return "checkbox"
    case "date": return "date"
    case "datetime": return "datetime"
    case "list": case "tags": case "aliases": return "list"
    default: return "text"
  }
}

/** The icon before a key: its type (declared, else its value's); editable, a click sets the key's type for the vault. */
function TypeButton({ k, v, types, readOnly }: { k: string; v: unknown; types?: { types: PropTypes; own: string[] }; readOnly: boolean }) {
  const declared = typeOf(types?.types, k)
  const Icon = ICONS[declared ?? propKind(v)]
  const label = declared ? `${k}: ${LABELS[declared].toLowerCase()}` : `${k}: no type set`
  if (readOnly) return <span className="grid size-8 shrink-0 place-items-center text-tertiary" aria-hidden><Icon className="size-4" strokeWidth={2} /></span>
  const set = (type: PropType | "none") => op("property.type", { key: k, type }).catch((e) => notifyError(e, "Couldn't set its type"))
  const own = !!types?.own.some((x) => x.toLowerCase() === k.toLowerCase())
  const open = (e: MouseEvent) => menuBelow(e, [
    { label: `The type of ${k} in every file`, caption: true, run: () => {} },
    ...PROP_TYPES.map((t) => ({ label: LABELS[t], icon: ICONS[t], checked: declared === t, run: () => { if (declared !== t) void set(t) } })),
    ...(own ? [{ label: "No type: each value its own", sep: true, run: () => void set("none") }] : []),
  ])
  return (
    <button type="button" aria-label={label} data-tip={label} data-prop-type={declared ?? ""} onClick={open}
      className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-[6px] text-tertiary hover:bg-foreground/[0.04] hover:text-foreground">
      <Icon className="size-4" strokeWidth={2} />
    </button>
  )
}

function Value({ k, v, set, readOnly, autoFocus, type, stamps }: {
  k: string; v: unknown; set: (v: unknown) => void; readOnly: boolean; autoFocus?: boolean; type: PropType | null; stamps: string[]
}) {
  if (utc(stamps, k, v)) {
    const d = new Date(`${(v as string).replace(" ", "T")}Z`)
    return (
      <div className="truncate px-1.5 py-1.5 text-[15px] leading-5 text-muted-foreground tabular-nums" data-tip={`${v as string} UTC`}>
        {d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
      </div>
    )
  }
  const empty = v === null || v === undefined || v === ""
  switch (typedKind(type, v) ?? propKind(v)) {
    case "checkbox":
      return <div className="flex h-8 items-center px-1.5"><Switch on={v === true} onChange={(x) => set(x)} label={k} disabled={readOnly} /></div>
    case "number":
      return <Field value={empty ? "" : String(v)} readOnly={readOnly} inputMode="decimal" className="num" placeholder={empty ? "Empty" : undefined}
        onCommit={(s) => set(typedNumber(s))} />
    case "list":
      return <Chips items={Array.isArray(v) ? v : empty ? [] : [v]} readOnly={readOnly} onChange={(x) => set(x)} />
    case "date":
      if (!type) break
      return <Field value={empty ? "" : String(v)} readOnly={readOnly} type="date" placeholder="Empty" className="num" onCommit={(s) => set(s || null)} />
    case "datetime": {
      const was = empty ? "" : String(v), local = toLocal(was)
      return <Field value={local} readOnly={readOnly} type="datetime-local" step={local.length > 16 ? 1 : undefined} placeholder="Empty" className="num"
        onCommit={(s) => set(s ? fromLocal(s, was) : null)} />
    }
    case "complex":
      return <div className="truncate px-1.5 py-1.5 text-[15px] leading-5 text-muted-foreground" data-tip="Edit this in source mode">{summary(v)}</div>
  }
  return <Field value={v === null || v === undefined ? "" : String(v)} readOnly={readOnly} placeholder="Empty" autoFocus={autoFocus}
    onCommit={(s) => set(s)} />
}

export const Properties = memo(function Properties({ path, block, onChange, readOnly, extra, types, stamps = [] }: {
  /** The file they're of: whether they're open is remembered for it (core/viewstate.ts). */
  path: string
  /** The frontmatter block ("---\n...\n---\n", or ""). */
  block: string; onChange: (block: string) => void; readOnly: boolean
  /** Shown next to the title (a plugin's note that its header shows these). */
  extra?: ReactNode
  /** The vault's property types (the store's `propertyTypes`). */
  types?: { types: PropTypes; own: string[] }
  /** The UTC times its kind keeps (KindSpec stamps): shown in local time, not edited. */
  stamps?: string[]
}) {
  const { props, error } = readProps(block)
  const keys = Object.keys(props)
  // Folded to their heading by default; open them once and that file keeps them open (on this device).
  const [open, setOpenState] = useState(() => propsOpen(path))
  useEffect(() => setOpenState(propsOpen(path)), [path])
  const setOpen = (o: boolean) => { setOpenState(o); keepPropsOpen(path, o) }
  // A block's "This file's properties": open, and in view.
  const box = useRef<HTMLElement>(null)
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail !== path) return
      setOpenState(true)
      requestAnimationFrame(() => box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }))
    }
    addEventListener("vau:properties", on)
    return () => removeEventListener("vau:properties", on)
  }, [path])
  const [adding, setAdding] = useState(false)
  // A property just added: its value is typed next.
  const [added, setAdded] = useState<string | null>(null)
  const newKey = useRef<HTMLInputElement>(null)
  useEffect(() => { if (adding) newKey.current?.focus() }, [adding])
  if (!keys.length && !error && readOnly) return null
  const addKey = (name: string) => {
    const k = name.trim().replace(/:$/, "")
    setAdding(false)
    if (!k || k in props) return
    setAdded(k)
    onChange(setProp(block, k, ""))
  }
  return (
    <section ref={box} aria-label="Properties" className="mb-4">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="-ml-1.5 flex h-8 cursor-pointer items-center gap-1 rounded-[6px] px-1.5 text-[13px] font-semibold text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground">
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} strokeWidth={2.5} />
        Properties{keys.length ? <span className="font-normal">{keys.length}</span> : null}
        {extra}
      </button>
      {open && (
        <div className="mt-1">
          {error ? (
            <p className="text-[15px] text-muted-foreground">These properties can't be read ({error}). Fix them in source mode.</p>
          ) : (
            <div role="table" className="grid grid-cols-[minmax(92px,min(160px,32%))_minmax(0,1fr)] gap-x-2">
              {keys.map((k) => {
                const type = typeOf(types?.types, k)
                const why = type && typeProblem(type, props[k])
                return (
                <div role="row" key={k} className="group contents">
                  <div role="rowheader" className="flex min-w-0 items-start">
                    <TypeButton k={k} v={props[k]} types={types} readOnly={readOnly} />
                    {readOnly ? (
                      <span className="truncate px-1.5 py-1.5 text-[15px] leading-5 text-muted-foreground">{k}</span>
                    ) : (
                      <Field value={k} readOnly={false} className="text-muted-foreground"
                        onCommit={(to) => { if (to.trim() && to !== k) onChange(renameProp(block, k, to.trim())) }} />
                    )}
                  </div>
                  <div role="cell" className="flex min-w-0 items-start">
                    <div className="min-w-0 flex-1">
                      <Value k={k} v={props[k]} type={type} stamps={stamps} readOnly={readOnly} autoFocus={k === added} set={(v) => onChange(setProp(block, k, v))} />
                      {why && <p className="px-1.5 pb-1 text-[13px] leading-[18px] text-muted-foreground" data-prop-note={k}>{k} {why}</p>}
                    </div>
                    {!readOnly && (
                      <button type="button" aria-label={`Remove ${k}`} onClick={() => onChange(setProp(block, k, undefined))}
                        className="mt-1 grid size-6 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100">
                        <X className="size-3.5" strokeWidth={2.5} />
                      </button>
                    )}
                  </div>
                </div>
                )
              })}
            </div>
          )}
          {!readOnly && !error && (adding ? (
            <input ref={newKey} placeholder="Property name" spellCheck={false} aria-label="New property name"
              onBlur={(e) => addKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addKey((e.target as HTMLInputElement).value); if (e.key === "Escape") setAdding(false) }}
              className="mt-1 h-8 w-[160px] rounded-[6px] bg-foreground/[0.06] px-1.5 text-[15px] outline-none" />
          ) : (
            <button type="button" onClick={() => setAdding(true)}
              className="mt-1 flex h-8 cursor-pointer items-center gap-1.5 rounded-[6px] px-1.5 text-[15px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground">
              <Plus className="size-4" strokeWidth={2.25} />Add property
            </button>
          ))}
        </div>
      )}
    </section>
  )
})
