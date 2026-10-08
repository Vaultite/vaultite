// A stacked column chart over time in the style of the kit's Bars (readout above, rounded tops, gapped segments).
import { useState } from "react"
import { numberText } from "@vaultite"

export type Series = { key: string; label: string; color: string }
export type Col = { values: number[]; tip: string }

export function Columns({ series, cols, height = 96, format = (v) => numberText(v), from, to, legend }: {
  series: Series[]; cols: Col[]; height?: number; format?: (v: number) => string
  /** The axis' two ends ("09:00", "Now"). */
  from: string; to: string
  /** Each series' total in the legend (for counts; not for times). */
  legend?: "totals" | "labels"
}) {
  const [hover, setHover] = useState<number | null>(null)
  const sum = (c: Col) => c.values.reduce((s, v) => s + v, 0)
  const max = Math.max(...cols.map(sum), 1)
  const shown = hover ?? cols.length - 1
  const c = cols[shown]
  const room = height - 2 * (series.length - 1)
  const many = series.length > 1
  return (
    <div data-columns>
      <div className="mb-2 h-5 truncate text-[13px] text-muted-foreground tabular-nums">
        {c && (
          <>
            <span className="num font-semibold text-foreground">{format(sum(c))}</span> · {c.tip}
            {many && sum(c) > 0 && ` · ${series.map((s, i) => c.values[i] ? `${s.label} ${format(c.values[i])}` : "").filter(Boolean).join(", ")}`}
          </>
        )}
      </div>
      <div className="flex items-end gap-[2px]" style={{ height }} onMouseLeave={() => setHover(null)}>
        {cols.map((col, i) => {
          const total = sum(col)
          const segs = col.values.map((v, j) => ({ v, j })).filter((s) => s.v > 0)
          return (
            <button key={i} type="button" className="flex h-full min-w-0 flex-1 flex-col-reverse gap-[2px]"
              aria-label={`${col.tip}: ${format(total)}`} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}
              style={{ opacity: hover === null || hover === i ? 1 : 0.45 }}>
              {!total ? <span className="h-[2px] w-full shrink-0 bg-muted" /> : segs.map((s, k) => (
                <span key={s.j} className={k === segs.length - 1 ? "w-full shrink-0 rounded-t-[4px]" : "w-full shrink-0"}
                  style={{ height: Math.max((s.v / max) * room, 2), background: series[s.j].color }} />
              ))}
            </button>
          )
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
        <span>{from}</span><span>{to}</span>
      </div>
      {many && legend && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground" data-legend>
          {series.map((s, i) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
              {s.label}
              {legend === "totals" && <span className="text-foreground tabular-nums">{format(cols.reduce((n, x) => n + x.values[i], 0))}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
