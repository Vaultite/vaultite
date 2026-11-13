import { useEffect, useMemo, useState } from "react"
import type { CellObject, WorkBook, WorkSheet } from "./xlsx/xlsx.mjs"
import { cn, FilterField, Loading, numberText, errorText } from "@vaultite"

const PAGE = 500, EMBED_ROWS = 60
const READ_MS = 60_000

type Sheet = { name: string; ws: WorkSheet }
type Grid = { rows: number; cols: number; cell: (r: number, c: number) => CellObject | undefined
  widths: (number | undefined)[]; spans: Map<string, [number, number]>; covered: Set<string> }

function colName(c: number) {
  let s = ""
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}
function cellAt(a: string) {
  const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(a)
  if (!m) return { r: 0, c: 0 }
  let c = 0
  for (const ch of m[1].toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64
  return { r: Number(m[2]) - 1, c: c - 1 }
}
const rangeOf = (ref: string) => { const [s, e = s] = ref.split(":"); return { s: cellAt(s), e: cellAt(e) } }

function readBook(buf: ArrayBuffer, signal: AbortSignal): Promise<WorkBook> {
  return new Promise((done, fail) => {
    if (signal.aborted) return fail(new DOMException("Aborted", "AbortError"))
    const w = new Worker(new URL("./read.worker.ts", import.meta.url), { type: "module" })
    const end = (then: () => void) => { clearTimeout(timer); signal.removeEventListener("abort", stop); w.terminate(); then() }
    const stop = () => end(() => fail(new DOMException("Aborted", "AbortError")))
    const timer = setTimeout(() => end(() => fail(new Error("it took over a minute"))), READ_MS)
    signal.addEventListener("abort", stop)
    w.onmessage = (e: MessageEvent<{ book?: WorkBook; error?: string }>) => end(() => (e.data.book ? done(e.data.book) : fail(new Error(e.data.error))))
    w.onerror = (e) => { e.preventDefault(); end(() => fail(new Error(e.message))) }
    w.postMessage(buf, [buf])
  })
}

function gridOf(ws: WorkSheet): Grid {
  const ref = ws["!ref"]
  const range = ref ? rangeOf(ref) : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } }
  const dense: CellObject[][] | undefined = ws["!data"]
  const cell = (r: number, c: number): CellObject | undefined => dense ? dense[r]?.[c] : ws[`${colName(c)}${r + 1}`]
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

const text = (x: CellObject | undefined) => (!x || x.v === undefined || x.v === null ? "" : x.w ?? String(x.v))

export default function Workbook({ url, embed, sheet: only }: { url: string; embed?: boolean; sheet?: string }) {
  const [book, setBook] = useState<WorkBook | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const ask = new AbortController()
    setError(null)
    fetch(url, { signal: ask.signal }).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
      .then((buf) => readBook(buf, ask.signal))
      .then((b) => { if (!ask.signal.aborted) setBook(b) })
      .catch((e) => { if (!ask.signal.aborted) setError(errorText(e, "This workbook couldn't be read")) })
    return () => ask.abort()
  }, [url])
  const sheets = useMemo<Sheet[]>(() => !book ? [] : book.SheetNames
    .filter((_, i) => !book.Workbook?.Sheets?.[i]?.Hidden)
    .map((name) => ({ name, ws: book.Sheets[name] })), [book])
  const [pick, setPick] = useState(0)
  if (error) return <p className="p-4 text-[15px] text-muted-foreground">{error}</p>
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

function SheetGrid({ ws, embed }: { ws: WorkSheet; embed?: boolean }) {
  const grid = useMemo(() => gridOf(ws), [ws])
  const [q, setQ] = useState("")
  const [all, setAll] = useState(false)
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
  const limit = all ? Infinity : embed ? EMBED_ROWS : PAGE
  const visible = shown.slice(0, limit)
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
        <table className="border-separate border-spacing-0 text-[13px] leading-5 select-text" data-sheet-grid>
          <colgroup>
            <col style={{ width: 44 }} />
            {grid.widths.map((w, c) => <col key={c} style={{ width: w ?? 100, minWidth: w === 0 ? 0 : 40 }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-[3] border-r-[0.5px] border-b-[0.5px] border-border bg-card" />
              {grid.widths.map((w, c) => (
                <th key={c} scope="col" className={cn("sticky top-0 z-[2] border-r-[0.5px] border-b-[0.5px] border-border bg-card px-1 py-0.5 text-center text-[12px] font-medium text-muted-foreground", w === 0 && "hidden")}>
                  {colName(c)}
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
                        (x?.t === "n" || x?.t === "d") && "text-right tabular-nums", x?.t === "b" && "text-center", x?.t === "e" && "text-ink-(--red)",
                        grid.widths[c] === 0 && "hidden")}
                      data-tip={v.length > 30 ? v : undefined} data-tip-trunc>{v}</td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!all && shown.length > limit && (
          <button type="button" onClick={() => setAll(true)} className="m-3 cursor-pointer text-[15px] font-semibold text-primary">
            Show all {numberText(shown.length)} rows
          </button>
        )}
      </div>
    </>
  )
}
