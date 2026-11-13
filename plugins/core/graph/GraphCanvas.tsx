import { useEffect, useRef, useState } from "react"
import { Maximize } from "lucide-react"
import { forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force"
import { onLook, trackSoon } from "@vaultite"
import { nameOf, type Graph, type GraphEdge, type GraphNode } from "./graph"

type SimNode = SimulationNodeDatum & { n: GraphNode; r: number; tok: string; color: string; label: string; low: string; text: string; tw: number; tws: number; la: number }
type SimLink = SimulationLinkDatum<SimNode> & { e: GraphEdge; tok: string | null; color: string | null }

export type CanvasProps = {
  graph: Graph
  colorOf: (n: GraphNode) => string
  edgeColor?: (e: GraphEdge) => string | null
  arrows?: boolean
  look?: Look
  focus?: string
  search?: string
  onOpen: (path: string, newTab: boolean) => void
  scope: string
  compact?: boolean
  refit?: number
}

const POS = new Map<string, Map<string, { x: number; y: number }>>()

// Reading a token makes the browser work out the page's styles first: once per theme.
const tokens = new Map<string, string>()
let watching = false
function token(name: string, fallback: string) {
  if (!watching) {
    watching = true
    onLook(() => tokens.clear())
  }
  let v = tokens.get(name)
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    tokens.set(name, v)
  }
  return v || fallback
}

function recolour(nodes: SimNode[], links: SimLink[], p: { colorOf: (n: GraphNode) => string; edgeColor?: (e: GraphEdge) => string | null }) {
  for (const n of nodes) { n.tok = p.colorOf(n.n); n.color = token(n.tok, "#8e8e93") }
  for (const l of links) { l.tok = p.edgeColor?.(l.e) ?? null; l.color = l.tok ? token(l.tok, "") || null : null }
}

function labelRoom() {
  const CELL = 64, cells = new Map<number, number[]>(), boxes: number[] = []
  return {
    take(x0: number, y0: number, x1: number, y1: number, force = false) {
      const ca = Math.floor(x0 / CELL), cb = Math.floor(x1 / CELL), ra = Math.floor(y0 / CELL), rb = Math.floor(y1 / CELL)
      if (!force) {
        for (let cx = ca; cx <= cb; cx++) for (let cy = ra; cy <= rb; cy++) {
          const c = cells.get(cx * 4096 + cy)
          if (c) for (const i of c) if (boxes[i] < x1 && boxes[i + 2] > x0 && boxes[i + 1] < y1 && boxes[i + 3] > y0) return false
        }
      }
      const i = boxes.length
      boxes.push(x0, y0, x1, y1)
      for (let cx = ca; cx <= cb; cx++) for (let cy = ra; cy <= rb; cy++) { const k = cx * 4096 + cy, c = cells.get(k); if (c) c.push(i); else cells.set(k, [i]) }
      return true
    },
  }
}

const radius = (degree: number, compact?: boolean) => Math.min(compact ? 9 : 16, (compact ? 3 : 3.5) + Math.sqrt(degree) * (compact ? 1.2 : 1.7))

export type Look = { nodeSize?: number; lineWidth?: number; textFade?: number; repel?: number; linkDistance?: number; center?: number }
const num = (v: unknown, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? v : dflt)

function setForces(sim: Simulation<SimNode, SimLink>, look: Look, compact: boolean, many: boolean) {
  ;(sim.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>>).distance((compact ? 48 : 46) * num(look.linkDistance, 1))
  ;(sim.force("charge") as ReturnType<typeof forceManyBody<SimNode>>).strength((compact ? -150 : many ? -45 : -120) * num(look.repel, 1))
  for (const k of ["x", "y"]) (sim.force(k) as ReturnType<typeof forceX<SimNode>>).strength((many ? 0.06 : 0.05) * num(look.center, 1))
}

