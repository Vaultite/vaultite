// A ```chart fence: its spec (JSON or YAML: type, data, x, y, title) drawn as a chart.
import { useMemo } from "react"
import type { BlockCtx } from "@vaultite"
import { Chart } from "./Chart"
import { chartSpec } from "./chartdata"

export function ChartFence(ctx: BlockCtx) {
  const r = useMemo(() => chartSpec(ctx.text), [ctx.text])
  if ("error" in r) return <p className="text-[14px] text-muted-foreground">This chart couldn't be read: {r.error}</p>
  return <Chart spec={r.spec} />
}
