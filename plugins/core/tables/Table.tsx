// A .csv drawn: a sticky header, a filter, sorting (numbers as numbers), the first rows until asked for all. Embedded
// it's its rows only.
import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { cn, FilterField, numberText, parseCsv } from "@vaultite"

const PAGE = 300
/** Text in the user's order, "2" before "10" (one collator: localeCompare with options makes one per call, slow on
 *  thousands of rows). */
const byText = new Intl.Collator(undefined, { numeric: true })
const NUM = /^\s*[-+]?(?:\$|R\$|€|£)?\s*[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*%?\s*$/
const num = (s: string) => Number(s.replace(/[^\d.+-]/g, ""))

export function CsvView({ text, embed }: { text: string; embed?: boolean }) {
  const { head, rows, numeric } = useMemo(() => {
    const [h = [], ...all] = parseCsv(text)
    const rs = all.filter((r) => r.some((f) => f !== ""))
    // A column is numeric when (nearly) every filled cell is a number.
    const numeric = h.map((_, j) => {
      const filled = rs.map((r) => r[j] ?? "").filter((v) => v.trim() !== "")
      return filled.length > 0 && filled.filter((v) => NUM.test(v)).length >= filled.length * 0.95
    })
    return { head: h, rows: rs, numeric }
  }, [text])
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)
  const [all, setAll] = useState(false)

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
              <tr key={i} tabIndex={i === 0 ? 0 : -1} data-keyrow className="even:bg-foreground/[0.025]">
                {head.map((_, j) => (
                  <td key={j} className={cn("max-w-[420px] truncate px-3 py-1.5 align-top", numeric[j] && "text-right tabular-nums")}
                    data-tip={(r[j] ?? "").length > 40 ? r[j] : undefined} data-tip-trunc>{r[j] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!embed && !all && shown.length > PAGE && (
        <button type="button" onClick={() => setAll(true)} className="mt-3 cursor-pointer text-[15px] font-semibold text-primary">
          Show all {numberText(shown.length)} rows
        </button>
      )}
    </div>
  )
}
