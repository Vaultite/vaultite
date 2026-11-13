import { useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Plus } from "lucide-react"
import { cn, FilterField, numberText, parseCsv } from "@vaultite"
import { addRow, setCell } from "./csvedit"

const PAGE = 300
const byText = new Intl.Collator(undefined, { numeric: true })
const NUM = /^\s*[-+]?(?:\$|R\$|€|£)?\s*[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*%?\s*$/
const num = (s: string) => Number(s.replace(/[^\d.+-]/g, ""))

type Row = string[] & { at?: number }

export function CsvView({ text, embed, onChange }: { text: string; embed?: boolean; onChange?: (text: string) => void }) {
  const added = useRef(0)
  const { head, rows, numeric } = useMemo(() => {
    const [h = [], ...all] = parseCsv(text)
    const rs = all.map((r, i): Row => Object.assign(r, { at: i + 1 })).filter((r) => r.length > 1 || r[0] !== "" || r.at === added.current)
    const numeric = h.map((_, j) => {
      const filled = rs.map((r) => r[j] ?? "").filter((v) => v.trim() !== "")
      return filled.length > 0 && filled.filter((v) => NUM.test(v)).length >= filled.length * 0.95
    })
    return { head: h, rows: rs, numeric }
  }, [text])
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)
  const [all, setAll] = useState(false)
  const [editing, setEditing] = useState<{ at: number; col: number } | null>(null)

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    let out = words.length ? rows.filter((r) => { const hay = r.join(" ").toLowerCase(); return words.every((w) => hay.includes(w)) }) : rows
    if (sort) {
      const { col, dir } = sort
      const cmp = numeric[col]
        ? (a: string[], b: string[]) => (num(a[col] ?? "") - num(b[col] ?? "")) * dir
        : (a: string[], b: string[]) => byText.compare(a[col] ?? "", b[col] ?? "") * dir
      out = [...out].sort(cmp)
    }
    return out
  }, [rows, q, sort, numeric])

  if (!head.length) return <p className="text-[15px] text-muted-foreground">An empty table. Source mode shows its text.</p>
  const visible = all || embed ? shown : shown.slice(0, PAGE)
  const save = (at: number, col: number, value: string) => { if (onChange && (parseCsv(text)[at]?.[col] ?? "") !== value) onChange(setCell(text, at, col, value)) }
  const leave = (input: HTMLTextAreaElement, r: number, j: number, go: "down" | "up" | "right" | "left" | null) => {
    const at = visible[r].at!
    save(at, j, input.value)
    const [nr, nj] = go === "down" ? [r + 1, j] : go === "up" ? [r - 1, j] : go === "right" ? (j < head.length - 1 ? [r, j + 1] : [r + 1, 0])
      : go === "left" ? (j > 0 ? [r, j - 1] : [r - 1, head.length - 1]) : [-1, -1]
    setEditing(visible[nr] ? { at: visible[nr].at!, col: nj } : null)
  }
  const click = (j: number) => setSort((s) => (s?.col !== j ? { col: j, dir: 1 } : s.dir === 1 ? { col: j, dir: -1 } : null))
  return (
    <div className="csv-view">
      {!embed && (
        <div className="mb-3 flex items-center gap-3">
          <FilterField value={q} onChange={setQ} placeholder="Filter rows" className="md:max-w-[320px]" />
          <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
            {q ? `${numberText(shown.length)} of ${numberText(rows.length)}` : numberText(rows.length)} {rows.length === 1 ? "row" : "rows"}
          </span>
        </div>
      )}
      <div className={cn("overflow-auto rounded-[10px] border-[0.5px] border-border", embed ? "max-h-[420px]" : "max-h-[calc(100dvh-220px)]")}>
        <table data-keylist className="w-full border-collapse text-[14px] leading-5">
          <thead className="sticky top-0 z-[1] bg-card">
            <tr>
              {head.map((h, j) => (
                <th key={j} scope="col" aria-sort={sort?.col === j ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                  className={cn("border-b-[0.5px] border-border p-0 font-semibold whitespace-nowrap", numeric[j] && "text-right")}>
                  <button type="button" onClick={() => click(j)}
                    className={cn("flex w-full cursor-pointer items-center gap-1 px-3 py-2 hover:text-primary", numeric[j] && "justify-end")}>
                    {h || <span className="text-muted-foreground">(no name)</span>}
                    {sort?.col === j && (sort.dir === 1 ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={r.at ?? i} tabIndex={i === 0 ? 0 : -1} data-keyrow data-csv-row={r.at} className="even:bg-foreground/[0.025]">
                {head.map((_, j) => editing?.at === r.at && editing.col === j ? (
                  <td key={j} className="relative p-0 align-top">
                    <div aria-hidden className={cn("invisible max-w-[420px] truncate px-3 py-1.5", numeric[j] && "tabular-nums")}>{r[j] || " "}</div>
                    <textarea autoFocus defaultValue={r[j] ?? ""} rows={1} aria-label={`${head[j] || "Column"} of row ${i + 1}`} data-csv-input
                      onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") { e.preventDefault(); e.currentTarget.dataset.left = ""; setEditing(null) }
                        else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.dataset.left = ""; leave(e.currentTarget, i, j, "down") }
                        else if (e.key === "Tab") { e.preventDefault(); e.currentTarget.dataset.left = ""; leave(e.currentTarget, i, j, e.shiftKey ? "left" : "right") }
                      }}
                      onBlur={(e) => { if (e.target.dataset.left !== undefined) return; save(r.at!, j, e.target.value); setEditing(null) }}
                      className={cn("absolute inset-0 block size-full resize-none overflow-hidden bg-background px-3 py-1.5 outline-2 -outline-offset-2 outline-primary", numeric[j] && "text-right tabular-nums")} />
                  </td>
                ) : (
                  <td key={j} className={cn("max-w-[420px] truncate px-3 py-1.5 align-top", numeric[j] && "text-right tabular-nums", onChange && "cursor-text")}
                    onDoubleClick={onChange ? () => setEditing({ at: r.at!, col: j }) : undefined}
                    data-tip={(r[j] ?? "").length > 40 ? r[j] : undefined} data-tip-trunc>{r[j] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onChange && !embed && !q && (
        <button type="button" data-csv-add-row onClick={() => { const n = parseCsv(text).length; added.current = n; onChange(addRow(text, head.length)); setSort(null); setAll(true); setEditing({ at: n, col: 0 }) }}
          className="mt-2 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-[13px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground pointer-coarse:h-10 pointer-coarse:text-[15px]">
          <Plus className="size-4" strokeWidth={2} />Add row
        </button>
      )}
      {!embed && !all && shown.length > PAGE && (
        <button type="button" onClick={() => setAll(true)} className="mt-3 cursor-pointer text-[15px] font-semibold text-primary">
          Show all {numberText(shown.length)} rows
        </button>
      )}
    </div>
  )
}
