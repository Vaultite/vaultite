// A .json file drawn: fields as rows, nested values folding, lists of records as tables. In live preview a value is
// edited in place, changing only its characters (core/json.ts); the file's shape is edited in source.
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react"
import { ChevronRight, ExternalLink } from "lucide-react"
import { parseJson, setJson, type JNode } from "@/core/json"
import { cn } from "@/lib/utils"
import { dateText } from "@/core/data"
import { modKey } from "@/core/platform"

type Edit = ((node: JNode, next: string | number | boolean | null) => void) | null

export function JsonView({ text, editable, onChange }: { text: string; editable: boolean; onChange: (text: string) => void }) {
  const parsed = useMemo(() => parseJson(text), [text])
  if ("error" in parsed) {
    return (
      <div>
        <p className="mb-3 text-[15px] text-muted-foreground">Not valid JSON ({parsed.error}), so it can't be drawn. Source mode shows its text.</p>
        <pre className="overflow-x-auto rounded-[10px] bg-foreground/[0.04] p-3 font-mono text-[13px] leading-5 whitespace-pre-wrap break-words">{text}</pre>
      </div>
    )
  }
  const edit: Edit = editable ? (node, next) => onChange(setJson(text, node, next)) : null
  const root = parsed.node
  return (
    <div className="json-view text-[15px] leading-5">
      {root.kind === "object" ? (root.entries.length ? <Fields node={root} depth={0} edit={edit} /> : <Faint>No fields</Faint>)
        : root.kind === "array" ? <Items node={root} depth={0} edit={edit} />
        : <Value node={root} edit={edit} />}
    </div>
  )
}

type JObject = Extract<JNode, { kind: "object" }>
type JArray = Extract<JNode, { kind: "array" }>
const isBranch = (n: JNode) => n.kind === "object" || n.kind === "array"
const count = (n: JNode) =>
  n.kind === "object" ? `${n.entries.length} field${n.entries.length === 1 ? "" : "s"}`
  : n.kind === "array" ? `${n.items.length} item${n.items.length === 1 ? "" : "s"}` : ""

function Faint({ children }: { children: ReactNode }) {
  return <span className="text-tertiary italic">{children}</span>
}

/** An object's fields: key on the left, value on the right; objects and lists fold open under their key. */
function Fields({ node, depth, edit }: { node: JObject; depth: number; edit: Edit }) {
  return (
    <div className="hairline">
      {node.entries.map(({ key, value }, i) =>
        isBranch(value) ? <Branch key={i} label={key} node={value} depth={depth} edit={edit} />
          : (
            <div key={i} className="grid min-h-9 grid-cols-[minmax(0,min(11rem,40%))_minmax(0,1fr)] items-baseline gap-4 py-2">
              <span className="truncate text-muted-foreground" data-tip={key} data-tip-trunc>{key}</span>
              <Value node={value} edit={edit} />
            </div>
          ))}
    </div>
  )
}

/** A nested object or list: its key and size, open to start with near the top. */
function Branch({ label, node, depth, edit }: { label: ReactNode; node: JNode; depth: number; edit: Edit }) {
  const [open, setOpen] = useState(depth < 3)
  const empty = node.kind === "object" ? !node.entries.length : node.kind === "array" && !node.items.length
  return (
    <div className="py-1">
      <button type="button" onClick={() => setOpen(!open)} disabled={empty} aria-expanded={open}
        className="-mx-1.5 flex min-h-8 w-[calc(100%+0.75rem)] min-w-0 cursor-pointer items-center gap-1.5 rounded-[6px] px-1.5 text-left hover:bg-foreground/[0.04] disabled:cursor-default disabled:hover:bg-transparent">
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && !empty && "rotate-90", empty && "opacity-0")} strokeWidth={2.5} />
        <span className="min-w-0 truncate font-semibold">{label}</span>
        <span className="shrink-0 text-[13px] text-muted-foreground">{count(node)}</span>
      </button>
      {open && !empty && (
        <div className="mt-1 ml-[6px] border-l-[0.5px] border-border pl-4">
          {node.kind === "object" ? <Fields node={node} depth={depth + 1} edit={edit} /> : <Items node={node as JArray} depth={depth + 1} edit={edit} />}
        </div>
      )}
    </div>
  )
}

