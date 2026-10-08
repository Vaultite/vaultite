// A dashboard read: its blocks as a grid of cards (`wide`, `stack`), off plugins' blocks left out. Cards come back at
// their last height and carry `data-line`, so the page keeps its shape and editing shows the same part.
import { useEffect, useMemo, useRef, type ReactNode } from "react"
import { blockFor, blockOptions, BlockView, cn, EmbedView, Markdown, blockHeightKey, keepAnchored, segments, textKey, useHeldHeight, type PageCtx } from "@vaultite"

type Cell = ({ md: string } | { embed: string; height?: number } | { wide: boolean; blocks: { name: string; text: string; nth: number }[] }) & { line: number }

function layout(body: string): Cell[] {
  const cells: Cell[] = []
  // (which of the file's blocks of its name each is: its options are written there)
  const seen = new Map<string, number>()
  for (const s of segments(body)) {
    if ("md" in s) { cells.push({ md: s.md, line: s.line }); continue }
    if ("embed" in s) { cells.push(s); continue }
    const o = blockOptions(s.text)
    const nth = seen.get(s.block) ?? 0
    seen.set(s.block, nth + 1)
    const last = cells[cells.length - 1]
    if (o.stack === true && last && "blocks" in last) last.blocks.push({ name: s.block, text: s.text, nth })
    else cells.push({ wide: o.wide === true, blocks: [{ name: s.block, text: s.text, nth }], line: s.line })
  }
  return cells
}

export function Dashboard({ ctx, className }: { ctx: PageCtx; className?: string }) {
  const { body, disabled } = ctx
  // Blocks nobody draws (their plugin is off) take no room.
  const cells = useMemo(() => layout(body).flatMap((c): Cell[] => {
    if ("md" in c || "embed" in c) return [c]
    const blocks = c.blocks.filter((b) => blockFor(b.name, disabled).render)
    return blocks.length ? [{ ...c, blocks }] : []
  }), [body, disabled])
  // Each card's key for its remembered height: what it draws, and which of the same it is (not its place in the file,
  // so a block added above doesn't make the others forget).
  const keys = useMemo(() => {
    const seen = new Map<string, number>()
    return cells.map((c) => {
      const what = "md" in c ? `md:${c.md}` : "embed" in c ? `embed:${c.embed}:${c.height ?? ""}` : c.blocks.map((b) => `${b.name}:${b.text}`).join("\0")
      const k = textKey(what)
      const n = (seen.get(k) ?? 0) + 1
      seen.set(k, n)
      // (a card of one block by the block's key, which the editor also reads: a guess at its size there)
      if ("blocks" in c && c.blocks.length === 1) return blockHeightKey(ctx.place, ctx.path, c.blocks[0].name, c.blocks[0].text, n)
      return `${ctx.place}:${ctx.path}:${k}:${n}`
    })
  }, [cells, ctx.path, ctx.place])
  // What's at the top of the screen stays there when cards above it change size (core/anchor.ts).
  const grid = useRef<HTMLDivElement>(null)
  useEffect(() => (grid.current ? keepAnchored(grid.current, ":scope > [data-line]") : undefined), [])
  return (
    // Two columns when its pane is wide enough (a container query: a dashboard in a narrow split gets one).
    <div className={cn("@container", className)}><div ref={grid} className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
      {cells.map((c, i) => "embed" in c ? (
        <Card key={i} at={keys[i]} line={c.line} className="min-w-0 @2xl:col-span-2"><EmbedView target={c.embed} height={c.height} store={ctx.store} from={ctx.path} seen={[ctx.path]} /></Card>
      ) : "md" in c ? (
        // Markdown between blocks: a row of its own, its math and diagrams
        // drawn once it's on the page; its lines as long as a note's (FileView), however wide the cards around it.
        <Card key={i} at={keys[i]} line={c.line} end={c.line + c.md.split("\n").length - 1} className="min-w-0 @2xl:col-span-2"><Markdown text={c.md} store={ctx.store} from={ctx.path} plain className="dash-prose max-w-[700px]" /></Card>
      ) : (
        <Card key={i} at={keys[i]} line={c.line} className={cn("grid min-w-0 grid-cols-1 gap-4", c.blocks.length > 1 && "content-start", c.wide && "@2xl:col-span-2")}>
          {c.blocks.map((b, j) => <BlockView key={j} name={b.name} text={b.text} ctx={ctx} disabled={disabled} quiet nth={b.nth} />)}
        </Card>
      ))}
    </div></div>
  )
}

/** A cell of the grid, held at its remembered height while it comes in. */
function Card({ at, line, end, className, children }: { at: string; line: number; end?: number; className: string; children: ReactNode }) {
  const ref = useHeldHeight<HTMLDivElement>(at)
  return <div ref={ref} data-line={line} data-end={end} className={className}>{children}</div>
}
