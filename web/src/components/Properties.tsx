import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { Braces, Calendar, CalendarClock, ChevronRight, Forward, Hash, Link, List, Plus, SquareCheck, Tags, Text, X, type LucideIcon } from "lucide-react"
import { PROP_TYPES, typeOf, typeProblem, type PropType, type PropTypes } from "../../../core/proptypes.ts"
import { getStore, optimistic, stampMs } from "@/core/data"
import { editorSettings, PROPERTIES_SHOWN, showPropertiesAs } from "@/core/editorPrefs"
import { get, op } from "@/core/http"
import { fieldSuggestions, typesOf, valuesOf, vocabOf } from "@/core/vocab"
import { useSuggest } from "@/components/Suggest"
import { Markdown } from "@/components/Markdown"
import { fromLocal, propKind, readProps, renameProp, setProp, toLocal, typedNumber, type PropKind } from "@/core/frontmatter"
import { menuBelow, menuFor, type MenuItem } from "@/components/ContextMenu"
import { Switch } from "@/components/kit"
import { keepPropsOpen, propsOpen } from "@/core/viewstate"
import { useDraft, useStateFor } from "@/core/statefor"
import { cn, plural } from "@/lib/utils"
import { glide } from "@/core/animation"

type Suggestions = { list: () => [string, number][]; has?: string[]; load?: () => void }

const LINKS = /\[\[[^\]\n]+\]\]|https?:\/\/[^\s<>"'\])]+/g
const hasLinks = (s: string) => s.search(LINKS) >= 0
function Linked({ text, from }: { text: string; from?: string }) {
  const parts: ReactNode[] = []
  let at = 0
  for (const m of text.matchAll(LINKS)) {
    if (m.index > at) parts.push(text.slice(at, m.index))
    parts.push(<Markdown key={m.index} inline text={m[0]} from={from} />)
    at = m.index + m[0].length
  }
  return <>{parts}{text.slice(at)}</>
}

function Field({ value, onCommit, readOnly, placeholder, className, inputMode, autoFocus, type, step, suggest, from }: {
  value: string; onCommit: (v: string) => void; readOnly: boolean; placeholder?: string; className?: string
  inputMode?: "text" | "decimal"; autoFocus?: boolean; type?: "date" | "datetime-local"; step?: number; suggest?: Suggestions
  from?: string
}) {
  const [v, setV] = useDraft(value)
  const [editing, setEditing] = useState(false)
  const commit = () => { setEditing(false); if (v !== value) onCommit(v) }
  const s = useSuggest(v, setV, (t) => (suggest && (t !== value || !t) ? fieldSuggestions(suggest.list(), t, suggest.has) : null), {
    completesOnly: true,
    onPick: (next) => { setV(next); if (next !== value) onCommit(next) },
    onFocus: () => suggest?.load?.(),
    onBlur: commit,
    onKeyDown: (e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur() } if (e.key === "Escape") { setV(value); e.currentTarget.blur() } },
  })
  const linked = from !== undefined && !type && hasLinks(value)
  if (readOnly) {
    return <div className={cn("min-h-8 px-1.5 py-1.5 text-[15px] leading-5 break-words", !value && "text-muted-foreground", className)}>{linked ? <Linked text={value} from={from} /> : value || placeholder}</div>
  }
  if (linked && !editing && !autoFocus) {
    return (
      <div role="textbox" tabIndex={0} aria-readonly={false} data-prop-linked onClick={() => setEditing(true)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setEditing(true) } }}
        className={cn("min-h-8 cursor-text rounded-[6px] px-1.5 py-1.5 text-[15px] leading-5 break-words outline-none hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.06] max-md:min-h-11 max-md:py-3", className)}>
        <Linked text={value} from={from} />
      </div>
    )
  }
  return (
    <>
      <input value={v} readOnly={readOnly} placeholder={placeholder} inputMode={inputMode} spellCheck={false} autoFocus={autoFocus || editing} type={type} step={step}
        onChange={(e) => setV(e.target.value)} {...(suggest ? s.input : { onBlur: s.input.onBlur, onKeyDown: s.input.onKeyDown })}
        className={cn("h-8 w-full min-w-0 rounded-[6px] bg-transparent px-1.5 text-[15px] outline-none max-md:h-11 placeholder:text-muted-foreground",
          !readOnly && "hover:bg-foreground/[0.04] focus:bg-foreground/[0.06]", className)} />
      {s.list}
    </>
  )
}

