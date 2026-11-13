import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state"
import { EditorView, layer, RectangleMarker } from "@codemirror/view"
import { bodyStart, shownStart } from "./frontmatter"

export type DropSpot = { pos: number; where: "before" | "after" | "in" | "at" }

const showSpot = StateEffect.define<DropSpot | null>()
const holdSpot = StateEffect.define<{ id: number; spot: DropSpot | null }>()
const mapSpot = (s: DropSpot, tr: { changes: { mapPos: (p: number, assoc?: number) => number } }) =>
  ({ ...s, pos: tr.changes.mapPos(s.pos, s.where === "before" ? -1 : 1) })

const shown = StateField.define<DropSpot | null>({
  create: () => null,
  update: (s, tr) => tr.effects.reduce((v, e) => (e.is(showSpot) ? e.value : v), s && tr.docChanged ? mapSpot(s, tr) : s),
})
const held = StateField.define<ReadonlyMap<number, DropSpot>>({
  create: () => new Map(),
  update(m, tr) {
    let out = m
    if (tr.docChanged && m.size) out = new Map([...m].map(([id, s]) => [id, mapSpot(s, tr)]))
    for (const e of tr.effects) if (e.is(holdSpot)) {
      const next = new Map(out)
      if (e.value.spot) next.set(e.value.id, e.value.spot)
      else next.delete(e.value.id)
      out = next
    }
    return out
  },
})

export function spotAt(view: EditorView, at: { x: number; y: number }): DropSpot {
  const doc = view.state.doc, floor = Math.max(bodyStart(doc), shownStart(view.state))
  const r = view.contentDOM.getBoundingClientRect()
  const blank = (b: { from: number; to: number }) => !doc.sliceString(b.from, b.to).trim()
  if (at.y >= r.bottom) {
    const last = view.lineBlockAt(doc.length)
    return { pos: doc.length, where: last.to < floor || blank(last) ? "in" : "after" }
  }
  const h = (Math.max(at.y, r.top) - view.documentTop) / view.scaleY
  const b = view.lineBlockAtHeight(h)
  if (b.to < floor) return { pos: floor, where: floor === doc.length || blank(doc.lineAt(floor)) ? "in" : "before" }
  if (blank(b)) return { pos: Math.max(b.from, floor), where: "in" }
  return h < (b.top + b.bottom) / 2 ? { pos: Math.max(b.from, floor), where: "before" } : { pos: b.to, where: "after" }
}

export function pointAt(view: EditorView, at: { x: number; y: number }): DropSpot {
  const floor = Math.max(bodyStart(view.state.doc), shownStart(view.state)), pos = view.posAtCoords(at)
  return pos === null || pos < floor ? spotAt(view, at) : { pos, where: "at" }
}

// A drag that leaves the window or is called off tells nothing to what it was over, so the line times out.
export function markDrop(view: EditorView, spot: DropSpot | null) {
  clearTimeout(timers.get(view))
  const was = view.state.field(shown, false)
  if (was === undefined) return
  if (spot) timers.set(view, setTimeout(() => markDrop(view, null), 350))
  if (spot?.pos !== was?.pos || spot?.where !== was?.where) view.dispatch({ effects: showSpot.of(spot) })
}
const timers = new WeakMap<EditorView, ReturnType<typeof setTimeout>>()

let ids = 0
export async function dropInto(view: EditorView, spot: DropSpot, text: Promise<string | null>) {
  const id = ++ids
  view.dispatch({ effects: holdSpot.of({ id, spot }) })
  let got: string | null = null
  try { got = await text } finally { if (view.state.field(held, false)) view.dispatch({ effects: holdSpot.of({ id, spot: null }) }) }
  const now = view.state.field(held, false)?.get(id) ?? spot
  if (!got) return false
  const { pos, insert } = placed(view.state, { ...now, pos: Math.min(now.pos, view.state.doc.length) }, got)
  view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length - (now.where === "before" ? 1 : 0) }, userEvent: "input.drop", scrollIntoView: true })
  if (view.state.facet(EditorView.editable)) view.focus()
  return true
}

function placed(state: EditorState, spot: DropSpot, text: string) {
  if (spot.where === "before") return { pos: state.doc.lineAt(spot.pos).from, insert: `${text}\n` }
  if (spot.where === "after") return { pos: state.doc.lineAt(spot.pos).to, insert: `\n${text}` }
  return { pos: spot.pos, insert: text }
}

const dropLine = layer({
  above: true,
  class: "cm-file-drop-layer",
  update: (u) => u.state.field(shown) !== u.startState.field(shown) || (!!u.state.field(shown) && u.geometryChanged),
  markers(view) {
    const spot = view.state.field(shown)
    if (!spot) return []
    if (spot.where === "at") {
      const at = view.coordsAtPos(Math.min(spot.pos, view.state.doc.length)), base = view.scrollDOM.getBoundingClientRect()
      if (!at) return []
      const x = (at.left - base.left) / view.scaleX + view.scrollDOM.scrollLeft, top = (at.top - base.top) / view.scaleY + view.scrollDOM.scrollTop
      return [new RectangleMarker("cm-file-drop", x - 1, top, 2, (at.bottom - at.top) / view.scaleY)]
    }
    const b = view.lineBlockAt(Math.min(spot.pos, view.state.doc.length))
    const y = spot.where === "before" ? b.top : spot.where === "after" ? b.bottom : (b.top + b.bottom) / 2
    const base = view.scrollDOM.getBoundingClientRect(), c = view.contentDOM.getBoundingClientRect()
    const left = (c.left - base.left) / view.scaleX + view.scrollDOM.scrollLeft
    const top = (view.documentTop - base.top) / view.scaleY + view.scrollDOM.scrollTop + y
    return [new RectangleMarker("cm-file-drop", left, top - 1, c.width / view.scaleX, 2)]
  },
})

export const fileDrops: Extension = [shown, held, dropLine]
