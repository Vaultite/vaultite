// A chart's data read the same on both sides: a spec (JSON or YAML) into categories and series, and its text as a
// Markdown table. Data is rows ({month: "Jan", sales: 3}) or Chart.js' labels and datasets.
import { parse as parseYaml } from "yaml"

export type ChartSpec = {
  type?: string; title?: string; data?: unknown; labels?: unknown; datasets?: unknown
  x?: string; y?: string | string[]; series?: unknown; stacked?: boolean; horizontal?: boolean
  height?: number; unit?: string; suffix?: string; prefix?: string; colors?: string[]; xLabel?: string; yLabel?: string
  min?: number; max?: number
}

/** ChatGPT's own chart (`<Chart content={{chartType, xKey, series: [{dataKey, valueSuffix}], layout}}>`) as a spec. */
export function fromChatGpt(c: Record<string, unknown>): ChartSpec {
  const series = Array.isArray(c.series) ? (c.series as Record<string, unknown>[]) : undefined
  const first = series?.find((x) => x && typeof x === "object")
  const type = String(c.chartType ?? c.type ?? "bar").toLowerCase()
  return {
    type: type === "bar" && c.layout === "vertical" ? "hbar" : type, title: typeof c.title === "string" ? c.title : undefined,
    data: c.data, x: typeof c.xKey === "string" ? c.xKey : undefined, series, stacked: !!c.stacked,
    suffix: typeof first?.valueSuffix === "string" ? first.valueSuffix : undefined, prefix: typeof first?.valuePrefix === "string" ? first.valuePrefix : undefined,
    min: typeof c.yAxisMin === "number" ? c.yAxisMin : undefined, max: typeof c.yAxisMax === "number" ? c.yAxisMax : undefined,
  }
}
export type Series = { key: string; label: string; color: string; values: (number | null)[] }

export const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--blue)", "var(--orange)", "var(--purple)", "var(--teal)", "var(--pink)"]
export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const toNum = (v: unknown) => (isNum(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(+v.replace(/[,_]/g, "")) ? +v.replace(/[,_]/g, "") : null)
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** A spec's categories and series, whichever way it's written. */
export function chartData(spec: ChartSpec): { cats: string[]; series: Series[] } {
  const palette = Array.isArray(spec.colors) && spec.colors.length ? spec.colors.map(String) : COLORS
  const color = (i: number, c?: unknown) => (typeof c === "string" && c ? (/^[a-z-]+$/.test(c) && !/^(red|blue|green|black|white)$/.test(c) ? `var(--${c})` : c) : palette[i % palette.length])
  // Chart.js: {labels, datasets: [{label, data}]}
  if (Array.isArray(spec.datasets)) {
    const cats = (Array.isArray(spec.labels) ? spec.labels : []).map(String)
    const series = spec.datasets.filter(obj).map((d, i) => ({ key: String(d.label ?? i), label: String(d.label ?? `Series ${i + 1}`), color: color(i, d.color ?? d.borderColor), values: (Array.isArray(d.data) ? d.data : []).map(toNum) }))
    return { cats: cats.length ? cats : (series[0]?.values ?? []).map((_, i) => String(i + 1)), series }
  }
  const rows = Array.isArray(spec.data) ? spec.data : obj(spec.data) ? Object.entries(spec.data).map(([k, v]) => ({ label: k, value: v })) : []
  if (rows.length && rows.every((r) => isNum(r) || toNum(r) !== null)) return { cats: rows.map((_, i) => String(i + 1)), series: [{ key: "value", label: spec.title ?? "Value", color: color(0), values: rows.map(toNum) }] }
  const objs = rows.filter(obj)
  const keys = [...new Set(objs.flatMap((r) => Object.keys(r)))]
  const xKey = spec.x ?? keys.find((k) => objs.some((r) => typeof r[k] === "string")) ?? keys.find((k) => /^(x|label|name|date|month|day|year|category)$/i.test(k)) ?? keys[0]
  const listed = Array.isArray(spec.series) ? spec.series : null
  const yKeys = listed ? listed.map((s) => (obj(s) ? String(s.key ?? s.dataKey ?? s.y ?? s.field) : String(s)))
    : Array.isArray(spec.y) ? spec.y.map(String) : typeof spec.y === "string" ? [spec.y]
    : keys.filter((k) => k !== xKey && objs.some((r) => toNum(r[k]) !== null))
  return {
    cats: objs.map((r) => String(r[xKey] ?? "")),
    series: yKeys.map((k, i) => {
      const s = listed?.[i]
      return { key: k, label: obj(s) && s.label ? String(s.label) : obj(s) && s.name ? String(s.name) : k, color: color(i, obj(s) ? s.color : undefined), values: objs.map((r) => toNum(r[k])) }
    }),
  }
}


/** A ```chart fence's spec, or why it isn't one. */
export function chartSpec(text: string): { spec: ChartSpec } | { error: string } {
  let v: unknown
  try { v = text.trim().startsWith("{") ? JSON.parse(text) : parseYaml(text) } catch (e) { return { error: (e as Error).message.split("\n")[0] } }
  if (Array.isArray(v)) v = { data: v }
  if (!obj(v)) return { error: "it needs a type and data" }
  return { spec: v as ChartSpec }
}

/** What a chart says as text: its title and its data as a table. */
export function chartText(text: string): string {
  const r = chartSpec(text)
  if ("error" in r) return `_(a chart that couldn't be read: ${r.error})_`
  const { cats, series } = chartData(r.spec)
  if (!series.length) return r.spec.title ? `**${r.spec.title}**` : ""
  const cell = (s: string) => s.replace(/\|/g, "\\|")
  const rows = cats.map((c, i) => `| ${cell(c)} | ${series.map((s) => s.values[i] ?? "").join(" | ")} |`)
  return [r.spec.title && `**${r.spec.title}**`, `| | ${series.map((s) => cell(s.label)).join(" | ")} |\n|---|${series.map(() => "---").join("|")}|\n${rows.join("\n")}`].filter(Boolean).join("\n\n")
}