function Chips({ items, onChange, readOnly, suggest, from }: { items: unknown[]; onChange: (v: unknown[]) => void; readOnly: boolean; suggest?: Suggestions; from: string }) {
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
  const s = useSuggest(draft, setDraft, (t) => (suggest ? fieldSuggestions(suggest.list(), t, [...items.map(String), ...(suggest.has ?? [])]) : null), {
    completesOnly: true, onPick: (next) => { onChange([...items, next]); setDraft("") }, onFocus: () => suggest?.load?.(), onBlur: add, onKeyDown: onKey,
  })
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1 px-1 py-1 max-md:min-h-11">
      {items.map((x, i) => (
        <span key={`${i}-${String(x)}`} className="flex min-h-6 max-w-full items-center gap-0.5 rounded-[12px] bg-muted pr-1 pl-2.5 text-[13px] leading-[18px] max-md:min-h-8 max-md:rounded-[16px] max-md:text-[15px]">
          <span className="min-w-0 py-[3px] break-words"><Linked text={String(x)} from={from} /></span>
          {!readOnly && (
            <button type="button" aria-label={`Remove ${String(x)}`} onClick={() => onChange(items.filter((_, k) => k !== i))}
              className="relative grid size-5 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground max-md:after:absolute max-md:after:-inset-3">
              <X className="size-3" strokeWidth={2.5} />
            </button>
          )}
          {readOnly && <span className="w-1.5" />}
        </span>
      ))}
      {!readOnly && (
        <input value={draft} onChange={(e) => setDraft(e.target.value)} {...s.input} placeholder={items.length ? "" : "Add"}
          aria-label="Add an item" spellCheck={false}
          className="h-6 w-20 min-w-0 flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-muted-foreground max-md:h-8 max-md:min-w-16 max-md:text-[15px]" />
      )}
      {s.list}
    </div>
  )
}

function summary(v: unknown): string {
  if (Array.isArray(v)) return plural(v.length, "item")
  if (v && typeof v === "object") return Object.entries(v).map(([k, x]) => `${k}: ${typeof x === "object" ? "…" : String(x)}`).join(", ")
  return String(v ?? "")
}

const isKeptStamp = (stamps: string[], k: string, v: unknown) => stamps.includes(k) && typeof v === "string" && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(v)

const ICONS: Record<PropType | PropKind, LucideIcon> = {
  text: Text, list: List, number: Hash, checkbox: SquareCheck, date: Calendar, datetime: CalendarClock, tags: Tags, aliases: Forward,
  link: Link, complex: Braces,
}
const LABELS: Record<PropType, string> = {
  text: "Text", list: "List", number: "Number", checkbox: "Checkbox", date: "Date", datetime: "Date and time", tags: "Tags", aliases: "Aliases", link: "Link",
}

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

