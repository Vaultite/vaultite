// A .canvas drawn as an infinite board; the file's text is the only state. Panning and zooming never
// redraw React: the view lives in a ref written straight to the stage, and only cards near the screen are drawn.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as RDragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent as RPointerEvent } from "react"
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, ArrowLeftRight, ArrowRight, ArrowUpRight,
  ClipboardPaste, Copy, CopyPlus, FilePlus2, FileText, Globe, Group as GroupIcon, Magnet, Maximize, Minus, MoveRight, Palette, Pencil, Plus, Redo2, Scan, Scissors, StickyNote, Trash2, Type, Undo2, Ungroup,
} from "lucide-react"
import { choose, cn, createFile, menuBelow, newNoteFolder, openFile, openMenu, put, saveAttachments, useDropTarget, useLive, type FormatCtx, type MenuItem } from "@vaultite"
import { colorOf, newId, parseCanvas, PRESET_NAMES, type CanvasDoc, type CanvasEdge, type CanvasNode, type Side, writeCanvas } from "./codec"
import { align, copyText, directionOf, duplicate, insert, nameFromText, pastedCanvas, remove, reverse, setDirection, slice, ungroup, withContents, type Align, type Direction } from "./edit"
import { anchor, bounds, fitView, GRID, nearestSide, overlaps, placeFrom, resizeBox, snapMove, within, zoomAbout, type Box, type Dir, type Guide, type Pt, type View } from "./geometry"
import { Card, Group, type CardEvents } from "./Card"
import { Edge } from "./Edges"
import { edgePath, isImage, px } from "./look"
import { registerBoard, type BoardKeys } from "./keys"

/** Zoomed out past this, cards are drawn as their colour and name. */
const FAR_K = 0.3
const DOTS = "radial-gradient(circle, color-mix(in srgb, var(--muted-foreground) 28%, transparent) 1px, transparent 1px)"
/** How near (screen px) a card's edge must come to another's to snap to it. */
const SNAP_PX = 6

type Settings = { snapToGrid?: boolean; snapToObjects?: boolean }
type Rect = { x0: number; y0: number; x1: number; y1: number }

type Drag =
  | { kind: "pan"; sx: number; sy: number; view: View; moved: boolean }
  | { kind: "move"; sx: number; sy: number; start: Map<string, Pt>; box: Box; others: Box[]; base: CanvasDoc; moved: boolean; wasSelected: boolean; id: string; touch: boolean }
  | { kind: "resize"; id: string; dir: Dir; sx: number; sy: number; start: Box; others: Box[]; base: CanvasDoc; image: boolean }
  | { kind: "connect"; from: string; side: Side; to: Pt; over: string | null }
  | { kind: "end"; edge: string; end: "from" | "to"; to: Pt; over: string | null }
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number; add: Set<string> }

type Editing = { kind: "text" | "file" | "label" | "edge"; id: string } | null

const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest("textarea, input, [contenteditable=''], [contenteditable='true'], .cm-editor")
const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim())
const NEW = Symbol("new card")
const isNote = (n: CanvasNode | undefined) => n?.type === "file" && /\.md$/i.test(String(n.file ?? ""))

