// The graph on a <canvas> with d3-force, coloured from the app's tokens. Quick with thousands of nodes: one path per
// colour, ticked only while it moves, labels only where there's room.
import { useEffect, useRef, useState } from "react"
import { Maximize } from "lucide-react"
import { forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force"
import { nameOf, type Graph, type GraphNode } from "./graph"

type SimNode = SimulationNodeDatum & { n: GraphNode; r: number; tok: string; color: string; label: string; low: string }
type SimLink = SimulationLinkDatum<SimNode>

export type CanvasProps = {
  graph: Graph
  /** The colour token each node gets ("--blue"). */
  colorOf: (n: GraphNode) => string
  /** The file the graph is about (a local graph): drawn with a ring and kept in the middle. */
  focus?: string
  /** Nodes whose name has this are lit, the rest faded. */
  search?: string
  onOpen: (path: string, newTab: boolean) => void
  /** Where the layout is remembered between openings ("view", "local"). */
  scope: string
  /** Smaller text and nodes (the sidebar, a block). */
  compact?: boolean
  /** Change it to fit the whole graph in the box again. Unset: a Fit button shows once the view is moved. */
  refit?: number
}

// Positions by scope and path: reopening the view (or a new file on disk) doesn't lay everything out again.
const POS = new Map<string, Map<string, { x: number; y: number }>>()

/** The page's value of a colour token, as the canvas can use it. Read once per theme (a graph asks for each node's,
 *  and reading one makes the browser work out the page's styles first): forgotten when the theme or scheme changes. */
const tokens = new Map<string, string>()
let watching = false
function token(name: string, fallback: string) {
  if (!watching) {
    watching = true
    new MutationObserver(() => tokens.clear())
      .observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-scheme", "data-theme", "style"] })
  }
  let v = tokens.get(name)
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    tokens.set(name, v)
  }
  return v || fallback
}

const radius = (degree: number, compact?: boolean) => Math.min(compact ? 9 : 16, (compact ? 3 : 3.5) + Math.sqrt(degree) * (compact ? 1.2 : 1.7))