function TypeButton({ k, v, types, readOnly, stamp }: { k: string; v: unknown; types?: { types: PropTypes; own: string[] }; readOnly: boolean; stamp?: boolean }) {
  const declared = typeOf(types?.types, k)
  const Icon = ICONS[declared ?? (stamp ? "datetime" : propKind(v))]
  const label = declared ? `${k}: ${LABELS[declared].toLowerCase()}` : `${k}: no type set`
  if (readOnly) return <span className="grid size-8 shrink-0 place-items-center text-tertiary" aria-hidden><Icon className="size-4" strokeWidth={2} /></span>
  const set = (type: PropType | "none") => optimistic((s) => {
    const was = s.propertyTypes ?? { types: {}, own: [] }, other = (x: string) => x.toLowerCase() !== k.toLowerCase()
    const types: PropTypes = Object.fromEntries(Object.entries(was.types).filter(([x]) => other(x)))
    if (type !== "none") types[k] = type
    return { ...s, propertyTypes: { types, own: [...was.own.filter(other), ...(type === "none" ? [] : [k])] } }
  }, () => op("property.type", { key: k, type }), "Couldn't set its type").catch(() => {})
  const own = !!types?.own.some((x) => x.toLowerCase() === k.toLowerCase())
  const open = (e: MouseEvent) => menuBelow(e, [
    { label: `The type of ${k} in every file`, caption: true, run: () => {} },
    ...PROP_TYPES.map((t) => ({ label: LABELS[t], icon: ICONS[t], checked: declared === t, run: () => { if (declared !== t) void set(t) } })),
    ...(own ? [{ label: "No type: each value its own", sep: true, run: () => void set("none") }] : []),
  ])
  return (
    <button type="button" aria-label={label} data-tip={label} data-prop-type={declared ?? ""} onClick={open}
      className="relative grid size-8 shrink-0 cursor-pointer place-items-center rounded-[6px] text-tertiary hover:bg-foreground/[0.04] hover:text-foreground max-md:mt-1.5 max-md:after:absolute max-md:after:-inset-1.5">
      <Icon className="size-4" strokeWidth={2} />
    </button>
  )
}