export default function Board({ store, text, editable, onChange, place, path }: FormatCtx) {
  const embed = place === "embed"
  const interactive = !embed
  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const zoomLabel = useRef<HTMLSpanElement>(null)
  const [doc, setDoc] = useState<CanvasDoc>(() => { try { return parseCanvas(text) } catch { return { nodes: [], edges: [] } } })
  const [error, setError] = useState<string | null>(() => { try { parseCanvas(text); return null } catch (e) { return (e as Error).message } })
  const docRef = useRef(doc)
  docRef.current = doc
  const last = useRef(text)
  const viewRef = useRef<View>({ x: 0, y: 0, k: 1 })
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [selEdge, setSelEdge] = useState<string | null>(null)
  const [editing, setEditingState] = useState<Editing>(null)
  const editingRef = useRef<Editing>(null)
  const setEditing = (e: Editing) => { editingRef.current = e; setEditingState(e) }
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  const [spacePan, setSpacePan] = useState(false)
  const undo = useRef<CanvasDoc[]>([])
  const redo = useRef<CanvasDoc[]>([])
  const [, setHistory] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fitted = useRef(false)
  /** The canvas before the edit going on (one undo when it ends), or NEW: a card just added, its text part of that. */
  const editBase = useRef<CanvasDoc | typeof NEW | null>(null)
  const lastPointer = useRef<Pt | null>(null)

  // Snapping: the plugin's settings (.vaultite/plugins/canvas/data.json), changed here at once.
  const { data: saved } = useLive<Settings>(embed ? null : "canvas/settings")
  const [mine, setMine] = useState<Settings>({})
  const settings = { ...saved, ...mine }
  const snapToGrid = settings.snapToGrid !== false, snapToObjects = settings.snapToObjects !== false
  const setSetting = (patch: Settings) => { setMine((m) => ({ ...m, ...patch })); put("canvas/settings", patch).catch(() => {}) }

  // A change made elsewhere (on disk, another device): drawn as it is.
  useEffect(() => {
    if (text === last.current) return
    last.current = text
    try {
      const next = parseCanvas(text)
      docRef.current = next
      setDoc(next)
      setError(null)
      setSel((s) => new Set([...s].filter((id) => next.nodes.some((n) => n.id === id))))
      if (embed) fitted.current = false
    } catch (e) { setError((e as Error).message) }
  }, [text, embed])

  const flush = useRef<() => void>(() => {})
  const save = useCallback((next: CanvasDoc) => {
    flush.current = () => {
      timer.current = null
      const out = writeCanvas(next, last.current)
      if (out === last.current) return
      last.current = out
      onChange(out)
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => flush.current(), 300)
  }, [onChange])
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); flush.current() } }, [])

  /** A change drawn and saved, not undoable by itself (typing in a card: the edit is one undo when it ends). */
  const live = (next: CanvasDoc) => { docRef.current = next; setDoc(next); save(next) }
  /** A change the user made: drawn, undoable, saved. `before`: the canvas it started from (a drag's start). */
  const commit = (next: CanvasDoc, before: CanvasDoc = docRef.current) => {
    if (!editable || next === before) return
    undo.current.push(before)
    if (undo.current.length > 200) undo.current.shift()
    redo.current = []
    live(next)
    setHistory((h) => h + 1)
  }
  const step = (back: boolean) => {
    endEdit()
    const from = back ? undo.current : redo.current, to = back ? redo.current : undo.current
    const d = from.pop()
    if (!d) return
    to.push(docRef.current)
    live(d)
    setHistory((h) => h + 1)
  }

  // ---- the view: written to the DOM, not drawn by React
  const [win, setWin] = useState<(Rect & { far: boolean }) | null>(null)
  const winRef = useRef(win)
  winRef.current = win
  const cullFrame = useRef(0)
  const cull = () => {
    cullFrame.current = 0
    const el = box.current
    if (!el) return
    const v = viewRef.current, w = el.clientWidth / v.k, h = el.clientHeight / v.k
    const seen = { x0: -v.x / v.k, y0: -v.y / v.k, x1: -v.x / v.k + w, y1: -v.y / v.k + h }
    const far = v.k < FAR_K
    const cur = winRef.current
    // (kept while what's seen is inside it and it isn't much bigger than needed: zooming in from far out shrinks it)
    if (cur && cur.far === far && seen.x0 >= cur.x0 && seen.y0 >= cur.y0 && seen.x1 <= cur.x1 && seen.y1 <= cur.y1 && cur.x1 - cur.x0 < 4 * w) return
    // A screen's worth around what's seen, so a pan draws again only once it has gone that far.
    const next = { x0: seen.x0 - w, y0: seen.y0 - h, x1: seen.x1 + w, y1: seen.y1 + h, far }
    winRef.current = next
    setWin(next)
  }
  // The bar over the selection, in screen space (its size never follows the zoom): above what's selected, under it when
  // there's no room above, always inside the board.
  const bar = useRef<HTMLDivElement>(null)
  const barAt = useRef<{ x: number; top: number; bottom: number } | null>(null)
  const placeBar = () => {
    const el = bar.current, at = barAt.current, root = box.current
    if (!el || !at || !root) return
    const v = viewRef.current, w = el.offsetWidth, h = el.offsetHeight, gap = 10
    let y = at.top * v.k + v.y - h - gap
    if (y < gap) y = at.bottom * v.k + v.y + gap
    if (y + h > root.clientHeight - gap) y = gap
    const x = Math.max(gap, Math.min(root.clientWidth - w - gap, at.x * v.k + v.x - w / 2))
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
  }
  const paint = () => {
    const v = viewRef.current, el = box.current, st = stage.current
    if (!el || !st) return
    st.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`
    // The zoom only when it changes: every card's styles read --k, and even the label's text set again (the same text)
    // makes the browser restyle the whole page; panning changes neither.
    if (el.style.getPropertyValue("--k") !== String(v.k)) {
      el.style.setProperty("--k", String(v.k))
      if (zoomLabel.current) zoomLabel.current.textContent = `${Math.round(v.k * 100)}%`
    }
    // The dot grid, gone when it would be a haze (zoomed far out).
    const dots = GRID * v.k >= 8 ? "on" : "off"
    if (el.dataset.dots !== dots) { el.dataset.dots = dots; el.style.backgroundImage = dots === "on" ? DOTS : "none" }
    el.style.backgroundSize = `${GRID * v.k}px ${GRID * v.k}px`
    el.style.backgroundPosition = `${v.x}px ${v.y}px`
    placeBar()
    if (!cullFrame.current) cullFrame.current = requestAnimationFrame(cull)
  }
  const anim = useRef(0)
  const setView = (v: View) => { if (anim.current) { cancelAnimationFrame(anim.current); anim.current = 0 } viewRef.current = v; paint() }
  /** The view eased to `to` (fit, the zoom buttons), the point in the middle moving straight. */
  const animateTo = (to: View) => {
    const el = box.current
    if (!el) return
    if (anim.current) cancelAnimationFrame(anim.current)
    const from = viewRef.current, w = el.clientWidth / 2, h = el.clientHeight / 2
    const c0 = { x: (w - from.x) / from.k, y: (h - from.y) / from.k }, c1 = { x: (w - to.x) / to.k, y: (h - to.y) / to.k }
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 240), e = 1 - Math.pow(1 - p, 3)
      const k = from.k * Math.pow(to.k / from.k, e)
      const cx = c0.x + (c1.x - c0.x) * e, cy = c0.y + (c1.y - c0.y) * e
      viewRef.current = p >= 1 ? to : { k, x: w - cx * k, y: h - cy * k }
      paint()
      anim.current = p < 1 ? requestAnimationFrame(tick) : 0
    }
    anim.current = requestAnimationFrame(tick)
  }
  useEffect(() => () => { cancelAnimationFrame(anim.current); cancelAnimationFrame(cullFrame.current) }, [])

  // Fit it in its box when it's first drawn (and an embed whenever it changes size or content).
  const fitKey = embed ? doc : null
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return
      if (fitted.current && !embed) { cull(); return }
      fitted.current = true
      viewRef.current = fitView(docRef.current.nodes, r.width, r.height, embed ? 16 : 48, 1)
      paint()
      cull()
    }
    fit()
    const ro = new ResizeObserver(() => { if (embed) fitted.current = false; fit() })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embed, fitKey])

  const size = () => { const r = box.current!.getBoundingClientRect(); return { w: r.width, h: r.height } }
  const fitAll = () => { const { w, h } = size(); animateTo(fitView(docRef.current.nodes, w, h, 48, 1)) }
  const fitSelection = () => {
    const e = selEdge ? docRef.current.edges.find((x) => x.id === selEdge) : null
    const chosen = docRef.current.nodes.filter((n) => (e ? n.id === e.fromNode || n.id === e.toNode : sel.has(n.id)))
    if (!chosen.length) return fitAll()
    const { w, h } = size()
    animateTo(fitView(chosen, w, h, 80, 1.5))
  }
  const zoomBy = (f: number) => { const { w, h } = size(); animateTo(zoomAbout(viewRef.current, viewRef.current.k * f, w / 2, h / 2)) }
  const zoomTo100 = () => { const { w, h } = size(); animateTo(zoomAbout(viewRef.current, 1, w / 2, h / 2)) }
  // The keyboard's pan and zoom commands (keys.ts) reach this board through these, the latest of them.
  const keyed = useRef<BoardKeys | null>(null)
  keyed.current = {
    box: box.current,
    pan: (dx, dy) => { const v = viewRef.current; setView({ ...v, x: v.x - dx, y: v.y - dy }) },
    zoom: zoomBy, fit: fitAll, selected: () => sel.size > 0 || !!selEdge,
  }
  useEffect(() => registerBoard(() => ({ ...keyed.current!, box: box.current })), [])

  const toWorld = (cx: number, cy: number): Pt => {
    const r = box.current!.getBoundingClientRect(), v = viewRef.current
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k }
  }
  const nodeAt = (p: Pt, except?: string) => {
    const ns = docRef.current.nodes.filter((n) => n.id !== except && p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height)
    return ns.findLast((n) => n.type !== "group") ?? ns[ns.length - 1] ?? null
  }
  const viewCentre = (): Pt => { const r = box.current!.getBoundingClientRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2) }
  /** Where something pasted goes: the pointer, when it's over the board, else the middle of the view. */
  const pastePoint = (): Pt => {
    const p = lastPointer.current, r = box.current?.getBoundingClientRect()
    return p && r && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom ? toWorld(p.x, p.y) : viewCentre()
  }
  const taken = () => new Set([...docRef.current.nodes.map((n) => n.id), ...docRef.current.edges.map((e) => e.id)])
  const focusBoard = () => box.current?.focus({ preventScroll: true })
  const select = (ids: Iterable<string>) => { setSel(new Set(ids)); setSelEdge(null) }

  // ---- editing a card's text, a note, a label
  /** Stop editing: a text card grows to fit what was written, and the whole edit is one undo. */
  function endEdit() {
    const ed = editingRef.current
    if (!ed) return
    setEditing(null)
    if (ed.kind === "text") {
      const el = box.current?.querySelector<HTMLElement>(`[data-canvas-node="${CSS.escape(ed.id)}"] .canvas-edit`)
      const n = docRef.current.nodes.find((x) => x.id === ed.id)
      const h = el ? Math.ceil(el.scrollHeight) + 4 : 0
      if (n && h > n.height) live({ ...docRef.current, nodes: docRef.current.nodes.map((x) => (x.id === n.id ? { ...x, height: h } : x)) })
    }
    const base = editBase.current
    editBase.current = null
    if (base && base !== NEW && base !== docRef.current) { undo.current.push(base); redo.current = []; setHistory((x) => x + 1) }
  }
  const beginEdit = (n: CanvasNode) => {
    if (!editable) return
    endEdit()
    const kind = n.type === "group" ? "label" : n.type === "text" ? "text" : isNote(n) ? "file" : null
    if (!kind) return
    if (kind === "text") editBase.current = docRef.current
    select([n.id])
    setEditing({ kind, id: n.id })
  }

  const events = useRef<CardEvents>(null!)
  events.current = {
    typed: (id, t) => {
      editBase.current ??= docRef.current
      live({ ...docRef.current, nodes: docRef.current.nodes.map((n) => (n.id === id ? { ...n, text: t } : n)) })
    },
    done: (id) => { if (editingRef.current?.id === id) { endEdit(); focusBoard() } },
    open: (n, newTab) => openNode(n, newTab),
  }
  const labelDone = useRef<(id: string, t: string | null) => void>(null!)
  labelDone.current = (id, t) => {
    setEditing(null)
    focusBoard()
    const n = docRef.current.nodes.find((x) => x.id === id)
    if (n && t !== null && t !== String(n.label ?? "")) patchNode(id, { label: t })
  }
  const onGroupLabel = useCallback((id: string, t: string | null) => labelDone.current(id, t), [])

  // ---- adding things
  const addNode = (node: Omit<CanvasNode, "id">, opts: { edit?: boolean; from?: { id: string; side: Side; toSide: Side } } = {}) => {
    const n = { id: newId(taken()), ...node } as CanvasNode
    // Groups go first: they're drawn behind the cards.
    const nodes = n.type === "group" ? [n, ...docRef.current.nodes] : [...docRef.current.nodes, n]
    const edges = opts.from ? [...docRef.current.edges, { id: newId(new Set([...taken(), n.id])), fromNode: opts.from.id, fromSide: opts.from.side, toNode: n.id, toSide: opts.from.toSide } as CanvasEdge] : docRef.current.edges
    commit({ ...docRef.current, nodes, edges })
    select([n.id])
    if (opts.edit) {
      // (a new card's text is part of adding it: one undo takes both away)
      if (n.type === "group") setEditing({ kind: "label", id: n.id })
      else if (n.type === "text") { editBase.current = NEW; setEditing({ kind: "text", id: n.id }) }
    } else focusBoard()
    return n
  }
  const addCard = (at?: Pt) => {
    const c = at ?? viewCentre()
    addNode({ type: "text", text: "", x: Math.round(c.x - 125), y: Math.round(c.y - 30), width: 250, height: 60 }, { edit: true })
  }
  const fileSize = (p: string) => (isImage(p) ? { width: 400, height: 300 } : /\.(mp3|m4a|wav|ogg|flac|aac)$/i.test(p) ? { width: 400, height: 120 } : { width: 400, height: 400 })
  const addFileAt = (file: string, c: Pt, from?: { id: string; side: Side; anchor: Pt }) => {
    const s = fileSize(file)
    if (from) {
      const { box: b, side } = placeFrom(c, from.anchor, s.width, s.height)
      return addNode({ type: "file", file, ...b }, { from: { id: from.id, side: from.side, toSide: side } })
    }
    return addNode({ type: "file", file, x: Math.round(c.x - s.width / 2), y: Math.round(c.y - s.height / 2), ...s })
  }
  const pickFile = (onPick: (p: string) => void) => {
    const all = [...store.files.files.map((f) => f.path), ...store.files.others.map((f) => f.path)].filter((p) => p !== path)
    choose({ title: "Add a note or a file", placeholder: "Find a note or a file", items: all.map((p) => ({ id: p, label: p })), onPick: (it) => onPick(it.id) })
  }
  const pickLink = (onPick: (url: string) => void) => choose({
    title: "Add a web page", placeholder: "Type or paste an address", items: [],
    empty: "Type an address, like https://example.com",
    other: (typed) => (typed.trim() ? { id: typed.trim(), label: `Add ${typed.trim()}` } : null),
    onPick: (it) => onPick(/^[a-z][\w+.-]*:/i.test(it.id) ? it.id : `https://${it.id}`),
  })
  const addFile = (at?: Pt) => pickFile((p) => addFileAt(p, at ?? viewCentre()))
  const addLinkAt = (url: string, c: Pt) => addNode({ type: "link", url, x: Math.round(c.x - 200), y: Math.round(c.y - 60), width: 400, height: 120 })
  const addLink = (at?: Pt) => pickLink((url) => addLinkAt(url, at ?? viewCentre()))
  const addGroup = (at?: Pt) => {
    const chosen = docRef.current.nodes.filter((n) => sel.has(n.id))
    const b = bounds(chosen)
    const c = at ?? viewCentre()
    const g = b ? { x: b.x0 - 40, y: b.y0 - 60, width: b.x1 - b.x0 + 80, height: b.y1 - b.y0 + 100 } : { x: c.x - 250, y: c.y - 180, width: 500, height: 360 }
    addNode({ type: "group", label: "Group", ...g }, { edit: true })
  }
  /** An arrow let go in empty space: a new card there, connected, of the kind picked from a menu. */
  const connectInto = (from: CanvasNode, side: Side, p: Pt, client: Pt) => {
    const a = anchor(from, side)
    openMenu(client, [
      { label: "Card", icon: StickyNote, run: () => {
        const { box: b, side: to } = placeFrom(p, a, 250, 60)
        addNode({ type: "text", text: "", ...b }, { edit: true, from: { id: from.id, side, toSide: to } })
      } },
      { label: "Note or file", icon: FileText, run: () => pickFile((f) => addFileAt(f, p, { id: from.id, side, anchor: a })) },
      { label: "Web page", icon: Globe, run: () => pickLink((url) => {
        const { box: b, side: to } = placeFrom(p, a, 400, 120)
        addNode({ type: "link", url, ...b }, { from: { id: from.id, side, toSide: to } })
      }) },
    ])
  }

  // ---- changing what's selected
  const removeSelected = () => {
    const d = docRef.current
    if (selEdge) { commit({ ...d, edges: d.edges.filter((e) => e.id !== selEdge) }); setSelEdge(null); return }
    if (!sel.size) return
    commit(remove(d, sel))
    setSel(new Set())
  }
  const recolour = (color: string | null) => {
    const d = docRef.current
    const set = <T extends { color?: string }>(x: T): T => { const y = { ...x }; if (color) y.color = color; else delete y.color; return y }
    if (selEdge) commit({ ...d, edges: d.edges.map((e) => (e.id === selEdge ? set(e) : e)) })
    else commit({ ...d, nodes: d.nodes.map((n) => (sel.has(n.id) ? set(n) : n)) })
  }
  const colourItems = (): MenuItem[] => {
    const current = selEdge ? doc.edges.find((x) => x.id === selEdge)?.color : doc.nodes.find((n) => sel.has(n.id))?.color
    return [{ label: "No colour", checked: !current, run: () => recolour(null) },
      ...Object.entries(PRESET_NAMES).map(([id, label]) => ({ label, checked: current === id, run: () => recolour(id) }))]
  }
  function patchNode(id: string, patch: Partial<CanvasNode>) {
    const d = docRef.current
    commit({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })
  }
  const patchEdge = (id: string, change: (e: CanvasEdge) => CanvasEdge) => {
    const d = docRef.current
    commit({ ...d, edges: d.edges.map((e) => (e.id === id ? change(e) : e)) })
  }
  const setLabel = (id: string, t: string) => patchEdge(id, (e) => { const y: CanvasEdge = { ...e, label: t }; if (!t) delete y.label; return y })
  const directionItems = (id: string): MenuItem[] => {
    const e = doc.edges.find((x) => x.id === id)
    const now = e ? directionOf(e) : "forward"
    const set = (d: Direction) => () => patchEdge(id, (x) => setDirection(x, d))
    return [
      { label: "No arrows", icon: Minus, checked: now === "none", run: set("none") },
      { label: "One-way", icon: MoveRight, checked: now === "forward", run: set("forward") },
      { label: "Two-way", icon: ArrowLeftRight, checked: now === "both", run: set("both") },
      { label: "Reverse", icon: ArrowRight, sep: true, run: () => patchEdge(id, reverse) },
    ]
  }
  const alignItems = (): MenuItem[] => {
    const a = (how: Align) => () => commit(align(docRef.current, sel, how))
    return [
      { label: "Left", icon: AlignStartVertical, run: a("left") }, { label: "Centre", icon: AlignCenterVertical, run: a("center") }, { label: "Right", icon: AlignEndVertical, run: a("right") },
      { label: "Top", icon: AlignStartHorizontal, sep: true, run: a("top") }, { label: "Middle", icon: AlignCenterHorizontal, run: a("middle") }, { label: "Bottom", icon: AlignEndHorizontal, run: a("bottom") },
    ]
  }
  const dup = () => {
    if (!sel.size) return
    const { doc: next, ids } = duplicate(docRef.current, sel)
    commit(next)
    select(ids)
  }
  const doUngroup = () => { commit(ungroup(docRef.current, sel)); setSel(new Set()) }
  const convertToFile = async (n: CanvasNode) => {
    try {
      // (where new notes go: Notes, unless the vault says otherwise)
      const f = await createFile(newNoteFolder(store, path), nameFromText(String(n.text ?? "")), String(n.text ?? ""))
      const d = docRef.current
      commit({ ...d, nodes: d.nodes.map((x) => { if (x.id !== n.id) return x; const { text: _t, ...rest } = x; return { ...rest, type: "file", file: f.path } as CanvasNode }) })
    } catch { /* told by the app */ }
  }
  function openNode(n: CanvasNode, newTab = false) {
    if (n.type === "file" && n.file) openFile(String(n.file), { newTab })
    else if (n.type === "link" && n.url && /^https?:/i.test(String(n.url))) window.open(String(n.url), "_blank", "noopener,noreferrer")
  }

  // ---- copy and paste
  const selectionText = () => copyText(slice(docRef.current, withContents(docRef.current, sel)))
  const cutSelection = () => { commit(remove(docRef.current, withContents(docRef.current, sel))); setSel(new Set()) }
  const pasteText = (t: string, at = pastePoint()) => {
    const part = pastedCanvas(t)
    if (part) {
      const b = bounds(part.nodes)!
      const { doc: next, ids } = insert(docRef.current, part, Math.round(at.x - (b.x0 + b.x1) / 2), Math.round(at.y - (b.y0 + b.y1) / 2))
      commit(next)
      select(ids)
    } else if (isUrl(t)) addLinkAt(t.trim(), at)
    else if (t.trim()) {
      const lines = t.trim().split("\n").length
      addNode({ type: "text", text: t.trim(), x: Math.round(at.x - 150), y: Math.round(at.y - 40), width: 300, height: Math.min(480, 34 + lines * 21) })
    }
  }
  const pasteFiles = async (files: File[], at = pastePoint()) => {
    try {
      const paths = await saveAttachments(store, path, files)
      paths.forEach((p, i) => addFileAt(p, { x: at.x + i * 40, y: at.y + i * 40 }))
    } catch { /* told by the app */ }
  }
  const pasteFromMenu = async (at: Pt) => {
    try {
      for (const it of await navigator.clipboard.read()) {
        const img = it.types.find((t) => t.startsWith("image/"))
        if (img) { const b = await it.getType(img); await pasteFiles([new File([b], `Pasted image.${img.split("/")[1] ?? "png"}`, { type: img })], at); return }
      }
      pasteText(await navigator.clipboard.readText(), at)
    } catch { /* no access to the clipboard */ }
  }
  // The clipboard's events, while the board (not a field in it) has the keyboard.
  const clip = useRef({ copy: (_e: ClipboardEvent) => {}, cut: (_e: ClipboardEvent) => {}, paste: (_e: ClipboardEvent) => {} })
  clip.current = {
    copy: (e) => { if (sel.size && e.clipboardData) { e.preventDefault(); e.clipboardData.setData("text/plain", selectionText()) } },
    cut: (e) => { if (editable && sel.size && e.clipboardData) { e.preventDefault(); e.clipboardData.setData("text/plain", selectionText()); cutSelection() } },
    paste: (e) => {
      if (!editable || !e.clipboardData) return
      e.preventDefault()
      const files = [...e.clipboardData.files]
      if (files.length) void pasteFiles(files)
      else pasteText(e.clipboardData.getData("text/plain"))
    },
  }
  useEffect(() => {
    if (embed) return
    const mine = () => { const a = document.activeElement; return !!box.current && !!a && box.current.contains(a) && !typing(a) }
    const on = (k: "copy" | "cut" | "paste") => (e: ClipboardEvent) => { if (mine()) clip.current[k](e) }
    const copy = on("copy"), cut = on("cut"), paste = on("paste")
    document.addEventListener("copy", copy); document.addEventListener("cut", cut); document.addEventListener("paste", paste)
    return () => { document.removeEventListener("copy", copy); document.removeEventListener("cut", cut); document.removeEventListener("paste", paste) }
  }, [embed])

  // ---- drops: files from the tree (the app's drag), and from the computer or a browser (HTML5)
  const dropId = `canvas:${useId()}`
  useDropTarget<Pt>(dropId, (item, x, y, el) => (editable && !embed && item.path && !item.folder && item.path !== path && el && box.current?.contains(el) ? { x, y } : null),
    (item, at) => { if (item.path) addFileAt(item.path, toWorld(at.x, at.y)) }, { hint: () => "Add to canvas" })
  const onDragOver = (e: RDragEvent) => {
    if (!editable || embed) return
    const types = [...e.dataTransfer.types]
    if (types.includes("Files") || types.includes("text/uri-list")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy" }
  }
  const onDrop = (e: RDragEvent) => {
    if (!editable || embed) return
    const at = toWorld(e.clientX, e.clientY)
    const files = [...e.dataTransfer.files]
    if (files.length) { e.preventDefault(); void pasteFiles(files, at); return }
    const uri = e.dataTransfer.getData("text/uri-list").split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#"))
    if (uri) { e.preventDefault(); addLinkAt(uri, at) }
  }

  // ---- pointers: pan, pinch, select, move, resize, connect
  const pts = useRef(new Map<number, Pt>())
  const pinch = useRef<{ d: number; c: Pt } | null>(null)
  const setD = (d: Drag | null) => { dragRef.current = d; setDrag(d) }
  /** Boxes a move or a resize snaps to: the cards near the screen that aren't moving. */
  const othersThan = (moving: Set<string>) => {
    const w = winRef.current
    return docRef.current.nodes.filter((n) => !moving.has(n.id) && (!w || overlaps(n, w)))
  }
  const snapOpts = (e: { metaKey: boolean; ctrlKey: boolean }) => {
    const off = e.metaKey || e.ctrlKey
    return { grid: snapToGrid && !off, objects: snapToObjects && !off, tol: SNAP_PX / viewRef.current.k }
  }

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (embed) return
    if (anim.current) { cancelAnimationFrame(anim.current); anim.current = 0 }
    const target = e.target as Element
    if (e.pointerType === "mouse" && e.button === 2) return
    if (target.closest("[data-editing], textarea, input, a, [data-no-drag], [data-canvas-toolbar]")) return
    focusBoard()
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()]
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
      const d = dragRef.current
      if (d?.kind === "move" && d.moved) commit(docRef.current, d.base)
      setD(null)
      return
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const pan = () => setD({ kind: "pan", sx: e.clientX, sy: e.clientY, view: viewRef.current, moved: false })
    // The middle button, or the space bar held: pan, whatever is under the pointer.
    if (e.button === 1 || spacePan) { e.preventDefault(); pan(); return } // (no autoscroll from the middle button)
    const handle = target.closest<HTMLElement>("[data-handle]")
    if (editable && handle) {
      endEdit()
      const id = handle.dataset.for!, kind = handle.dataset.handle!
      if (kind.startsWith("edge-")) {
        setD({ kind: "end", edge: id, end: kind === "edge-from" ? "from" : "to", to: toWorld(e.clientX, e.clientY), over: null })
      } else if (kind.startsWith("resize-")) {
        const n = docRef.current.nodes.find((x) => x.id === id)!
        setD({ kind: "resize", id, dir: kind.slice(7) as Dir, sx: e.clientX, sy: e.clientY, start: { x: n.x, y: n.y, width: n.width, height: n.height },
          others: othersThan(new Set([id])), base: docRef.current, image: n.type === "file" && isImage(String(n.file ?? "")) })
      } else setD({ kind: "connect", from: id, side: kind as Side, to: toWorld(e.clientX, e.clientY), over: null })
      e.stopPropagation()
      return
    }
    const edgeEl = target.closest<HTMLElement>("[data-canvas-edge]")
    if (edgeEl) {
      endEdit()
      setSelEdge(edgeEl.dataset.canvasEdge!)
      setSel(new Set())
      return
    }
    const nodeEl = target.closest<HTMLElement>("[data-canvas-node]")
    if (nodeEl) {
      const id = nodeEl.dataset.canvasNode!
      endEdit()
      setSelEdge(null)
      const wasSelected = sel.has(id)
      let next = e.shiftKey || wasSelected ? new Set(sel) : new Set<string>()
      if (e.shiftKey && wasSelected) next.delete(id); else next.add(id)
      if (!editable) { setSel(next); pan(); return }
      const base = docRef.current
      // Alt: the selection is copied, and the copy is what moves.
      if (e.altKey) {
        const copy = duplicate(base, next, 0, 0)
        docRef.current = copy.doc
        setDoc(copy.doc)
        next = copy.ids
      }
      setSel(next)
      // What moves: the selection, and what's inside a group that moves.
      const now = docRef.current
      const ids = withContents(now, next)
      const moving = new Map<string, Pt>()
      for (const n of now.nodes) if (ids.has(n.id)) moving.set(n.id, { x: n.x, y: n.y })
      const b = bounds(now.nodes.filter((n) => moving.has(n.id)))!
      setD({ kind: "move", sx: e.clientX, sy: e.clientY, start: moving, box: { x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 },
        others: othersThan(ids), base, moved: false, wasSelected, id, touch: e.pointerType !== "mouse" })
      return
    }
    endEdit()
    if (!editable || e.pointerType !== "mouse") {
      if (!e.shiftKey) { setSel(new Set()); setSelEdge(null) }
      pan()
      return
    }
    // The background with a mouse: a selection box.
    const p = toWorld(e.clientX, e.clientY)
    const add = e.shiftKey ? new Set(sel) : new Set<string>()
    if (!e.shiftKey) { setSel(new Set()); setSelEdge(null) }
    setD({ kind: "marquee", x0: p.x, y0: p.y, x1: p.x, y1: p.y, add })
  }

  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    lastPointer.current = { x: e.clientX, y: e.clientY }
    if (pts.current.has(e.pointerId)) pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y), c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const r = box.current!.getBoundingClientRect(), v = viewRef.current
      const z = zoomAbout(v, v.k * d / Math.max(1, pinch.current.d), pinch.current.c.x - r.left, pinch.current.c.y - r.top)
      setView({ ...z, x: z.x + (c.x - pinch.current.c.x), y: z.y + (c.y - pinch.current.c.y) })
      pinch.current = { d, c }
      return
    }
    const d = dragRef.current
    if (!d) return
    if (d.kind === "pan") {
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy
      if (!d.moved && Math.hypot(dx, dy) < 3) return
      if (!d.moved) { d.moved = true; setDrag({ ...d }) }
      setView({ ...d.view, x: d.view.x + dx, y: d.view.y + dy })
    } else if (d.kind === "move") {
      const k = viewRef.current.k
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < (d.touch ? 8 : 3)) return
      d.moved = true
      let dx = (e.clientX - d.sx) / k, dy = (e.clientY - d.sy) / k
      const s = snapMove({ ...d.box, x: d.box.x + dx, y: d.box.y + dy }, d.others, snapOpts(e))
      dx += s.dx; dy += s.dy
      setGuides(s.guides)
      const cur = docRef.current
      const next = { ...cur, nodes: cur.nodes.map((n) => { const st = d.start.get(n.id); return st ? { ...n, x: Math.round(st.x + dx), y: Math.round(st.y + dy) } : n }) }
      docRef.current = next
      setDoc(next)
    } else if (d.kind === "resize") {
      const k = viewRef.current.k
      const r = resizeBox(d.start, d.dir, (e.clientX - d.sx) / k, (e.clientY - d.sy) / k, d.others, { ...snapOpts(e), keep: e.shiftKey || (d.image && d.dir.length === 2) })
      setGuides(r.guides)
      const cur = docRef.current
      const next = { ...cur, nodes: cur.nodes.map((n) => (n.id === d.id ? { ...n, ...r.box } : n)) }
      docRef.current = next
      setDoc(next)
    } else if (d.kind === "connect" || d.kind === "end") {
      const p = toWorld(e.clientX, e.clientY)
      const over = nodeAt(p, d.kind === "connect" ? d.from : undefined)
      setD({ ...d, to: p, over: over && over.type !== "group" ? over.id : null })
    } else if (d.kind === "marquee") {
      const p = toWorld(e.clientX, e.clientY)
      const m = { ...d, x1: p.x, y1: p.y }
      setD(m)
      const r = { x0: Math.min(m.x0, m.x1), y0: Math.min(m.y0, m.y1), x1: Math.max(m.x0, m.x1), y1: Math.max(m.y0, m.y1) }
      const hit = docRef.current.nodes.filter((n) => (n.type === "group" ? within(n, r) : overlaps(n, r))).map((n) => n.id)
      setSel(new Set([...m.add, ...hit]))
    }
  }

  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    pts.current.delete(e.pointerId)
    if (pinch.current) { if (pts.current.size < 2) pinch.current = null; return }
    const d = dragRef.current
    setD(null)
    setGuides([])
    if (!d) return
    if (d.kind === "move") {
      if (d.moved) commit(docRef.current, d.base)
      else {
        if (docRef.current !== d.base) { docRef.current = d.base; setDoc(d.base); setSel(new Set([d.id])) } // an Alt-click that didn't move: no copy
        const n = docRef.current.nodes.find((x) => x.id === d.id)
        // A tap on a card that was already selected edits it (phones have no double-click).
        if (n && d.touch && d.wasSelected && (n.type === "text" || n.type === "group" || isNote(n))) beginEdit(n)
        // A click (no drag) on one of several selected cards selects only it.
        else if (n && !e.shiftKey && d.wasSelected && sel.size > 1) select([n.id])
      }
    } else if (d.kind === "resize") {
      if (docRef.current !== d.base) commit(docRef.current, d.base)
    } else if (d.kind === "connect") {
      const from = docRef.current.nodes.find((n) => n.id === d.from)
      if (!from) return
      if (d.over) {
        const to = docRef.current.nodes.find((n) => n.id === d.over)!
        const edge: CanvasEdge = { id: newId(taken()), fromNode: from.id, fromSide: d.side, toNode: to.id, toSide: nearestSide(to, d.to) }
        commit({ ...docRef.current, edges: [...docRef.current.edges, edge] })
        setSelEdge(edge.id)
        setSel(new Set())
      } else {
        const a = anchor(from, d.side)
        if (Math.hypot(d.to.x - a.x, d.to.y - a.y) * viewRef.current.k > 30) connectInto(from, d.side, d.to, { x: e.clientX, y: e.clientY })
      }
    } else if (d.kind === "end") {
      const edge = docRef.current.edges.find((x) => x.id === d.edge)
      const over = d.over ? docRef.current.nodes.find((n) => n.id === d.over) : null
      const other = edge ? (d.end === "from" ? edge.toNode : edge.fromNode) : null
      if (edge && over && over.id !== other) {
        const side = nearestSide(over, d.to)
        patchEdge(edge.id, (x) => (d.end === "from" ? { ...x, fromNode: over.id, fromSide: side } : { ...x, toNode: over.id, toSide: side }))
      }
    } else if (d.kind === "pan" && !d.moved && !editable) {
      const n = nodeAt(toWorld(e.clientX, e.clientY))
      if (n && n.type !== "group" && n.type !== "text") openNode(n, e.metaKey || e.ctrlKey)
    }
  }

  const onDouble = (e: MouseEvent) => {
    if (embed) return
    // (what's under the pointer: the board captured the pointer when it was pressed, so the event's target is the board)
    const target = (document.elementFromPoint(e.clientX, e.clientY) ?? e.target) as HTMLElement
    if (typing(target) || target.closest("[data-editing], [data-canvas-toolbar]")) return
    const edgeEl = target.closest<HTMLElement>("[data-canvas-edge], [data-edge-label]")
    if (edgeEl && editable) { const id = edgeEl.dataset.canvasEdge ?? edgeEl.dataset.edgeLabel!; setSelEdge(id); setEditing({ kind: "edge", id }); return }
    const labelEl = target.closest<HTMLElement>("[data-group-label]")
    if (labelEl && editable) { const id = labelEl.dataset.groupLabel!; select([id]); setEditing({ kind: "label", id }); return }
    const nodeEl = target.closest<HTMLElement>("[data-canvas-node]")
    const p = toWorld(e.clientX, e.clientY)
    if (nodeEl) {
      const n = docRef.current.nodes.find((x) => x.id === nodeEl.dataset.canvasNode)
      if (!n) return
      if (n.type === "group") { if (editable) addCard(p); return }
      if (editable && (n.type === "text" || isNote(n))) beginEdit(n)
      else openNode(n, e.metaKey || e.ctrlKey)
      return
    }
    if (editable) addCard(p)
  }

  // Wheel: scroll pans (Shift: sideways, with a mouse), a pinch or ⌘ + scroll zooms.
  useEffect(() => {
    const el = box.current
    if (!el || embed) return
    const wheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("[data-scrolls], [data-editing]") && !e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const v = viewRef.current
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      if (!e.ctrlKey && !e.metaKey) {
        const side = e.shiftKey && !e.deltaX
        setView({ ...v, x: v.x - (side ? e.deltaY : e.deltaX) * unit, y: v.y - (side ? 0 : e.deltaY) * unit })
        return
      }
      const r = el.getBoundingClientRect()
      setView(zoomAbout(v, v.k * Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.002)), e.clientX - r.left, e.clientY - r.top))
    }
    el.addEventListener("wheel", wheel, { passive: false })
    return () => el.removeEventListener("wheel", wheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embed])

  const onKey = (e: KeyboardEvent) => {
    if (typing(e.target)) return
    const mod = e.metaKey || e.ctrlKey
    if (e.key === " " && !mod) { e.preventDefault(); if (!spacePan) setSpacePan(true); return }
    if (e.shiftKey && !mod && e.code === "Digit1") { e.preventDefault(); fitAll(); return }
    if (e.shiftKey && !mod && e.code === "Digit2") { e.preventDefault(); fitSelection(); return }
    if (e.shiftKey && !mod && e.code === "Digit0") { e.preventDefault(); zoomTo100(); return }
    if (e.key === "Escape") { setSel(new Set()); setSelEdge(null); return }
    if (!editable) return
    const k = e.key.toLowerCase()
    if ((e.key === "Delete" || e.key === "Backspace") && (sel.size || selEdge)) { e.preventDefault(); removeSelected() }
    else if (mod && k === "z") { e.preventDefault(); step(!e.shiftKey) }
    else if (mod && k === "y") { e.preventDefault(); step(false) }
    else if (mod && k === "a") { e.preventDefault(); select(doc.nodes.map((n) => n.id)) }
    else if (mod && k === "d") { e.preventDefault(); dup() }
    else if (mod && k === "g") { e.preventDefault(); if (e.shiftKey) doUngroup(); else addGroup() }
    else if (e.key === "Enter" && sel.size === 1) {
      const n = doc.nodes.find((x) => sel.has(x.id))
      if (n) { e.preventDefault(); beginEdit(n) }
    } else if (e.key.startsWith("Arrow") && sel.size && !mod) {
      e.preventDefault()
      const by = e.shiftKey ? 10 : 1
      const dx = e.key === "ArrowLeft" ? -by : e.key === "ArrowRight" ? by : 0, dy = e.key === "ArrowUp" ? -by : e.key === "ArrowDown" ? by : 0
      const ids = withContents(docRef.current, sel)
      commit({ ...docRef.current, nodes: docRef.current.nodes.map((n) => (ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) })
    }
  }
  const onKeyUp = (e: KeyboardEvent) => { if (e.key === " ") setSpacePan(false) }

  // ---- menus
  const nodeMenu = (n: CanvasNode): MenuItem[] => {
    const many = sel.size > 1
    const items: MenuItem[] = []
    if (!many) {
      if (editable && (n.type === "text" || isNote(n))) items.push({ label: "Edit", icon: Pencil, run: () => beginEdit(n) })
      if (editable && n.type === "group") items.push({ label: "Rename", icon: Type, run: () => setEditing({ kind: "label", id: n.id }) })
      if (n.type === "file") {
        items.push({ label: "Open", icon: ArrowUpRight, run: () => openNode(n) })
        items.push({ label: "Open in new tab", run: () => openNode(n, true) })
      }
      if (n.type === "link") {
        items.push({ label: "Open in browser", icon: ArrowUpRight, run: () => openNode(n) })
        items.push({ label: "Copy address", icon: Copy, run: () => { void navigator.clipboard.writeText(String(n.url ?? "")) } })
      }
      if (editable && n.type === "text") items.push({ label: "Convert to file", icon: FilePlus2, run: () => void convertToFile(n) })
    }
    if (editable) {
      items.push({ label: "Colour", icon: Palette, sep: items.length > 0, run: () => {}, items: colourItems() })
      if (many) items.push({ label: "Align", icon: AlignStartVertical, run: () => {}, items: alignItems() })
      items.push({ label: "Create group", icon: GroupIcon, run: () => addGroup() })
      if ([...sel].some((id) => byId.get(id)?.type === "group")) items.push({ label: "Ungroup", icon: Ungroup, run: doUngroup })
    }
    items.push({ label: "Zoom to selection", icon: Scan, sep: !editable && items.length > 0, run: fitSelection })
    if (editable) {
      items.push({ label: "Copy", icon: Copy, sep: true, run: () => { void navigator.clipboard.writeText(selectionText()) } })
      items.push({ label: "Cut", icon: Scissors, run: () => { void navigator.clipboard.writeText(selectionText()); cutSelection() } })
      items.push({ label: "Duplicate", icon: CopyPlus, run: dup })
      items.push({ label: "Delete", icon: Trash2, danger: true, sep: true, run: removeSelected })
    }
    return items
  }
  const edgeMenu = (id: string): MenuItem[] => (editable ? [
    { label: "Edit label", icon: Type, run: () => setEditing({ kind: "edge", id }) },
    { label: "Direction", icon: ArrowLeftRight, run: () => {}, items: directionItems(id) },
    { label: "Colour", icon: Palette, run: () => {}, items: colourItems() },
    { label: "Zoom to selection", icon: Scan, run: fitSelection },
    { label: "Delete", icon: Trash2, danger: true, sep: true, run: removeSelected },
  ] : [{ label: "Zoom to selection", icon: Scan, run: fitSelection }])
  const backgroundMenu = (p: Pt): MenuItem[] => [
    ...(editable ? [
      { label: "Add card", icon: StickyNote, run: () => addCard(p) },
      { label: "Add note or file", icon: FileText, run: () => addFile(p) },
      { label: "Add web page", icon: Globe, run: () => addLink(p) },
      { label: "Add group", icon: GroupIcon, run: () => { setSel(new Set()); addNode({ type: "group", label: "Group", x: Math.round(p.x - 250), y: Math.round(p.y - 180), width: 500, height: 360 }, { edit: true }) } },
      { label: "Paste", icon: ClipboardPaste, sep: true, run: () => void pasteFromMenu(p) },
    ] : []),
    { label: "Zoom to fit", icon: Maximize, sep: editable, run: fitAll },
    { label: "Zoom to 100%", run: zoomTo100 },
    ...(editable ? [{ label: "Select all", run: () => select(docRef.current.nodes.map((n) => n.id)) }] : []),
  ]
  // A node's or an arrow's menu is opened once the click's selection is drawn: its items read it.
  const pendingMenu = useRef<{ at: Pt; node?: string; edge?: string } | null>(null)
  useEffect(() => {
    const m = pendingMenu.current
    if (!m) return
    pendingMenu.current = null
    const n = m.node ? byId.get(m.node) : undefined
    openMenu(m.at, m.edge ? edgeMenu(m.edge) : n ? nodeMenu(n) : [])
  })
  const onContext = (e: MouseEvent) => {
    if (embed || typing(e.target)) return
    e.preventDefault()
    e.stopPropagation()
    endEdit()
    const target = e.target as Element
    const at = { x: e.clientX, y: e.clientY }
    const edgeEl = target.closest<HTMLElement>("[data-canvas-edge], [data-edge-label]")
    if (edgeEl) {
      const id = edgeEl.dataset.canvasEdge ?? edgeEl.dataset.edgeLabel!
      setSelEdge(id); setSel(new Set())
      pendingMenu.current = { at, edge: id }
      setHistory((h) => h + 1)
      return
    }
    const nodeEl = target.closest<HTMLElement>("[data-canvas-node]")
    const n = nodeEl ? docRef.current.nodes.find((x) => x.id === nodeEl.dataset.canvasNode) : null
    if (n) {
      if (!sel.has(n.id)) select([n.id])
      pendingMenu.current = { at, node: n.id }
      setHistory((h) => h + 1)
      return
    }
    openMenu(at, backgroundMenu(toWorld(e.clientX, e.clientY)))
  }

  useLayoutEffect(() => placeBar())
  const byId = useMemo(() => new Map(doc.nodes.map((n) => [n.id, n])), [doc.nodes])
  const one = sel.size === 1 ? doc.nodes.find((n) => sel.has(n.id)) : undefined

  if (error && !doc.nodes.length) return <p className="p-4 text-[15px] text-muted-foreground">This canvas couldn't be read: {error}. Source mode shows its text.</p>

  const far = !!win?.far
  const shown = (n: CanvasNode) => !win || overlaps(n, win) || sel.has(n.id) || editing?.id === n.id
  const groups = doc.nodes.filter((n) => n.type === "group" && shown(n))
  const cards = doc.nodes.filter((n) => n.type !== "group" && shown(n))
  const handles = editable && interactive && !far && !drag
  const movingEdge = drag?.kind === "end" ? drag.edge : null
  const toolbarOn = editable && interactive && !drag && !editing && (sel.size > 0 || !!selEdge)
  const edgeOf = (id: string | null) => {
    const e = id ? doc.edges.find((x) => x.id === id) : undefined
    const a = e && byId.get(e.fromNode), b = e && byId.get(e.toNode)
    return e && a && b ? { e, ...edgePath(e, a, b) } : null
  }
  {
    let at: { x: number; top: number; bottom: number } | null = null
    if (toolbarOn && selEdge) {
      const p = edgeOf(selEdge)
      if (p) at = { x: p.mid.x, top: p.mid.y - 12, bottom: p.mid.y + 12 }
    } else if (toolbarOn) {
      const b = bounds(doc.nodes.filter((n) => sel.has(n.id)))
      // (above a file's or a group's name, which sits over its box)
      if (b) at = { x: (b.x0 + b.x1) / 2, top: b.y0 - (one?.type === "file" || one?.type === "group" ? 26 : 0), bottom: b.y1 }
    }
    barAt.current = at
  }

  return (
    <div ref={box} tabIndex={embed ? -1 : 0} data-canvas-board={place} data-canvas-nodes={doc.nodes.length} data-canvas-edges={doc.edges.length} data-canvas-selected={sel.size}
      data-file-drop={editable && !embed ? "" : undefined} data-drops={editable && !embed ? "" : undefined}
      className={cn("absolute inset-0 overflow-hidden bg-background outline-none select-none", !embed && "touch-none",
        drag?.kind === "pan" && drag.moved ? "cursor-grabbing" : spacePan ? "cursor-grab" : "cursor-default", embed && "pointer-events-none")}
      style={{ "--k": 1 } as CSSProperties}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDouble} onKeyDown={onKey} onKeyUp={onKeyUp}
      onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) setSpacePan(false) }}
      onContextMenu={onContext} onDragOver={onDragOver} onDrop={onDrop}>
      <div ref={stage} className="absolute top-0 left-0 origin-top-left" data-canvas-stage>
        {groups.map((n) => (
          <Group key={n.id} node={n} selected={sel.has(n.id)} editingLabel={editing?.kind === "label" && editing.id === n.id} far={far}
            resizable={handles && one?.id === n.id} onLabel={onGroupLabel} LabelEditor={LabelEditor} />
        ))}
        <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1" data-canvas-edges-layer>
          {doc.edges.map((e) => {
            const a = byId.get(e.fromNode), b = byId.get(e.toNode)
            if (!a || !b) return null
            const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y)
            if (win && !overlaps({ x: x0, y: y0, width: Math.max(a.x + a.width, b.x + b.width) - x0, height: Math.max(a.y + a.height, b.y + b.height) - y0 }, win)) return null
            return <Edge key={e.id} edge={e} from={a} to={b} selected={selEdge === e.id} editingLabel={editing?.kind === "edge" && editing.id === e.id} interactive={interactive} moving={movingEdge === e.id} />
          })}
          {drag?.kind === "connect" && (() => {
            const a = byId.get(drag.from)
            if (!a) return null
            const over = drag.over ? byId.get(drag.over) : null
            const sb = over ? nearestSide(over, drag.to) : null
            return <Preview pa={anchor(a, drag.side)} sa={drag.side} pb={over && sb ? anchor(over, sb) : drag.to} sb={sb} />
          })()}
          {drag?.kind === "end" && (() => {
            const p = edgeOf(drag.edge)
            if (!p) return null
            const over = drag.over ? byId.get(drag.over) : null
            const s = over ? nearestSide(over, drag.to) : null
            const loose = over && s ? anchor(over, s) : drag.to
            return drag.end === "to" ? <Preview pa={p.pa} sa={p.sa} pb={loose} sb={s} /> : <Preview pa={p.pb} sa={p.sb} pb={loose} sb={s} />
          })()}
          {guides.map((g, i) => g.axis === "x"
            ? <line key={i} x1={g.at} x2={g.at} y1={g.a - 20} y2={g.b + 20} stroke="var(--primary)" style={{ strokeWidth: px(1) }} strokeDasharray="4 3" />
            : <line key={i} y1={g.at} y2={g.at} x1={g.a - 20} x2={g.b + 20} stroke="var(--primary)" style={{ strokeWidth: px(1) }} strokeDasharray="4 3" />)}
        </svg>
        {editing?.kind === "edge" && (() => {
          const p = edgeOf(editing.id)
          if (!p) return null
          return <div className="absolute" style={{ left: p.mid.x - 110, top: p.mid.y - 16 }}>
            <LabelEditor value={String(p.e.label ?? "")} className="h-8 w-[220px] rounded-[6px] border border-border bg-card px-2 text-center text-[14px]"
              onDone={(t) => { setEditing(null); focusBoard(); if (t !== String(p.e.label ?? "")) setLabel(p.e.id, t) }} />
          </div>
        })()}
        {cards.map((n) => (
          <Card key={n.id} node={n} store={store} canvas={path} selected={sel.has(n.id)} editing={(editing?.kind === "text" || editing?.kind === "file") && editing.id === n.id}
            far={far} lite={embed} editable={editable} target={(drag?.kind === "connect" || drag?.kind === "end") && drag.over === n.id}
            handles={handles} resizable={handles && one?.id === n.id && editing?.id !== n.id} on={events} />
        ))}
        {selEdge && editable && interactive && !drag && (() => {
          const p = edgeOf(selEdge)
          if (!p) return null
          return ([["from", p.pa], ["to", p.pb]] as const).map(([end, at]) => (
            <div key={end} data-handle={`edge-${end}`} data-for={p.e.id} data-tip="Drag to another card" className="absolute cursor-move rounded-full border-primary bg-card"
              style={{ left: at.x, top: at.y, width: px(12), height: px(12), borderWidth: px(2), transform: "translate(-50%, -50%)" }} />
          ))
        })()}
        {drag?.kind === "marquee" && (
          <div className="pointer-events-none absolute rounded-[2px] bg-primary/10" data-canvas-marquee
            style={{ left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0), border: `${px(1)} solid var(--primary)` }} />
        )}
      </div>
      {toolbarOn && (
        <div ref={bar} className="glass absolute top-0 left-0 z-[2] flex h-9 items-center gap-0.5 rounded-[10px] px-1 max-md:h-11" data-canvas-toolbar="selection"
          onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {selEdge ? <>
            <Tool icon={ArrowLeftRight} label="Direction" onClick={(e) => menuBelow(e, directionItems(selEdge))} />
            <Tool icon={Type} label="Edit label" onClick={() => setEditing({ kind: "edge", id: selEdge })} />
            <Tool icon={Palette} label="Colour" onClick={(e) => menuBelow(e, colourItems())} swatch={colorOf(doc.edges.find((x) => x.id === selEdge)?.color)} />
            <Tool icon={Scan} label="Zoom to selection" onClick={fitSelection} />
            <Tool icon={Trash2} label="Delete" onClick={removeSelected} />
          </> : <>
            {one && (one.type === "text" || isNote(one)) && <Tool icon={Pencil} label="Edit" onClick={() => beginEdit(one)} />}
            {one && (one.type === "file" || one.type === "link") && <Tool icon={ArrowUpRight} label="Open" onClick={(e) => openNode(one, e.metaKey || e.ctrlKey)} />}
            <Tool icon={Palette} label="Colour" onClick={(e) => menuBelow(e, colourItems())} swatch={colorOf(doc.nodes.find((n) => sel.has(n.id))?.color)} />
            {sel.size > 1 && <Tool icon={AlignStartVertical} label="Align" onClick={(e) => menuBelow(e, alignItems())} />}
            {(sel.size > 1 || (one && one.type !== "group")) && <Tool icon={GroupIcon} label="Create group" onClick={() => addGroup()} />}
            <Tool icon={Scan} label="Zoom to selection" onClick={fitSelection} />
            <Tool icon={Trash2} label="Delete" onClick={removeSelected} />
          </>}
        </div>
      )}
      {!embed && !doc.nodes.length && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center text-[14px] text-muted-foreground">
          {editable ? "An empty canvas. Double-click anywhere to add a card, drop notes and files here, or use the buttons below." : "An empty canvas."}
        </div>
      )}
      {!embed && (
        <div className="glass absolute top-3 right-3 flex flex-col items-center gap-0.5 rounded-[12px] p-1 max-md:top-2 max-md:right-2" data-canvas-toolbar="view"
          onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <Tool icon={Plus} label="Zoom in" onClick={() => zoomBy(1.25)} />
          <button type="button" onClick={zoomTo100} data-tip="Zoom to 100% (Shift+0)" data-canvas-tool="Zoom to 100%"
            className="h-6 w-8 cursor-pointer rounded-[6px] text-[11px] font-medium text-muted-foreground tabular-nums hover:bg-foreground/[0.06] hover:text-foreground max-md:w-10">
            <span ref={zoomLabel}>100%</span>
          </button>
          <Tool icon={Minus} label="Zoom out" onClick={() => zoomBy(0.8)} />
          <Tool icon={Maximize} label="Zoom to fit (Shift+1)" onClick={fitAll} />
          {editable && <>
            <span className="my-0.5 h-px w-5 shrink-0 bg-border" />
            <Tool icon={Undo2} label="Undo" onClick={() => step(true)} disabled={!undo.current.length} />
            <Tool icon={Redo2} label="Redo" onClick={() => step(false)} disabled={!redo.current.length} />
            <span className="my-0.5 h-px w-5 shrink-0 bg-border" />
            <Tool icon={Magnet} label="Snapping" onClick={(e) => menuBelow(e, [
              { label: "Snap to grid", checked: snapToGrid, run: () => setSetting({ snapToGrid: !snapToGrid }) },
              { label: "Snap to cards", checked: snapToObjects, run: () => setSetting({ snapToObjects: !snapToObjects }) },
            ])} />
          </>}
        </div>
      )}
      {!embed && editable && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3 max-md:bottom-2">
          <div className="glass pointer-events-auto flex h-10 max-w-full items-center gap-0.5 overflow-x-auto rounded-[12px] px-1 max-md:h-12" data-canvas-toolbar="add"
            onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <Tool icon={StickyNote} label="Add card" onClick={() => addCard()} />
            <Tool icon={FileText} label="Add note or file" onClick={() => addFile()} />
            <Tool icon={Globe} label="Add web page" onClick={() => addLink()} />
            <Tool icon={GroupIcon} label="Add group" onClick={() => addGroup()} />
          </div>
        </div>
      )}
    </div>
  )
}