/** What names a record in a list: its title, name, label or id. */
function nameOf(n: JNode, i: number): ReactNode {
  if (n.kind === "object") {
    for (const k of ["title", "name", "label", "id"]) {
      const v = n.entries.find((e) => e.key === k)?.value
      if (v && (v.kind === "string" || v.kind === "number") && v.value !== "") return String(v.value)
    }
  }
  return <span className="text-muted-foreground tabular-nums">{i + 1}</span>
}

/** A list: records (objects of mostly plain values) as a table, anything else one row each. */
function Items({ node, depth, edit }: { node: JArray; depth: number; edit: Edit }) {
  const columns = useMemo(() => {
    if (!node.items.length || node.items.some((n) => n.kind !== "object")) return null
    const cols: string[] = []
    let cells = 0, plain = 0
    for (const n of node.items as JObject[]) {
      for (const e of n.entries) {
        if (!cols.includes(e.key)) cols.push(e.key)
        cells++
        if (!isBranch(e.value)) plain++
      }
    }
    return cols.length && plain >= cells * 0.6 ? cols : null
  }, [node])
  if (!node.items.length) return <Faint>Empty list</Faint>
  if (columns) return <Table rows={node.items as JObject[]} columns={columns} edit={edit} />
  return (
    <div className="hairline">
      {node.items.map((n, i) =>
        isBranch(n) ? <Branch key={i} label={nameOf(n, i)} node={n} depth={depth} edit={edit} />
          : (
            <div key={i} className="grid min-h-9 grid-cols-[2rem_minmax(0,1fr)] items-baseline gap-2 py-2">
              <span className="text-[13px] text-tertiary tabular-nums">{i + 1}</span>
              <Value node={n} edit={edit} />
            </div>
          ))}
    </div>
  )
}

function Table({ rows, columns, edit }: { rows: JObject[]; columns: string[]; edit: Edit }) {
  // Long text (a title) gets a wide column that wraps; everything else stays on one line.
  const wide = useMemo(() => new Set(columns.filter((c) => rows.some((r) => {
    const v = r.entries.find((e) => e.key === c)?.value
    return v?.kind === "string" && v.value.length > 40 && !URL_RE.test(v.value)
  }))), [rows, columns])
  return (
    <div className="overflow-x-auto overscroll-x-contain">
      <table className="w-max min-w-full border-collapse text-[14px] leading-5">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} className="border-b-[0.5px] border-border py-1.5 pr-5 text-left text-[13px] font-semibold whitespace-nowrap text-muted-foreground">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const v = r.entries.find((e) => e.key === c)?.value
                return (
                  <td key={c} className={cn("border-b-[0.5px] border-border py-2 pr-5 align-top", wide.has(c) ? "min-w-[14rem] max-w-[20rem]" : "whitespace-nowrap")}>
                    {!v ? null : isBranch(v) ? <span className="text-muted-foreground">{count(v)}</span> : <Value node={v} edit={edit} short />}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- one value ----------

const URL_RE = /^https?:\/\/\S+$/
const DATE_RE = /^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d:?\d\d)?)?$/

/** A date or time written as text, read the way the rest of the app shows dates (in tables, only the day). */
function readDate(s: string, short?: boolean): string | null {
  const m = DATE_RE.exec(s)
  if (!m) return null
  const d = m[4] ? new Date(s) : new Date(+m[1], +m[2] - 1, +m[3])
  if (isNaN(+d)) return null
  const day: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }
  return m[4] && !short ? dateText(d, { ...day, hour: "numeric", minute: "2-digit" }) : dateText(d, day)
}

/** A link without its scheme; in tables only an icon (the link in its tooltip), so the other columns fit. */
function linkText(url: string, short?: boolean): ReactNode {
  if (short) return <ExternalLink className="inline size-4 align-[-3px]" strokeWidth={2} aria-label={url} />
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")
}