export default function GraphCanvas({ graph, colorOf, edgeColor, arrows, look = {}, focus, search, onOpen, scope, compact, refit }: CanvasProps) {
  const paint = useRef({ colorOf, edgeColor })
  paint.current = { colorOf, edgeColor }
  const looks = useRef(look)
  looks.current = look
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const st = useRef({
    nodes: [] as SimNode[], order: [] as SimNode[], links: [] as SimLink[], by: new Map<string, SimNode>(), adj: new Map<string, Set<string>>(),
    sim: null as Simulation<SimNode, SimLink> | null,
    t: { k: 1, x: 0, y: 0 }, w: 0, h: 0, dpr: 1, touched: false,
    drawn: false, wake: () => {}, get dirty() { return !this.drawn }, set dirty(v: boolean) { this.drawn = !v; if (v) this.wake() },
    hover: null as SimNode | null, search: "", focus: "", font: "system-ui", colors: { fg: "#000", muted: "#888", line: "#ccc", bg: "#fff", accent: "#07f" },
    onOpen, compact: !!compact, arrows: false, look: {} as Look, fit: null as (() => void) | null, setMoved: (_: boolean) => {},
  })
  const [moved, setMoved] = useState(false)
  st.current.onOpen = onOpen
  st.current.setMoved = setMoved

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
      return { n, x: pinned ? 0 : p.x, y: pinned ? 0 : p.y, fx: pinned ? 0 : undefined, fy: pinned ? 0 : undefined, r: radius(n.degree, compact) * num(looks.current.nodeSize, 1), tok: "", color: "", label: n.tag ? n.path : nameOf(n.path), low: `${nameOf(n.path)}\n${n.title}`.toLowerCase(), text: "", tw: 0, tws: 0, la: 0 }
    })
    for (const n of nodes) n.text = n.label.length > 32 ? n.label.slice(0, 31) + "…" : n.label
    const order = nodes.slice().sort((a, b) => b.n.degree - a.n.degree)
    const by = new Map(nodes.map((n) => [n.n.path, n]))
    const links: SimLink[] = graph.edges.flatMap((e) => (by.has(e.from) && by.has(e.to) ? [{ source: by.get(e.from)!, target: by.get(e.to)!, e, tok: null, color: null }] : []))
    recolour(nodes, links, paint.current)
    s.sim?.stop()
    const many = nodes.length > 800
    const sim = forceSimulation<SimNode, SimLink>(nodes)
      .force("link", forceLink<SimNode, SimLink>(links).strength((l) => 1 / Math.min((adj.get((l.source as SimNode).n.path)?.size ?? 1), (adj.get((l.target as SimNode).n.path)?.size ?? 1)) * 0.7))
      .force("charge", forceManyBody<SimNode>().theta(many ? 1.1 : 0.9).distanceMax(many ? 420 : 700))
      .force("x", forceX<SimNode>(0))
      .force("y", forceY<SimNode>(0))
      .alphaDecay(many ? 0.045 : 0.03)
      .stop()
    setForces(sim, looks.current, !!compact, many)
    sim.alpha(fresh > nodes.length / 3 ? 1 : fresh ? 0.3 : 0.08)
    Object.assign(s, { nodes, order, links, by, adj, sim, dirty: true })
    if (s.hover && !by.has(s.hover.n.path)) s.hover = null
  }, [graph, scope, focus, compact])
  useEffect(() => { recolour(st.current.nodes, st.current.links, { colorOf, edgeColor }); st.current.dirty = true }, [colorOf, edgeColor])

  useEffect(() => { st.current.search = (search ?? "").trim().toLowerCase(); st.current.dirty = true }, [search])
  useEffect(() => { st.current.focus = focus ?? ""; st.current.dirty = true }, [focus])
  useEffect(() => { st.current.arrows = !!arrows; st.current.dirty = true }, [arrows])
  const { nodeSize, lineWidth, textFade, repel, linkDistance, center } = look
  useEffect(() => {
    const s = st.current
    s.look = { nodeSize, lineWidth, textFade }
    for (const n of s.nodes) n.r = radius(n.n.degree, compact) * num(nodeSize, 1)
    s.dirty = true
  }, [nodeSize, lineWidth, textFade, compact])
  const stirred = useRef(false)
  useEffect(() => {
    const sim = st.current.sim
    if (!sim || !stirred.current) { stirred.current = true; return }
    setForces(sim, { repel, linkDistance, center }, !!compact, st.current.nodes.length > 800)
    if (sim.alpha() < 0.3) sim.alpha(0.3)
    st.current.dirty = true
  }, [repel, linkDistance, center, compact])
  useEffect(() => { if (refit) st.current.fit?.() }, [refit])

  useEffect(() => {
    const read = () => {
      const s = st.current
      s.colors = { fg: token("--foreground", "#1c1c1e"), muted: token("--muted-foreground", "#86868b"), line: token("--muted-foreground", "#86868b"), bg: token("--background", "#fff"), accent: token("--primary", "#007aff") }
      for (const n of s.nodes) n.color = token(n.tok, n.color)
      for (const l of s.links) if (l.tok) l.color = token(l.tok, l.color ?? "")
      if (canvas.current) s.font = getComputedStyle(canvas.current).fontFamily || "system-ui"
      for (const n of s.nodes) n.tws = 0
      s.dirty = true
    }
    read()
    return onLook(() => { tokens.clear(); read() })
  }, [])

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
      // A trackpad pinch arrives as a wheel event with ctrlKey.
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
      el.dataset.graphHover = hover?.n.path ?? ""
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, s.w, s.h)
      ctx.save()
      ctx.translate(s.w / 2 + t.x, s.h / 2 + t.y)
      ctx.scale(t.k, t.k)
      const lit = hover ? adj.get(hover.n.path) ?? new Set<string>() : null
      const q = s.search
      const match = (n: SimNode) => !q || n.low.includes(q)
      const faded = (n: SimNode) => (lit ? n !== hover && !lit.has(n.n.path) : false)

      const lw = num(s.look.lineWidth, 1)
      ctx.lineWidth = Math.max(0.35 * lw, (s.compact ? 0.8 : 0.9) * lw / t.k)
      ctx.strokeStyle = colors.line
      ctx.globalAlpha = lit ? 0.12 : nodes.length > 1000 ? 0.28 : 0.4
      ctx.beginPath()
      const hot: SimLink[] = [], plain: SimLink[] = []
      const own = new Map<string, SimLink[]>()
      for (const l of links) {
        const a = l.source as SimNode, b = l.target as SimNode
        if (hover && (a === hover || b === hover)) { hot.push(l); continue }
        if (l.color) { const g = own.get(l.color); if (g) g.push(l); else own.set(l.color, [l]); continue }
        plain.push(l)
        ctx.moveTo(a.x!, a.y!); ctx.lineTo(b.x!, b.y!)
      }
      ctx.stroke()
      const heads = (ls: SimLink[]) => {
        if (!s.arrows || !ls.length) return
        const size = Math.max(4, ctx.lineWidth * 4)
        ctx.fillStyle = ctx.strokeStyle
        ctx.beginPath()
        for (const l of ls) {
          const a = l.source as SimNode, b = l.target as SimNode
          for (const [from, to] of l.e.both ? [[a, b], [b, a]] : [[a, b]]) {
            const dx = to.x! - from.x!, dy = to.y! - from.y!, d = Math.hypot(dx, dy)
            if (d < to.r + size) continue
            const ux = dx / d, uy = dy / d, tipX = to.x! - ux * to.r, tipY = to.y! - uy * to.r
            ctx.moveTo(tipX, tipY)
            ctx.lineTo(tipX - ux * size - uy * size * 0.5, tipY - uy * size + ux * size * 0.5)
            ctx.lineTo(tipX - ux * size + uy * size * 0.5, tipY - uy * size - ux * size * 0.5)
            ctx.closePath()
          }
        }
        ctx.fill()
      }
      heads(plain)
      if (own.size) {
        const alpha = ctx.globalAlpha
        ctx.globalAlpha = lit ? alpha : Math.min(1, alpha + 0.35)
        for (const [color, ls] of own) {
          ctx.strokeStyle = color
          ctx.beginPath()
          for (const l of ls) { const a = l.source as SimNode, b = l.target as SimNode; ctx.moveTo(a.x!, a.y!); ctx.lineTo(b.x!, b.y!) }
          ctx.stroke()
          heads(ls)
        }
        ctx.globalAlpha = alpha
      }
      if (hot.length) {
        ctx.globalAlpha = 0.9
        ctx.strokeStyle = colors.accent
        ctx.lineWidth = Math.max(0.8 * lw, 1.4 * lw / t.k)
        ctx.beginPath()
        for (const l of hot) { const a = l.source as SimNode, b = l.target as SimNode; ctx.moveTo(a.x!, a.y!); ctx.lineTo(b.x!, b.y!) }
        ctx.stroke()
        heads(hot)
      }

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

      const size = s.compact ? 11 : 12
      ctx.font = `${size}px ${s.font}`
      ctx.textAlign = "center"
      ctx.textBaseline = "top"
      const all = nodes.length
      const near = s.compact && s.focus ? adj.get(s.focus) : null
      const fade = Math.pow(2, num(s.look.textFade, 0) / 2)
      const zoomLabels = t.k >= (s.compact ? 1.4 : all > 600 ? 1.6 : all > 150 ? 1.05 : 0.55) * fade
      const room = labelRoom()
      const shown: [SimNode, number, number, number][] = []
      let drawn = 0, fading = false
      const focusNode = s.focus ? s.by.get(s.focus) : undefined
      const firsts = [hover, focusNode].filter((n, i, a): n is SimNode => !!n && a.indexOf(n) === i)
      const important = (n: SimNode) => (lit?.has(n.n.path) ?? false) || (!!q && match(n) && all < 400) || (!lit && (near?.has(n.n.path) ?? false) && (near?.size ?? 0) <= 24)
      const leads = !!lit || !!q || !!near
      for (const pass of leads ? [0, 1, 2] : [0, 2]) {
        for (const n of pass === 0 ? firsts : s.order) {
          if (pass && firsts.includes(n)) continue
          const must = pass === 0, lead = must || (leads && important(n))
          if (pass === 1 && !lead) continue
          if (pass === 2 && lead) continue
          const big = n.r * t.k >= (s.compact ? 7 : 9) * fade
          const want = lead || ((zoomLabels || big) && !faded(n))
          const sx = s.w / 2 + t.x + n.x! * t.k, sy = s.h / 2 + t.y + (n.y! + n.r) * t.k + 3
          if (!want || sx < -80 || sx > s.w + 80 || sy < -20 || sy > s.h + 20 || (!lead && drawn >= 400)) { n.la = 0; continue }
          if (n.tws !== size) { n.tw = ctx.measureText(n.text).width; n.tws = size }
          const fits = room.take(sx - n.tw / 2 - 4, sy - 1, sx + n.tw / 2 + 4, sy + size + 2, must)
          if (fits && !lead) drawn++
          const goal = fits ? 1 : 0
          n.la = must ? 1 : Math.abs(goal - n.la) < 0.04 ? goal : n.la + (goal - n.la) * 0.3
          if (n.la !== goal) fading = true
          if (n.la > 0) shown.push([n, sx, sy, (lead ? 1 : Math.min(1, 0.35 + (t.k - 0.5) * 0.6)) * n.la])
        }
      }
      ;(el as HTMLCanvasElement & { labels?: unknown }).labels = () => shown.map(([n, sx, sy, alpha]) => ({ text: n.text, x0: sx - n.tw / 2, x1: sx + n.tw / 2, y0: sy, y1: sy + size, alpha, full: n.la === 1 }))
      for (const [n, sx, sy, alpha] of shown) {
        ctx.globalAlpha = alpha
        ctx.lineWidth = 3
        ctx.strokeStyle = colors.bg
        ctx.strokeText(n.text, sx, sy)
        ctx.fillStyle = n === hover ? colors.fg : colors.muted
        ctx.fillText(n.text, sx, sy)
      }
      if (fading) s.dirty = true
      ctx.globalAlpha = 1
    }
    let seen = true, untrack = trackSoon("the graph's layout", () => frame !== 0)
    const io = new IntersectionObserver((es) => { seen = es[es.length - 1].isIntersecting; if (seen) s.dirty = true })
    io.observe(el)
    const loop = () => {
      frame = 0
      if (!seen) return
      const sim = s.sim, moving = !!sim && sim.alpha() > sim.alphaMin()
      if (moving) {
        sim.tick(s.nodes.length > 1500 ? 1 : 2)
        if (!s.touched) fit(0.25)
        s.drawn = false
      }
      if (!s.drawn) { s.drawn = true; draw() }
      if (moving && !frame) frame = requestAnimationFrame(loop)
    }
    s.wake = () => { if (!frame && seen) frame = requestAnimationFrame(loop) }
    s.wake()
    return () => {
      untrack(); s.wake = () => {}
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