/** The arrow being drawn: dashed, from where it starts to the pointer (or the side of the card under it). */
function Preview({ pa, sa, pb, sb }: { pa: Pt; sa: Side; pb: Pt; sb: Side | null }) {
  const d = Math.max(30, Math.min(220, Math.hypot(pb.x - pa.x, pb.y - pa.y) / 2))
  const dir = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] } as const
  const c1 = { x: pa.x + dir[sa][0] * d, y: pa.y + dir[sa][1] * d }
  const c2 = sb ? { x: pb.x + dir[sb][0] * d, y: pb.y + dir[sb][1] * d } : c1
  const a = Math.atan2(pb.y - c2.y, pb.x - c2.x)
  const h = (t: number) => `${pb.x - 12 * Math.cos(a + t)},${pb.y - 12 * Math.sin(a + t)}`
  return <g><path d={`M ${pa.x} ${pa.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${pb.x} ${pb.y}`} fill="none" stroke="var(--primary)" strokeWidth={2} strokeDasharray="6 5" />
    <polygon points={`${pb.x},${pb.y} ${h(0.45)} ${h(-0.45)}`} fill="var(--primary)" /></g>
}

function Tool({ icon: Icon, label, onClick, disabled, swatch }: { icon: typeof StickyNote; label: string; onClick: (e: MouseEvent) => void; disabled?: boolean; swatch?: string | null }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} data-tip={label} data-canvas-tool={label}
      className="relative grid size-8 shrink-0 cursor-pointer place-items-center rounded-[8px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent max-md:size-10">
      <Icon className="size-4" strokeWidth={2.25} />
      {swatch && <span className="absolute right-1 bottom-1 size-2 rounded-full" style={{ background: swatch }} />}
    </button>
  )
}

function LabelEditor({ value, className, onDone }: { value: string; className: string; onDone: (text: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => { ref.current?.focus({ preventScroll: true }); ref.current?.select() }, [])
  const finish = () => { if (done.current) return; done.current = true; onDone(ref.current!.value.trim()) }
  return (
    <input ref={ref} defaultValue={value} onBlur={finish} className={cn("outline-none", className)} data-canvas-label-editor
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); finish() } }}
      onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} />
  )
}
