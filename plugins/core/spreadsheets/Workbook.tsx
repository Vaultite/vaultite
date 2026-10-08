// A workbook drawn like Excel's grid (sticky headers, saved widths and merges, Excel's formats), read-only: it's edited
// in its own app. Embedded, the grid's first rows only.
import { useEffect, useMemo, useState } from "react"
import * as XLSX from "xlsx"
import { cn, FilterField, Loading, numberText } from "@vaultite"

/** Rows drawn until the user asks for all of them (and in an embed, ever). */
const PAGE = 500, EMBED_ROWS = 60

type Sheet = { name: string; ws: XLSX.WorkSheet }
type Grid = { rows: number; cols: number; cell: (r: number, c: number) => XLSX.CellObject | undefined
  widths: (number | undefined)[]; spans: Map<string, [number, number]>; covered: Set<string> }

function gridOf(ws: XLSX.WorkSheet): Grid {
  const ref = ws["!ref"]
  const range = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } }
  const dense = (ws as { "!data"?: XLSX.CellObject[][] })["!data"]
  const cell = (r: number, c: number) => dense ? dense[r]?.[c] : ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined
  // Trailing empty rows and columns inside the saved range (formatting only) aren't drawn.
  let rows = range.e.r + 1, cols = range.e.c + 1
  const filled = (r: number, c: number) => { const x = cell(r, c); return !!x && x.v !== undefined && x.v !== null && x.v !== "" }
  while (rows > 0 && !Array.from({ length: cols }, (_, c) => filled(rows - 1, c)).some(Boolean)) rows--
  while (cols > 0 && !Array.from({ length: rows }, (_, r) => filled(r, cols - 1)).some(Boolean)) cols--
  const widths = Array.from({ length: cols }, (_, c) => {
    const w = ws["!cols"]?.[c]
    return w?.hidden ? 0 : w?.wpx ?? (w?.wch ? Math.round(w.wch * 7 + 10) : undefined)
  })
  const spans = new Map<string, [number, number]>(), covered = new Set<string>()
  for (const m of ws["!merges"] ?? []) {
    spans.set(`${m.s.r},${m.s.c}`, [m.e.r - m.s.r + 1, m.e.c - m.s.c + 1])
    for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) covered.add(`${r},${c}`)
  }
  return { rows, cols, cell, widths, spans, covered }
}

const text = (x: XLSX.CellObject | undefined) => (!x || x.v === undefined || x.v === null ? "" : x.w ?? String(x.v))