function Value({ node, edit, short }: { node: JNode; edit: Edit; short?: boolean }) {
  const [editing, setEditing] = useState(false)
  if (node.kind === "object" || node.kind === "array") return null

  if (node.kind === "boolean") {
    const on = node.value
    return edit ? (
      <button type="button" role="switch" aria-checked={on} onClick={() => edit(node, !on)}
        className="inline-flex cursor-pointer items-center gap-2 text-left">
        <span className="relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors" style={{ background: on ? "var(--green)" : "color-mix(in srgb, var(--muted-foreground) 35%, transparent)" }}>
          <span className={cn("absolute top-[2px] left-[2px] size-[14px] rounded-full bg-white shadow-sm transition-transform", on && "translate-x-[12px]")} />
        </span>
        <span className="text-muted-foreground">{String(on)}</span>
      </button>
    ) : <span style={{ color: on ? "var(--green)" : "var(--muted-foreground)" }}>{String(on)}</span>
  }

  if (editing && edit) {
    const initial = node.kind === "null" ? "" : String(node.value)
    const done = (typed: string | null) => {
      setEditing(false)
      if (typed === null || typed === initial) return
      if (node.kind === "number") {
        // A number stays a number: anything else is dropped.
        if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(typed.trim())) edit(node, Number(typed.trim()))
        return
      }
      if (node.kind === "null") {
        const t = typed.trim()
        if (!t) return
        let v: unknown = t
        try { v = JSON.parse(t) } catch { /* text */ }
        edit(node, v === null || ["string", "number", "boolean"].includes(typeof v) ? (v as string | number | boolean | null) : t)
        return
      }
      edit(node, typed)
    }
    const long = initial.length > 50 || initial.includes("\n")
    const field = "w-full min-w-24 rounded-[6px] bg-card px-1.5 -mx-1.5 py-0.5 -my-0.5 outline-none ring-1 ring-primary/60"
    const keys = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); done(e.currentTarget.value) }
      if (e.key === "Escape") { e.preventDefault(); done(null) }
    }
    return long ? (
      <textarea autoFocus defaultValue={initial} rows={Math.min(8, Math.ceil(initial.length / 60) + initial.split("\n").length - 1)} spellCheck={false}
        onBlur={(e) => done(e.target.value)} onKeyDown={keys} className={cn(field, "block resize-y")} aria-label="Value" />
    ) : (
      <input autoFocus defaultValue={initial} spellCheck={false} inputMode={node.kind === "number" ? "decimal" : undefined}
        onFocus={(e) => e.target.select()} onBlur={(e) => done(e.target.value)} onKeyDown={keys} className={cn(field, "block")} aria-label="Value" />
    )
  }

  let shown: ReactNode
  let tip: string | undefined
  let url: string | null = null
  if (node.kind === "null") shown = <Faint>null</Faint>
  else if (node.kind === "number") shown = <span className="tabular-nums">{String(node.value)}</span>
  else if (node.value === "") shown = <Faint>empty</Faint>
  else if (URL_RE.test(node.value)) { url = node.value; shown = linkText(url, short); if (short) tip = url }
  else {
    const date = readDate(node.value, short)
    if (date) { shown = <span className="tabular-nums">{date}</span>; tip = node.value }
    else shown = node.value
  }

  const text = cn("min-w-0 break-words [overflow-wrap:anywhere]", node.kind === "string" && node.value.includes("\n") && "whitespace-pre-wrap")
  if (!edit) {
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer" data-tip={tip} className={cn(text, "text-primary", !short && "underline decoration-1 underline-offset-[3px]")}>{shown}</a>
    ) : <span className={text} data-tip={tip}>{shown}</span>
  }
  // Live preview: click to change it; a link opens with ⌘-click.
  return (
    <span role="button" tabIndex={0} data-tip={url ? `${short ? `${url}\n` : ""}${modKey}-click to open` : tip}
      onClick={(e) => { if (url && (e.metaKey || e.ctrlKey)) window.open(url, "_blank", "noopener,noreferrer"); else setEditing(true) }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setEditing(true) } }}
      className={cn(text, "-mx-1.5 -my-0.5 cursor-text rounded-[6px] px-1.5 py-0.5 hover:bg-foreground/[0.05]", url && "text-primary")}>
      {shown}
    </span>
  )
}
