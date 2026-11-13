import { useEffect, useMemo, useRef, type ReactNode } from "react"
import { blockFor, blockOptions, BlockView, cn, EmbedView, fenceLayout, Markdown, blockHeightKey, keepAnchored, offText, openDetail, segments, textKey, useHeldHeight, type PageCtx } from "@vaultite"

type Cell = ({ md: string } | { embed: string; height?: number } | { wide: boolean; blocks: { name: string; text: string; nth: number }[] }) & { line: number }

const isNote = (target: string) => { const name = target.split(/[#|]/)[0]; return !/\.[a-z0-9]+$/i.test(name) || /\.md$/i.test(name) }

function cellsOf(body: string, disabled: string[]): Cell[] {
  return layout(body).flatMap((c): Cell[] => {
    if ("md" in c || "embed" in c) return [c]
    const blocks = c.blocks.filter((b) => blockFor(b.name, disabled, blockOptions(b.text)).render)
    return blocks.length ? [{ ...c, blocks }] : []
  })
}

const half = (c: Cell | undefined) => !!c && "blocks" in c && !c.wide

export const narrow = (body: string, disabled: string[]) => {
  const cells = cellsOf(body, disabled)
  return cells.every((c, i) => "md" in c || ("embed" in c ? isNote(c.embed) : half(c) && !half(cells[i + 1])))
}

function layout(body: string): Cell[] {
  const cells: Cell[] = []
  const seen = new Map<string, number>()
  for (const s of segments(body)) {
    if ("md" in s) { cells.push({ md: s.md, line: s.line }); continue }
    if ("embed" in s) { cells.push(s); continue }
    const o = fenceLayout(s.info, s.text)
    const nth = seen.get(s.block) ?? 0
    seen.set(s.block, nth + 1)
    const last = cells[cells.length - 1]
    if (o.stack && last && "blocks" in last) last.blocks.push({ name: s.block, text: s.text, nth })
    else cells.push({ wide: o.wide, blocks: [{ name: s.block, text: s.text, nth }], line: s.line })
  }
  return cells
}

function allOff(body: string, cells: Cell[], disabled: string[]) {
  if (cells.length) return []
  const off = layout(body).flatMap((c) => "blocks" in c ? c.blocks.map((b) => blockFor(b.name, disabled, blockOptions(b.text)).plugin) : [])
  return [...new Set(off.filter((p): p is NonNullable<typeof p> => !!p))]
}

export function Dashboard({ ctx }: { ctx: PageCtx }) {
  const { body, disabled } = ctx
  const cells = useMemo(() => cellsOf(body, disabled), [body, disabled])
  const off = useMemo(() => allOff(body, cells, disabled), [body, cells, disabled])
  const one = useMemo(() => narrow(body, disabled), [body, disabled])
  const keys = useMemo(() => {
    const seen = new Map<string, number>()
    return cells.map((c) => {
      const what = "md" in c ? `md:${c.md}` : "embed" in c ? `embed:${c.embed}:${c.height ?? ""}` : c.blocks.map((b) => `${b.name}:${b.text}`).join("\0")
      const k = textKey(what)
      const n = (seen.get(k) ?? 0) + 1
      seen.set(k, n)
      if ("blocks" in c && c.blocks.length === 1) return blockHeightKey(ctx.place, ctx.path, c.blocks[0].name, c.blocks[0].text, n)
      return `${ctx.place}:${ctx.path}:${k}:${n}`
    })
  }, [cells, ctx.path, ctx.place])
  const grid = useRef<HTMLDivElement>(null)
  useEffect(() => (grid.current ? keepAnchored(grid.current, ":scope > [data-line]") : undefined), [])
  return (
    <div className="@container"><div ref={grid} className={cn("grid grid-cols-1 gap-4", !one && "@2xl:grid-cols-2")}>
      {!!off.length && (
        <p className="text-[15px] text-muted-foreground" data-dashboard-off={off.map((p) => p.id).join(" ")}>
          Nothing to show: {off.map((p) => offText(p, disabled)).join("; ")}.{" "}
          <button type="button" className="cursor-pointer font-medium text-primary" onClick={() => openDetail(`plugin/${off[0].id}`)}>Review</button>
        </p>
      )}
      {cells.map((c, i) => "embed" in c ? (
        <Card key={i} at={keys[i]} line={c.line} className={cn("min-w-0", !one && "@2xl:col-span-2", isNote(c.embed) && "max-w-(--line-width)")}><EmbedView target={c.embed} height={c.height} store={ctx.store} from={ctx.path} seen={[ctx.path]} /></Card>
      ) : "md" in c ? (
        <Card key={i} at={keys[i]} line={c.line} end={c.line + c.md.split("\n").length - 1} className={cn("min-w-0", !one && "@2xl:col-span-2")}><Markdown text={c.md} store={ctx.store} from={ctx.path} plain tasks className="dash-prose max-w-(--line-width)" /></Card>
      ) : (
        <Card key={i} at={keys[i]} line={c.line} className={cn("grid min-w-0 grid-cols-1 gap-4", c.blocks.length > 1 && "content-start", c.wide && "@2xl:col-span-2")}>
          {c.blocks.map((b, j) => <BlockView key={j} name={b.name} text={b.text} ctx={ctx} disabled={disabled} quiet nth={b.nth} />)}
        </Card>
      ))}
    </div></div>
  )
}

function Card({ at, line, end, className, children }: { at: string; line: number; end?: number; className: string; children: ReactNode }) {
  const ref = useHeldHeight<HTMLDivElement>(at)
  return <div ref={ref} data-line={line} data-end={end} className={className}>{children}</div>
}
