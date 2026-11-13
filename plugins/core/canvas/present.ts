import type { CanvasDoc, CanvasNode } from "./codec.ts"

const reading = (a: CanvasNode, b: CanvasNode) => (Math.abs(a.y - b.y) < Math.min(a.height, b.height) / 2 ? a.x - b.x : a.y - b.y)

export function slidesOf(doc: CanvasDoc): CanvasNode[] {
  const groups = doc.nodes.filter((n) => n.type === "group").sort(reading)
  const ids = new Set(groups.map((g) => g.id))
  const next = new Map<string, string[]>()
  const led = new Set<string>()
  for (const e of doc.edges) {
    if (!ids.has(e.fromNode) || !ids.has(e.toNode) || e.fromNode === e.toNode) continue
    next.set(e.fromNode, [...next.get(e.fromNode) ?? [], e.toNode])
    led.add(e.toNode)
  }
  const out: CanvasNode[] = [], seen = new Set<string>()
  const byId = new Map(groups.map((g) => [g.id, g]))
  const follow = (id: string) => {
    for (let at: string | undefined = id; at && !seen.has(at);) {
      seen.add(at)
      out.push(byId.get(at)!)
      at = (next.get(at) ?? []).map((n) => byId.get(n)!).sort(reading).find((n) => !seen.has(n.id))?.id
    }
  }
  for (const g of groups) if (next.has(g.id) && !led.has(g.id)) follow(g.id)
  for (const g of groups) if (next.has(g.id) && !seen.has(g.id)) follow(g.id)
  for (const g of groups) if (!seen.has(g.id)) follow(g.id)
  return out
}
