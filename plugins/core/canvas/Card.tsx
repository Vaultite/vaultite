// A canvas's cards and groups, each memoized so dragging or panning redraws only what changed. Text and note cards edit
// in place; zoomed far out a card is only its colour and name, to keep big boards smooth.
import { memo, useEffect, useState, type CSSProperties } from "react"
import { FileText, ImageOff } from "lucide-react"
import { cn, FileEditor, FileEmbed, Markdown, NoteEditor, rawUrl, readFile, splitFm, useVaultChange, withoutBlocks, type Store } from "@vaultite"
import { colorOf, type CanvasNode } from "./codec"
import { SIDES, DIRS, anchor, type Dir } from "./geometry"
import { fileName, isImage, px, tint } from "./look"
import { LinkCard } from "./LinkCard"

/** What a card's first line says, for a card drawn small. */
function titleOf(n: CanvasNode) {
  if (n.type === "file") return fileName(String(n.file ?? "")).replace(/\.md$/i, "")
  if (n.type === "link") { try { return new URL(String(n.url)).host } catch { return String(n.url ?? "") } }
  return String(n.text ?? "").split("\n").map((l) => l.replace(/^#{1,6}\s+/, "").trim()).find(Boolean) ?? ""
}

/** A note's text in a file card (its body, without blocks; a heading's section for `#Heading`). */
function NotePreview({ store, path, subpath }: { store?: Store; path: string; subpath?: string }) {
  const [text, setText] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [n, setN] = useState(0)
  useEffect(() => {
    let on = true
    readFile(path).then((f) => { if (on) { setText(f.text); setMissing(false) } }).catch(() => on && setMissing(true))
    return () => { on = false }
  }, [path, n])
  useVaultChange(() => setN((x) => x + 1), [path])
  if (missing) return <Missing path={path} />
  if (text === null) return <NameOnly path={path} />
  let body = withoutBlocks(splitFm(text).body)
  if (subpath?.startsWith("#") && !subpath.startsWith("#^")) {
    // A heading: from it to the next heading as big.
    const want = subpath.slice(1).trim().toLowerCase()
    const lines = body.split("\n")
    const at = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s*/, "").trim().toLowerCase() === want)
    if (at >= 0) {
      const level = /^#+/.exec(lines[at])![0].length
      const end = lines.findIndex((l, i) => i > at && /^#{1,6}\s/.test(l) && /^#+/.exec(l)![0].length <= level)
      body = lines.slice(at, end < 0 ? undefined : end).join("\n")
    }
  }
  return <div className="canvas-md px-4 py-3 text-[14px] leading-[1.45]"><Markdown text={body.trim() || "_Empty note._"} store={store} from={path} /></div>
}

const NameOnly = ({ path }: { path: string }) => (
  <div className="flex h-full items-center gap-2 p-3 text-[14px] font-medium"><FileText className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{fileName(path).replace(/\.md$/i, "")}</span></div>
)
const Missing = ({ path }: { path: string }) => (
  <div className="flex h-full items-center gap-2 p-3 text-[13px] text-muted-foreground"><ImageOff className="size-4 shrink-0" />No file {fileName(path)}</div>
)

export type CardEvents = {
  /** The text card's text, as it's typed (saved, not undoable one key at a time). */
  typed: (id: string, text: string) => void
  /** Editing ended (Escape, the editor let go of the keyboard). */
  done: (id: string) => void
  open: (n: CanvasNode, newTab: boolean) => void
}

type CardProps = {
  node: CanvasNode; store?: Store; canvas: string
  selected: boolean; editing: boolean; far: boolean; lite: boolean; editable: boolean; target: boolean
  /** Its handles: resize (only when it's the one selected) and connect dots (hover or selected). */
  handles: boolean; resizable: boolean
  on: { current: CardEvents }
}

export const Card = memo(function Card({ node: n, store, canvas, selected, editing, far, lite, editable, target, handles, resizable, on }: CardProps) {
  const c = colorOf(n.color)
  const style: CSSProperties = { left: n.x, top: n.y, width: n.width, height: n.height }
  const file = String(n.file ?? "")
  const md = n.type === "file" && /\.md$/i.test(file)
  const known = n.type !== "file" || !store || store.files.files.some((f) => f.path === file) || store.files.others.some((f) => f.path === file)
  const finish = () => on.current.done(n.id)

  let inner
  if (far) {
    inner = <div className="flex size-full items-center overflow-hidden px-4"><span className="truncate text-[28px] font-semibold text-muted-foreground">{titleOf(n)}</span></div>
  } else if (n.type === "text") {
    inner = editing
      ? <div className="canvas-edit size-full overflow-auto px-4 py-2 text-[14px] leading-[1.45]" data-scrolls>
        <NoteEditor text={String(n.text ?? "")} store={store} from={canvas} autoFocus placeholder="Write something"
          onChange={(t) => on.current.typed(n.id, t)} onEscape={finish} onBlur={finish} />
      </div>
      : <div className={cn("canvas-md size-full px-4 py-3 text-[14px] leading-[1.45]", selected ? "overflow-auto" : "overflow-hidden")} data-scrolls={selected ? "" : undefined}>
        {n.text ? <Markdown text={String(n.text)} store={store} from={canvas} /> : <span className="text-tertiary">{editable ? "Double-click to write" : ""}</span>}
      </div>
  } else if (n.type === "file") {
    inner = !known ? <Missing path={file} />
      : lite ? (isImage(file) ? <img src={rawUrl(file)} alt={fileName(file)} className="block size-full object-contain" draggable={false} /> : <NameOnly path={file} />)
      : md ? (editing && store
        ? <div className="canvas-edit size-full overflow-auto px-4 py-2 text-[14px] leading-[1.45]" data-scrolls><FileEditor path={file} store={store} autoFocus onEscape={finish} /></div>
        : <div className={cn("size-full", selected ? "overflow-auto" : "overflow-hidden")} data-scrolls={selected ? "" : undefined}><NotePreview store={store} path={file} subpath={typeof n.subpath === "string" ? n.subpath : undefined} /></div>)
      : isImage(file) ? <img src={rawUrl(file)} alt={fileName(file)} className="block size-full object-contain" draggable={false} />
      : store ? <div className="size-full" data-no-drag={selected ? "" : undefined}><FileEmbed store={store} path={file} from={canvas} fill /></div> : <NameOnly path={file} />
  } else if (n.type === "link") {
    inner = <LinkCard url={String(n.url ?? "")} width={n.width} height={n.height} />
  } else {
    inner = <div className="p-3 text-[13px] text-muted-foreground">A {n.type} card</div>
  }

  return (
    <div data-canvas-node={n.id} data-type={n.type} data-editing={editing ? "" : undefined}
      className={cn("group/node absolute", editable && !lite && !editing && "cursor-grab")} style={style}>
      {n.type === "file" && !far && (
        <button type="button" data-no-drag className="absolute bottom-full left-0 mb-1 max-w-full cursor-pointer truncate text-left font-medium text-muted-foreground hover:text-foreground hover:underline"
          style={{ fontSize: `max(13px, ${px(13)})` }}
          onClick={(e) => { e.stopPropagation(); on.current.open(n, e.metaKey || e.ctrlKey) }} data-canvas-open={file}>
          {fileName(file).replace(/\.md$/i, "")}{typeof n.subpath === "string" ? n.subpath : ""}
        </button>
      )}
      <div className={cn("size-full overflow-hidden rounded-[10px] border-2 bg-card", !far && "shadow-[0_1px_3px_rgb(0_0_0/0.08)]")}
        style={{ borderColor: target ? "var(--primary)" : c ?? "var(--border)", background: tint(c, 10), outline: selected ? `${px(2)} solid var(--primary)` : undefined, outlineOffset: px(2) }}>
        {inner}
      </div>
      {handles && <Handles node={n} selected={selected} resizable={resizable} />}
    </div>
  )
})

/** The dots on a card's sides (drag one to another card, or into space, to connect) and, when it's the one selected,
 *  its edges and corners to resize it. */
function Handles({ node: n, selected, resizable }: { node: CanvasNode; selected: boolean; resizable: boolean }) {
  return <>
    {resizable && DIRS.map((d) => <ResizeHandle key={d} id={n.id} dir={d} />)}
    {SIDES.map((s) => {
      const p = anchor(n, s)
      return <div key={s} data-handle={s} data-for={n.id} data-tip="Drag to connect"
        className={cn("absolute z-[1] cursor-crosshair rounded-full border-primary bg-card", selected ? "opacity-100" : "opacity-0 group-hover/node:opacity-100")}
        style={{ left: p.x - n.x, top: p.y - n.y, width: px(12), height: px(12), borderWidth: px(2), transform: "translate(-50%, -50%)" }} />
    })}
  </>
}

const CURSOR: Record<Dir, string> = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" }
/** An edge (a strip along it) or a corner (a square on it) to drag. */
export function ResizeHandle({ id, dir }: { id: string; dir: Dir }) {
  const t = px(10), half = px(5)
  const s: CSSProperties = { cursor: CURSOR[dir] }
  if (dir === "n" || dir === "s") Object.assign(s, { left: t, right: t, height: t, [dir === "n" ? "top" : "bottom"]: `calc(-1 * ${half})` })
  else if (dir === "e" || dir === "w") Object.assign(s, { top: t, bottom: t, width: t, [dir === "w" ? "left" : "right"]: `calc(-1 * ${half})` })
  else Object.assign(s, { width: px(14), height: px(14), [dir.includes("n") ? "top" : "bottom"]: `calc(-1 * ${px(7)})`, [dir.includes("w") ? "left" : "right"]: `calc(-1 * ${px(7)})` })
  return (
    <div data-handle={`resize-${dir}`} data-for={id} className="absolute z-[1]" style={s}>
      {dir.length === 2 && <div className="absolute inset-[25%] rounded-[2px] border-primary bg-card" style={{ borderWidth: px(2) }} />}
    </div>
  )
}

type GroupProps = {
  node: CanvasNode; selected: boolean; editingLabel: boolean; far: boolean; resizable: boolean
  onLabel: (id: string, label: string | null) => void
  LabelEditor: (p: { value: string; className: string; onDone: (t: string) => void }) => React.ReactNode
}
/** A group: its box behind the cards, its label above it (bigger when zoomed out, so it stays readable). */
export const Group = memo(function Group({ node: n, selected, editingLabel, far, resizable, onLabel, LabelEditor }: GroupProps) {
  const c = colorOf(n.color)
  return (
    <div data-canvas-node={n.id} data-type="group" className="absolute rounded-[12px] border-2"
      style={{ left: n.x, top: n.y, width: n.width, height: n.height, borderColor: c ?? "var(--border)", background: c ? tint(c, 8, "transparent") : "color-mix(in srgb, var(--foreground) 3%, transparent)", outline: selected ? `${px(2)} solid var(--primary)` : undefined, outlineOffset: px(2) }}>
      <div className="absolute bottom-full left-0 mb-1.5 max-w-full origin-bottom-left" data-group-label={n.id} style={far ? { transform: "scale(calc(0.4 / var(--k, 1)))" } : undefined}>
        {editingLabel
          ? <LabelEditor value={String(n.label ?? "")} className="h-8 min-w-[160px] rounded-[6px] border border-border bg-card px-2 text-[18px] font-semibold" onDone={(t) => onLabel(n.id, t)} />
          : n.label ? <span className="block truncate rounded-[6px] px-1 text-[18px] font-semibold" style={{ color: c ?? "var(--muted-foreground)" }}>{String(n.label)}</span> : null}
      </div>
      {resizable && DIRS.map((d) => <ResizeHandle key={d} id={n.id} dir={d} />)}
    </div>
  )
})