export default function GraphCanvas({ graph, colorOf, focus, search, onOpen, scope, compact, refit }: CanvasProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  // Everything the drawing loop reads, kept in one mutable place so props changing never restarts the loop.
  const st = useRef({
    nodes: [] as SimNode[], links: [] as SimLink[], by: new Map<string, SimNode>(), adj: new Map<string, Set<string>>(),
    sim: null as Simulation<SimNode, SimLink> | null,
    t: { k: 1, x: 0, y: 0 }, w: 0, h: 0, dpr: 1, touched: false, dirty: true,
    hover: null as SimNode | null, search: "", focus: "", font: "system-ui", colors: { fg: "#000", muted: "#888", line: "#ccc", bg: "#fff", accent: "#07f" },
    onOpen, compact: !!compact, fit: null as (() => void) | null, setMoved: (_: boolean) => {},
  })
  const [moved, setMoved] = useState(false)
  st.current.onOpen = onOpen
  st.current.setMoved = setMoved

  // The graph: nodes keep their place (and new ones start next to a neighbour).
  useEffect(() => {
    const s = st.current
    const pos = POS.get(scope) ?? new Map<string, { x: number; y: number }>()
    POS.set(scope, pos)
    for (const n of s.nodes) if (n.x !== undefined) pos.set(n.n.path, { x: n.x, y: n.y! })
    const adj = new Map<string, Set<string>>()
    for (const n of graph.nodes) adj.set(n.path, new Set())
    for (const e of graph.edges) { adj.get(e.from)?.add(e.to); adj.get(e.to)?.add(e.from) }
    let fresh = 0
    const nodes: SimNode[] = graph.nodes.map((n, i) => {
      let p = pos.get(n.path)
      if (!p) {
        const near = [...(adj.get(n.path) ?? [])].map((q) => pos.get(q)).find(Boolean)
        const a = i * 2.39996, d = near ? 20 : 10 * Math.sqrt(i + 1)
        p = near ? { x: near.x + Math.cos(a) * d, y: near.y + Math.sin(a) * d } : { x: Math.cos(a) * d, y: Math.sin(a) * d }
        fresh++
      }
      const pinned = n.path === focus
      return { n, x: pinned ? 0 : p.x, y: pinned ? 0 : p.y, fx: pinned ? 0 : undefined, fy: pinned ? 0 : undefined, r: radius(n.degree, compact), tok: colorOf(n), color: token(colorOf(n), "#8e8e93"), label: nameOf(n.path), low: `${nameOf(n.path)}\n${n.title}`.toLowerCase() }
    })
    const by = new Map(nodes.map((n) => [n.n.path, n]))
    const links: SimLink[] = graph.edges.flatMap((e) => (by.has(e.from) && by.has(e.to) ? [{ source: by.get(e.from)!, target: by.get(e.to)! }] : []))
    s.sim?.stop()
    const many = nodes.length > 800
    const sim = forceSimulation<SimNode, SimLink>(nodes)
      .force("link", forceLink<SimNode, SimLink>(links).distance(compact ? 48 : 46).strength((l) => 1 / Math.min((adj.get((l.source as SimNode).n.path)?.size ?? 1), (adj.get((l.target as SimNode).n.path)?.size ?? 1)) * 0.7))
      .force("charge", forceManyBody<SimNode>().strength(compact ? -150 : many ? -45 : -120).theta(many ? 1.1 : 0.9).distanceMax(many ? 420 : 700))
      .force("x", forceX<SimNode>(0).strength(many ? 0.06 : 0.05))
      .force("y", forceY<SimNode>(0).strength(many ? 0.06 : 0.05))
      .alphaDecay(many ? 0.045 : 0.03)
      .stop()
    sim.alpha(fresh > nodes.length / 3 ? 1 : fresh ? 0.3 : 0.08)
    Object.assign(s, { nodes, links, by, adj, sim, dirty: true })
    if (s.hover && !by.has(s.hover.n.path)) s.hover = null
  }, [graph, scope, focus, compact, colorOf])

  useEffect(() => { st.current.search = (search ?? "").trim().toLowerCase(); st.current.dirty = true }, [search])
  useEffect(() => { st.current.focus = focus ?? ""; st.current.dirty = true }, [focus])
  useEffect(() => { if (refit) st.current.fit?.() }, [refit])

  // The colours, read again when the theme or scheme changes.
  useEffect(() => {
    const read = () => {
      const s = st.current
      s.colors = { fg: token("--foreground", "#1c1c1e"), muted: token("--muted-foreground", "#86868b"), line: token("--muted-foreground", "#86868b"), bg: token("--background", "#fff"), accent: token("--primary", "#007aff") }
      for (const n of s.nodes) n.color = token(n.tok, n.color)
      if (canvas.current) s.font = getComputedStyle(canvas.current).fontFamily || "system-ui"
      s.dirty = true
    }
    read()
    const o = new MutationObserver(read)
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-scheme", "data-theme", "style"] })
    return () => o.disconnect()
  }, [])

  // Size, input and the drawing loop: set up once.
  useEffect(() => {
    const el = canvas.current!, box = wrap.current!, s = st.current
    const ctx = el.getContext("2d")!
    const resize = () => {
      const r = box.getBoundingClientRect()
      s.dpr = Math.min(2, window.devicePixelRatio || 1)
      s.w = r.width; s.h = r.height
      el.width = Math.max(1, Math.round(r.width * s.dpr)); el.height = Math.max(1, Math.round(r.height * s.dpr))
      el.style.width = `${r.width}px`; el.style.height = `${r.height}px`
      s.dirty = true
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(box)

    const toWorld = (sx: number, sy: number) => ({ x: (sx - s.w / 2 - s.t.x) / s.t.k, y: (sy - s.h / 2 - s.t.y) / s.t.k })
    const hit = (sx: number, sy: number, slop = 0) => {
      const p = toWorld(sx, sy)
      let best: SimNode | null = null, bd = Infinity
      for (const n of s.nodes) {
        const dx = n.x! - p.x, dy = n.y! - p.y, d = dx * dx + dy * dy, r = n.r + (4 + slop) / s.t.k
        if (d < r * r && d < bd) { best = n; bd = d }
      }
      return best
    }
    /** Fit what's there in the box (while the layout settles, until someone moves it). */
    const fit = (ease: number) => {
      if (!s.nodes.length || !s.w) return
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const n of s.nodes) { x0 = Math.min(x0, n.x! - n.r); y0 = Math.min(y0, n.y! - n.r); x1 = Math.max(x1, n.x! + n.r); y1 = Math.max(y1, n.y! + n.r) }
      const pad = compact ? 16 : 48
      const k = Math.max(0.05, Math.min(compact ? 1.6 : 2, (s.w - pad * 2) / Math.max(1, x1 - x0), (s.h - pad * 2) / Math.max(1, y1 - y0)))
      const tx = -((x0 + x1) / 2) * k, ty = -((y0 + y1) / 2) * k
      s.t = { k: s.t.k + (k - s.t.k) * ease, x: s.t.x + (tx - s.t.x) * ease, y: s.t.y + (ty - s.t.y) * ease }
      s.dirty = true
    }
    s.fit = () => { s.touched = false; s.setMoved(false); fit(1) }
    const touch = () => { if (!s.touched) { s.touched = true; s.setMoved(true) } }

    const zoomAt = (sx: number, sy: number, factor: number) => {
      const k = Math.max(0.03, Math.min(8, s.t.k * factor))
      const p = toWorld(sx, sy)
      s.t = { k, x: sx - s.w / 2 - p.x * k, y: sy - s.h / 2 - p.y * k }
      touch(); s.dirty = true
    }

    // Pointers: one drags a node or pans, two pinch. A press that barely moves is a click.
    const pts = new Map<number, { x: number; y: number }>()
    let drag: { node: SimNode | null; x: number; y: number; moved: boolean; t0: number } | null = null
    let pinch: { d: number; cx: number; cy: number } | null = null
    const local = (e: PointerEvent | WheelEvent) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      el.setPointerCapture(e.pointerId)
      const p = local(e)
      pts.set(e.pointerId, p)
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
        if (drag?.node) { drag.node.fx = drag.node.n.path === s.focus ? 0 : null; drag.node.fy = drag.node.n.path === s.focus ? 0 : null }
        drag = null
        return
      }
      const node = hit(p.x, p.y, e.pointerType === "touch" ? 10 : 0)
      drag = { node, x: p.x, y: p.y, moved: false, t0: Date.now() }
      if (node && e.pointerType === "touch") { s.hover = node; s.dirty = true }
    }
    const move = (e: PointerEvent) => {
      const p = local(e)
      if (pts.has(e.pointerId)) pts.set(e.pointerId, p)
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2
        s.t = { ...s.t, x: s.t.x + cx - pinch.cx, y: s.t.y + cy - pinch.cy }
        zoomAt(cx, cy, d / Math.max(1, pinch.d))
        pinch = { d, cx, cy }
        return
      }
      if (!drag) {
        if (e.pointerType === "mouse") {
          const h = hit(p.x, p.y)
          if (h !== s.hover) { s.hover = h; s.dirty = true; el.style.cursor = h ? "pointer" : "grab" }
        }
        return
      }
      const dx = p.x - drag.x, dy = p.y - drag.y
      if (!drag.moved && Math.hypot(dx, dy) < (e.pointerType === "touch" ? 8 : 4)) return
      drag.moved = true
      touch()
      if (drag.node) {
        const w = toWorld(p.x, p.y)
        drag.node.fx = w.x; drag.node.fy = w.y
        s.sim?.alphaTarget(0.25)
        if ((s.sim?.alpha() ?? 0) < 0.25) s.sim?.alpha(0.25)
        el.style.cursor = "grabbing"
      } else {
        s.t = { ...s.t, x: s.t.x + dx, y: s.t.y + dy }
        drag.x = p.x; drag.y = p.y
        el.style.cursor = "grabbing"
      }
      s.dirty = true
    }
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId)
      if (pinch) { if (pts.size < 2) pinch = null; return }
      if (!drag) return
      const d = drag
      drag = null
      el.style.cursor = s.hover ? "pointer" : "grab"
      if (d.node) {
        s.sim?.alphaTarget(0)
        if (d.node.n.path !== s.focus) { d.node.fx = null; d.node.fy = null }
        if (!d.moved && e.type === "pointerup") s.onOpen(d.node.n.path, e.metaKey || e.ctrlKey || e.button === 1)
      }
      if (e.pointerType === "touch") { s.hover = null; s.dirty = true }
    }
    const leave = () => { if (!drag && s.hover) { s.hover = null; s.dirty = true } }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = local(e)
      // A trackpad's two-finger scroll pans; a wheel, a pinch (ctrl) or ⌘ zooms.
      const pan = !e.ctrlKey && !e.metaKey && e.deltaMode === 0 && Math.abs(e.deltaX) > 0
      if (pan) { s.t = { ...s.t, x: s.t.x - e.deltaX, y: s.t.y - e.deltaY }; touch(); s.dirty = true; return }
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)))
    }
    const aux = (e: MouseEvent) => {
      if (e.button !== 1) return
      const p = local(e as unknown as PointerEvent), n = hit(p.x, p.y)
      if (n) { e.preventDefault(); s.onOpen(n.n.path, true) }
    }
    el.addEventListener("pointerdown", down)
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
    el.addEventListener("pointercancel", up)
    el.addEventListener("pointerleave", leave)
    el.addEventListener("wheel", wheel, { passive: false })
    el.addEventListener("auxclick", aux)

    let frame = 0
    const draw = () => {
      const { nodes, links, t, dpr, colors, hover, adj } = s
      el.dataset.graphHover = hover?.n.path ?? "" // what's lit, for tests and screen readers' sake
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, s.w, s.h)
      ctx.save()
      ctx.translate(s.w / 2 + t.x, s.h / 2 + t.y)
      ctx.scale(t.k, t.k)
      const lit = hover ? adj.get(hover.n.path) ?? new Set<string>() : null
      const q = s.search
      const match = (n: SimNode) => !q || n.low.includes(q)
      const faded = (n: SimNode) => (lit ? n !== hover && !lit.has(n.n.path) : q ? !match(n) : false)

      // Edges: one path for the plain ones, one for the lit ones.
      ctx.lineWidth = Math.max(0.35, (s.compact ? 0.8 : 0.9) / t.k)
      ctx.strokeStyle = colors.line
      ctx.globalAlpha = lit || q ? 0.12 : nodes.length > 1000 ? 0.28 : 0.4
      ctx.beginPath()
      const hot: SimLink[] = []
      for (const l of links) {
        const a = l.source as SimNode, b = l.target as SimNode
        if (hover && (a === hover || b === hover)) { hot.push(l); continue }
        ctx.moveTo(a.x!, a.y!); ctx.lineTo(b.x!, b.y!)
      }
      ctx.stroke()
      if (hot.length) {
        ctx.globalAlpha = 0.9
        ctx.strokeStyle = colors.accent
        ctx.lineWidth = Math.max(0.8, 1.4 / t.k)
        ctx.beginPath()
        for (const l of hot) { const a = l.source as SimNode, b = l.target as SimNode; ctx.moveTo(a.x!, a.y!); ctx.lineTo(b.x!, b.y!) }
        ctx.stroke()
      }

      // Nodes: a path per colour, faded ones first.
      for (const pass of [true, false]) {
        const groups = new Map<string, SimNode[]>()
        for (const n of nodes) if (faded(n) === pass) { const g = groups.get(n.color); if (g) g.push(n); else groups.set(n.color, [n]) }
        ctx.globalAlpha = pass ? 0.18 : 1
        for (const [color, ns] of groups) {
          ctx.fillStyle = color
          ctx.beginPath()
          for (const n of ns) { ctx.moveTo(n.x! + n.r, n.y!); ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2) }
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
      const ringed = [hover, s.focus ? s.by.get(s.focus) : null].filter(Boolean) as SimNode[]
      for (const n of ringed) {
        ctx.strokeStyle = colors.fg
        ctx.lineWidth = 1.5 / t.k
        ctx.beginPath(); ctx.arc(n.x!, n.y!, n.r + 2.5 / t.k, 0, Math.PI * 2); ctx.stroke()
      }
      ctx.restore()

      // Labels in screen space (crisp at any zoom): the lit ones always, the rest once there's room.
      const size = s.compact ? 11 : 12
      ctx.font = `${size}px ${s.font}`
      ctx.textAlign = "center"
      ctx.textBaseline = "top"
      const all = nodes.length
      // A small graph (a block, the sidebar) names the file's own neighbours; the rest once zoomed in.
      const near = s.compact && s.focus ? adj.get(s.focus) : null
      const zoomLabels = t.k >= (s.compact ? 1.4 : all > 600 ? 1.6 : all > 150 ? 1.05 : 0.55)
      let drawn = 0
      for (const n of nodes) {
        const important = n === hover || (lit?.has(n.n.path) ?? false) || n.n.path === s.focus || (!!q && match(n) && all < 400) || (!lit && (near?.has(n.n.path) ?? false) && (near?.size ?? 0) <= 24)
        const big = n.r * t.k >= (s.compact ? 7 : 9)
        if (!important && !(zoomLabels || big)) continue
        if (!important && faded(n)) continue
        const sx = s.w / 2 + t.x + n.x! * t.k, sy = s.h / 2 + t.y + (n.y! + n.r) * t.k + 3
        if (sx < -80 || sx > s.w + 80 || sy < -20 || sy > s.h + 20) continue
        if (!important && ++drawn > 400) continue
        const text = n.label.length > 32 ? n.label.slice(0, 31) + "…" : n.label
        ctx.globalAlpha = important ? 1 : Math.min(1, 0.35 + (t.k - 0.5) * 0.6)
        ctx.lineWidth = 3
        ctx.strokeStyle = colors.bg
        ctx.strokeText(text, sx, sy)
        ctx.fillStyle = important && n === hover ? colors.fg : colors.muted
        ctx.fillText(text, sx, sy)
      }
      ctx.globalAlpha = 1
    }
    // Off screen (scrolled away, or in a tab kept drawn but hidden) it neither moves nor draws: it goes on when seen.
    let seen = true
    const io = new IntersectionObserver((es) => { seen = es[es.length - 1].isIntersecting; if (seen) s.dirty = true })
    io.observe(el)
    const loop = () => {
      frame = requestAnimationFrame(loop)
      if (!seen) return
      const sim = s.sim
      if (sim && sim.alpha() > sim.alphaMin()) {
        sim.tick(s.nodes.length > 1500 ? 1 : 2)
        if (!s.touched) fit(0.25)
        s.dirty = true
      }
      if (s.dirty) { s.dirty = false; draw() }
    }
    frame = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(frame)
      io.disconnect()
      ro.disconnect()
      el.removeEventListener("pointerdown", down)
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", up)
      el.removeEventListener("pointercancel", up)
      el.removeEventListener("pointerleave", leave)
      el.removeEventListener("wheel", wheel)
      el.removeEventListener("auxclick", aux)
      const pos = POS.get(scope)
      if (pos) for (const n of s.nodes) if (n.x !== undefined) pos.set(n.n.path, { x: n.x, y: n.y! })
      s.sim?.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={wrap} className="absolute inset-0 overflow-hidden" data-graph-canvas={scope} data-no-edit>
      <canvas ref={canvas} className="block cursor-grab touch-none select-none" data-graph-nodes={graph.nodes.length} data-graph-edges={graph.edges.length}
        aria-label={`Graph of ${graph.nodes.length} files and ${graph.edges.length} links`} role="img" />
      {refit === undefined && moved && (
        <button type="button" onClick={() => st.current.fit?.()} aria-label="Fit the graph" data-tip="Fit" data-graph-fit
          className="glass absolute right-2 bottom-2 grid size-7 cursor-pointer place-items-center rounded-[8px] text-muted-foreground hover:text-foreground max-md:size-9">
          <Maximize className="size-3.5" strokeWidth={2.25} />
        </button>
      )}
    </div>
  )
}