function Value({ k, v, set, readOnly, autoFocus, type, stamps, suggest, from }: {
  k: string; v: unknown; set: (v: unknown) => void; readOnly: boolean; autoFocus?: boolean; type: PropType | null; stamps: string[]; suggest?: Suggestions; from: string
}) {
  if (isKeptStamp(stamps, k, v)) {
    const d = new Date(stampMs(v as string))
    return (
      <div className="truncate px-1.5 py-1.5 text-[15px] leading-5 text-muted-foreground tabular-nums" data-tip={v as string}>
        {d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
      </div>
    )
  }
  const empty = v === null || v === undefined || v === ""
  switch (typedKind(type, v) ?? propKind(v)) {
    case "checkbox":
      return <div className="flex h-8 items-center px-1.5 max-md:h-11"><Switch on={v === true} onChange={(x) => set(x)} label={k} disabled={readOnly} /></div>
    case "number":
      return <Field value={empty ? "" : String(v)} readOnly={readOnly} inputMode="decimal" className="num" placeholder={empty ? "Empty" : undefined}
        onCommit={(s) => set(typedNumber(s))} />
    case "list":
      return <Chips items={Array.isArray(v) ? v : empty ? [] : [v]} readOnly={readOnly} onChange={(x) => set(x)} suggest={suggest} from={from} />
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
    onCommit={(s) => set(s)} suggest={suggest} from={from} />
}

const vaultNames = (): [string, number][] =>
  ((getStore() as { properties?: { key: string; count: number }[] } | null)?.properties ?? []).map((p) => [p.key, p.count])
const vaultTags = (): [string, number][] => { const files = getStore()?.files.files; return files ? vocabOf(files).tags : [] }
const asked = new Map<string, { files: unknown; rows: { path: string; value: unknown }[] }>()

function useVaultValues(path: string) {
  const [, redraw] = useState(0)
  return (k: string): Suggestions => ({
    list: () => {
      const files = getStore()?.files.files, types = files ? typesOf(files) : null, mine = types?.get(path)
      return valuesOf(asked.get(k)?.rows ?? [], path, (p) => !!mine && types!.get(p) === mine)
    },
    load: () => {
      const files = getStore()?.files.files, had = asked.get(k)
      if (had?.files === files) return
      asked.set(k, { files, rows: had?.rows ?? [] })
      get<{ path: string; value: unknown }[]>(`properties?key=${encodeURIComponent(k)}`)
        .then((rows) => { asked.set(k, { files, rows }); redraw((n) => n + 1) }, () => {})
    },
  })
}

function NewKey({ has, add, cancel }: { has: string[]; add: (k: string) => void; cancel: () => void }) {
  const [v, setV] = useState("")
  const s = useSuggest(v, setV, (t) => fieldSuggestions(vaultNames(), t, has), {
    completesOnly: true, onPick: add, onBlur: () => add(v),
    onKeyDown: (e) => { if (e.key === "Enter") add(v); if (e.key === "Escape") cancel() },
  })
  return (
    <>
      <input value={v} onChange={(e) => setV(e.target.value)} {...s.input} autoFocus placeholder="Property name" spellCheck={false} aria-label="New property name"
        className="mt-1 h-8 w-[160px] rounded-[6px] bg-foreground/[0.06] px-1.5 text-[15px] outline-none max-md:h-11" />
      {s.list}
    </>
  )
}

const shownMenu = (): MenuItem[] => {
  const now = editorSettings().propertiesInDocument
  return [
    { label: "Properties in every note", caption: true, run: () => {} },
    ...PROPERTIES_SHOWN.map(({ value, label }) => ({ label: value === "source" ? "As text while editing" : label, checked: now === value, run: () => showPropertiesAs(value) })),
  ]
}

export const Properties = memo(function Properties({ path, block, onChange, readOnly, types, stamps = [] }: {
  path: string
  block: string; onChange: (block: string) => void; readOnly: boolean
  types?: { types: PropTypes; own: string[] }
  stamps?: string[]
}) {
  const { props, error } = readProps(block)
  const keys = Object.keys(props)
  const [open, setOpenState] = useStateFor([path], () => propsOpen(path))
  const setOpen = (o: boolean) => { setOpenState(o); keepPropsOpen(path, o) }
  const box = useRef<HTMLElement>(null)
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail !== path) return
      setOpenState(true)
      requestAnimationFrame(() => box.current?.scrollIntoView({ block: "nearest", behavior: glide() }))
    }
    addEventListener("vau:properties", on)
    return () => removeEventListener("vau:properties", on)
  }, [path, setOpenState])
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState<string | null>(null)
  const values = useVaultValues(path)
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
      <button type="button" onClick={() => setOpen(!open)} onContextMenu={menuFor(shownMenu)} aria-expanded={open}
        className="-ml-1.5 flex h-8 cursor-pointer items-center gap-1 rounded-[6px] px-1.5 text-[13px] font-semibold text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground max-md:h-11 max-md:text-[15px]">
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} strokeWidth={2.5} />
        Properties{keys.length ? <span className="font-normal">{keys.length}</span> : null}
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
                    <TypeButton k={k} v={props[k]} types={types} readOnly={readOnly} stamp={isKeptStamp(stamps, k, props[k])} />
                    {readOnly ? (
                      <span className="truncate px-1.5 py-1.5 text-[15px] leading-5 text-muted-foreground">{k}</span>
                    ) : (
                      <Field value={k} readOnly={false} className="text-muted-foreground" suggest={{ list: vaultNames, has: keys }}
                        onCommit={(to) => { if (to.trim() && to !== k) onChange(renameProp(block, k, to.trim())) }} />
                    )}
                  </div>
                  <div role="cell" className="flex min-w-0 items-start">
                    <div className="min-w-0 flex-1">
                      <Value k={k} v={props[k]} type={type} stamps={stamps} readOnly={readOnly} autoFocus={k === added} from={path} set={(v) => onChange(setProp(block, k, v))}
                        suggest={type === "tags" ? { list: vaultTags } : type === "aliases" ? undefined : values(k)} />
                      {why && <p className="px-1.5 pb-1 text-[13px] leading-[18px] text-muted-foreground" data-prop-note={k}>{k} {why}</p>}
                    </div>
                    {!readOnly && (
                      <button type="button" aria-label={`Remove ${k}`} onClick={() => onChange(setProp(block, k, undefined))}
                        className="relative mt-1 grid size-6 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 pointer-coarse:opacity-60 max-md:mt-2.5 max-md:after:absolute max-md:after:-inset-2.5">
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
            <NewKey has={keys} add={addKey} cancel={() => setAdding(false)} />
          ) : (
            <button type="button" onClick={() => setAdding(true)}
              className="mt-1 flex h-8 cursor-pointer items-center gap-1.5 rounded-[6px] px-1.5 text-[15px] text-muted-foreground max-md:h-11 hover:bg-foreground/[0.04] hover:text-foreground">
              <Plus className="size-4" strokeWidth={2.25} />Add property
            </button>
          ))}
        </div>
      )}
    </section>
  )
})