export default function Workbook({ url, embed, sheet: only }: { url: string; embed?: boolean; sheet?: string }) {
  const [book, setBook] = useState<XLSX.WorkBook | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let on = true
    setError(null)
    fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
      .then((buf) => { if (on) setBook(XLSX.read(buf, { type: "array", dense: true, cellDates: true })) })
      .catch((e) => { if (on) setError(String(e?.message ?? e)) })
    return () => { on = false }
  }, [url])
  const sheets = useMemo<Sheet[]>(() => !book ? [] : book.SheetNames
    .filter((_, i) => !book.Workbook?.Sheets?.[i]?.Hidden)
    .map((name) => ({ name, ws: book.Sheets[name] })), [book])
  const [pick, setPick] = useState(0)
  if (error) return <p className="p-4 text-[15px] text-muted-foreground">This workbook couldn't be read: {error}.</p>
  if (!book) return <Loading />
  const at = only ? Math.max(0, sheets.findIndex((s) => s.name.toLowerCase() === only.toLowerCase())) : Math.min(pick, sheets.length - 1)
  const sheet = sheets[at]
  if (!sheet) return <p className="p-4 text-[15px] text-muted-foreground">An empty workbook.</p>
  return (
    <div className={cn("flex flex-col", embed ? "max-h-[420px]" : "h-full")} data-workbook>
      <SheetGrid key={sheet.name} ws={sheet.ws} embed={embed} />
      {!embed && sheets.length > 1 && (
        <div role="tablist" aria-label="Sheets" className="flex shrink-0 gap-0.5 overflow-x-auto border-t-[0.5px] border-border bg-card px-1.5 py-1">
          {sheets.map((s, i) => (
            <button key={s.name} type="button" role="tab" aria-selected={i === at} onClick={() => setPick(i)}
              className={cn("h-7 shrink-0 cursor-pointer rounded-[6px] px-2.5 text-[13px] whitespace-nowrap",
                i === at ? "bg-foreground/[0.08] font-semibold text-foreground" : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground")}>
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SheetGrid({ ws, embed }: { ws: XLSX.WorkSheet; embed?: boolean }) {
  const grid = useMemo(() => gridOf(ws), [ws])
  const [q, setQ] = useState("")
  const [all, setAll] = useState(false)
  // Rows that match the filter (every word somewhere in the row); the first row stays as the header would.
  const shown = useMemo(() => {
    const ids = Array.from({ length: grid.rows }, (_, r) => r)
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return ids
    return ids.filter((r) => {
      if (r === 0) return true
      const hay = Array.from({ length: grid.cols }, (_, c) => text(grid.cell(r, c))).join(" ").toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [grid, q])
  const limit = embed ? EMBED_ROWS : all ? Infinity : PAGE
  const visible = shown.slice(0, limit)
  // (a filter breaks merged cells' rows apart: merges are drawn only unfiltered)
  const merged = !q
  if (!grid.rows || !grid.cols) return <p className="p-4 text-[15px] text-muted-foreground">An empty sheet.</p>
  return (
    <>
      {!embed && (
        <div className="flex shrink-0 items-center gap-3 border-b-[0.5px] border-border px-2 py-2">
          <FilterField value={q} onChange={setQ} placeholder="Filter rows" className="md:max-w-[320px]" />
          <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
            {q ? `${numberText(shown.length - 1)} of ${numberText(grid.rows - 1)}` : numberText(grid.rows)} {grid.rows === 1 ? "row" : "rows"}
          </span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <table className="border-separate border-spacing-0 text-[13px] leading-5" data-sheet-grid>
          <colgroup>
            <col style={{ width: 44 }} />
            {grid.widths.map((w, c) => <col key={c} style={{ width: w ?? 100, minWidth: w === 0 ? 0 : 40 }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-[3] border-r-[0.5px] border-b-[0.5px] border-border bg-card" />
              {grid.widths.map((w, c) => (
                <th key={c} scope="col" className={cn("sticky top-0 z-[2] border-r-[0.5px] border-b-[0.5px] border-border bg-card px-1 py-0.5 text-center text-[12px] font-medium text-muted-foreground", w === 0 && "hidden")}>
                  {XLSX.utils.encode_col(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r}>
                <th scope="row" className="sticky left-0 z-[1] border-r-[0.5px] border-b-[0.5px] border-border bg-card px-1.5 text-right text-[12px] font-medium text-muted-foreground tabular-nums">{r + 1}</th>
                {Array.from({ length: grid.cols }, (_, c) => {
                  const key = `${r},${c}`
                  if (merged && grid.covered.has(key)) return null
                  const x = grid.cell(r, c), span = merged ? grid.spans.get(key) : undefined
                  const v = text(x)
                  return (
                    <td key={c} rowSpan={span?.[0]} colSpan={span?.[1]}
                      className={cn("max-w-[480px] truncate border-r-[0.5px] border-b-[0.5px] border-border/60 px-1.5 py-0.5 align-top",
                        (x?.t === "n" || x?.t === "d") && "text-right tabular-nums", x?.t === "b" && "text-center", x?.t === "e" && "text-[var(--red)]",
                        grid.widths[c] === 0 && "hidden")}
                      data-tip={v.length > 30 ? v : undefined} data-tip-trunc>{v}</td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!embed && !all && shown.length > PAGE && (
          <button type="button" onClick={() => setAll(true)} className="m-3 cursor-pointer text-[15px] font-semibold text-primary">
            Show all {numberText(shown.length)} rows
          </button>
        )}
      </div>
    </>
  )
}
