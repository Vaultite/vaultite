import { parse as parseYaml } from "yaml"
import { obj } from "./dil.ts"

export type ChartSpec = {
  type?: string; title?: string; data?: unknown; labels?: unknown; datasets?: unknown
  x?: string; y?: string | string[]; series?: unknown; stacked?: boolean; horizontal?: boolean
  height?: number; unit?: string; suffix?: string; prefix?: string; colors?: string[]; xLabel?: string; yLabel?: string
  min?: number; max?: number
}

export function fromChatGpt(c: Record<string, unknown>): ChartSpec {
  const series: unknown[] | undefined = Array.isArray(c.series) ? c.series : undefined
  const first = series?.find(obj)
  const type = String(c.chartType ?? c.type ?? "bar").toLowerCase()
  return {
    type: type === "bar" && c.layout === "vertical" ? "hbar" : type, title: typeof c.title === "string" ? c.title : undefined,
    data: c.data, x: typeof c.xKey === "string" ? c.xKey : undefined, series, stacked: !!c.stacked,
    suffix: typeof first?.valueSuffix === "string" ? first.valueSuffix : undefined, prefix: typeof first?.valuePrefix === "string" ? first.valuePrefix : undefined,
    min: typeof c.yAxisMin === "number" ? c.yAxisMin : undefined, max: typeof c.yAxisMax === "number" ? c.yAxisMax : undefined,
  }
}
export const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined)

export function specOf(o: Record<string, unknown>): ChartSpec {
  return {
    type: str(o.type), title: str(o.title), data: o.data, labels: o.labels, datasets: o.datasets, series: o.series,
    x: str(o.x), y: Array.isArray(o.y) ? o.y.map(String) : str(o.y), stacked: !!o.stacked, horizontal: !!o.horizontal,
    height: Number(o.height) || undefined, unit: str(o.unit), suffix: str(o.suffix), prefix: str(o.prefix),
    colors: Array.isArray(o.colors) ? o.colors.map(String) : undefined, xLabel: str(o.xLabel), yLabel: str(o.yLabel),
    min: isNum(o.min) ? o.min : undefined, max: isNum(o.max) ? o.max : undefined,
  }
}
export type Series = { key: string; label: string; color: string; values: (number | null)[] }

export const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--blue)", "var(--orange)", "var(--purple)", "var(--teal)", "var(--pink)"]
export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const toNum = (v: unknown) => (isNum(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(+v.replace(/[,_]/g, "")) ? +v.replace(/[,_]/g, "") : null)

export function chartData(spec: ChartSpec): { cats: string[]; series: Series[] } {
  const palette = Array.isArray(spec.colors) && spec.colors.length ? spec.colors.map(String) : COLORS
  const color = (i: number, c?: unknown) => (typeof c === "string" && c ? (/^[a-z-]+$/.test(c) && !/^(red|blue|green|black|white)$/.test(c) ? `var(--${c})` : c) : palette[i % palette.length])
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

export function chartSpec(text: string): { spec: ChartSpec } | { error: string } {
  let v: unknown
  try { v = text.trim().startsWith("{") ? JSON.parse(text) : parseYaml(text) } catch (e) { return { error: (e instanceof Error ? e.message : String(e)).split("\n")[0] } }
  if (Array.isArray(v)) v = { data: v }
  if (!obj(v)) return { error: "it needs a type and data" }
  return { spec: specOf(v) }
}

export function chartText(text: string): string {
  const r = chartSpec(text)
  if ("error" in r) return `_(a chart that couldn't be read: ${r.error})_`
  const { cats, series } = chartData(r.spec)
  if (!series.length) return r.spec.title ? `**${r.spec.title}**` : ""
  const cell = (s: string) => s.replace(/\|/g, "\\|")
  const rows = cats.map((c, i) => `| ${cell(c)} | ${series.map((s) => s.values[i] ?? "").join(" | ")} |`)
  return [r.spec.title && `**${r.spec.title}**`, `| | ${series.map((s) => cell(s.label)).join(" | ")} |\n|---|${series.map(() => "---").join("|")}|\n${rows.join("\n")}`].filter(Boolean).join("\n\n")
}
