// A conflict shown in place: where the file changed elsewhere in the lines being typed, the user's lines stay editable
// under a "Yours" bar, the other version below them, each with Keep, and Keep both. Saving waits until none is left.
import { invertedEffects, undo } from "@codemirror/commands"
import { StateEffect, StateField, type ChangeSpec, type EditorState, type Extension, type Text } from "@codemirror/state"
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view"
import type { Clash } from "@/core/merge"
import { theirName } from "@/core/autosave"
import { notify } from "@/core/notify"
import { capitalize } from "@/lib/utils"
import { frontmatter } from "./frontmatter"

/** One clash in the doc: the user's lines are `from`..`to` (whole lines, no break after; empty if they deleted them). */
type Chunk = { id: number; from: number; to: number; theirs: string[] }
type Conflicts = { chunks: Chunk[]; who?: string; open?: Open }
/** How many are left as each is settled; with `rest`, the editor is going and these are left (for the next one). */
export type Open = (left: number, rest?: Clash[]) => void

const mapChunk = (c: Chunk, ch: { mapPos: (pos: number, assoc?: number) => number }): Chunk =>
  ({ ...c, from: ch.mapPos(c.from, -1), to: Math.max(ch.mapPos(c.from, -1), ch.mapPos(c.to, 1)) })
const setConflicts = StateEffect.define<Conflicts>()
const addChunk = StateEffect.define<Chunk>({ map: mapChunk })
const dropChunk = StateEffect.define<Chunk>({ map: mapChunk })

const conflictField = StateField.define<Conflicts>({
  create: () => ({ chunks: [] }),
  update(value, tr) {
    let v = tr.docChanged ? { ...value, chunks: value.chunks.map((c) => mapChunk(c, tr.changes)) } : value
    for (const e of tr.effects) {
      if (e.is(setConflicts)) v = e.value
      else if (e.is(dropChunk)) v = { ...v, chunks: v.chunks.filter((c) => c.id !== e.value.id) }
      else if (e.is(addChunk) && !v.chunks.some((c) => c.id === e.value.id)) v = { ...v, chunks: [...v.chunks, e.value].sort((a, b) => a.from - b.from) }
    }
    return v
  },
  provide: (f) => EditorView.decorations.compute([f], decorate),
})

function decorate(state: EditorState): DecorationSet {
  const v = state.field(conflictField)
  if (!v.chunks.length) return Decoration.none
  const ranges = []
  const lines = (c: Chunk) => (c.from === c.to ? 0 : state.doc.lineAt(c.to).number - state.doc.lineAt(c.from).number + 1)
  for (const c of v.chunks) {
    const empty = c.from === c.to, n = Math.max(lines(c), c.theirs.length)
    const atStart = state.doc.lineAt(c.from).from === c.from
    ranges.push(Decoration.widget({ widget: new Bar(c, v.who, "mine", empty, n), block: true, side: empty && !atStart ? 1 : -1 }).range(c.from))
    if (!empty) {
      for (let pos = c.from; pos <= c.to;) {
        const line = state.doc.lineAt(pos)
        ranges.push(Decoration.line({ class: "cm-clash-line" }).range(line.from))
        pos = line.to + 1
      }
    }
    ranges.push(Decoration.widget({ widget: new Bar(c, v.who, "theirs", empty, n), block: true, side: 1 }).range(c.to))
  }
  return Decoration.set(ranges, true)
}

class Bar extends WidgetType {
  c: Chunk; who: string | undefined; side: "mine" | "theirs"; empty: boolean; lines: number
  constructor(c: Chunk, who: string | undefined, side: "mine" | "theirs", empty: boolean, lines: number) {
    super()
    this.c = c; this.who = who; this.side = side; this.empty = empty; this.lines = lines
  }
  eq(o: Bar) { return o.c.id === this.c.id && o.who === this.who && o.side === this.side && o.empty === this.empty && o.lines === this.lines }
  ignoreEvent() { return true }
  toDOM(view: EditorView) {
    const box = document.createElement("div")
    box.className = `cm-clash cm-clash-${this.side}`
    box.dataset.clash = String(this.c.id)
    const button = (label: string, aria: string, which: Which) => {
      const b = document.createElement("button")
      b.type = "button"
      b.textContent = label
      b.setAttribute("aria-label", aria)
      b.addEventListener("mousedown", (e) => e.preventDefault()) // (the keyboard stays where it was)
      b.addEventListener("click", (e) => { e.preventDefault(); keep(view, this.c.id, which) })
      return b
    }
    const bar = (label: string, which: Which, aria: string) => {
      const row = document.createElement("div")
      row.className = "cm-clash-bar"
      const name = document.createElement("span")
      name.className = "cm-clash-label"
      name.textContent = label
      row.append(name, button("Keep", aria, which))
      return row
    }
    const theirs = this.who ? `${this.who}'s` : "Other version"
    if (this.side === "mine") {
      const note = document.createElement("div")
      note.className = "cm-clash-note"
      const what = this.lines > 1 ? "these lines" : "this line"
      note.textContent = this.who ? `${this.who} edited ${what} while you typed` : `${capitalize(what)} changed elsewhere while you typed`
      box.append(note, bar(this.empty ? "Yours (deleted)" : "Yours", "mine", "Keep yours"))
    } else {
      const text = document.createElement("div")
      text.className = "cm-clash-text"
      text.textContent = this.c.theirs.length ? this.c.theirs.join("\n") : "Deleted"
      if (!this.c.theirs.length) text.classList.add("is-empty")
      const both = document.createElement("div")
      both.className = "cm-clash-both"
      if (this.c.theirs.length && !this.empty) both.append(button("Keep both", "Keep both versions", "both"))
      box.append(bar(theirs, "theirs", `Keep ${theirName(this.who)} version`), text, both)
    }
    return box
  }
}

type Which = "mine" | "theirs" | "both"

/** The change that puts `lines` where the chunk's lines are. */
function put(doc: Text, c: Chunk, lines: string[]): ChangeSpec | null {
  const text = lines.join("\n")
  if (c.from < c.to) {
    if (lines.length) return { from: c.from, to: c.to, insert: text }
    return c.to < doc.length ? { from: c.from, to: c.to + 1 } : { from: Math.max(0, c.from - 1), to: c.to }
  }
  if (!lines.length) return null
  if (!doc.length) return { from: 0, insert: text }
  return doc.lineAt(c.from).from === c.from ? { from: c.from, insert: `${text}\n` } : { from: c.from, insert: `\n${text}` }
}

function keep(view: EditorView, id: number, which: Which) {
  const { chunks, who } = view.state.field(conflictField)
  const c = chunks.find((x) => x.id === id)
  if (!c) return
  const mine = c.from === c.to ? [] : view.state.sliceDoc(c.from, c.to).split("\n")
  const changes = which === "mine" ? null : put(view.state.doc, c, which === "theirs" ? c.theirs : [...mine, ...c.theirs])
  view.dispatch({ changes: changes ?? undefined, effects: dropChunk.of(c), userEvent: "input.conflict" })
  const after = view.state.doc
  const text = which === "mine" ? `Kept yours; ${theirName(who)} version is in the note's history`
    : which === "theirs" ? `Kept ${theirName(who)} version; yours is in the note's history` : "Kept both versions"
  notify(text, { id: `clash:${id}`, action: { label: "Undo", run: () => {
    if (view.state.doc !== after) throw new Error("Couldn't undo: the text changed since. Both versions are in the note's history.")
    undo(view)
  } } })
}

/** The editor's conflicts: drawn in place, undone with the text (⌘Z puts a chunk back), told to `open` as they go. */
export const conflicts: Extension = [
  conflictField,
  EditorView.updateListener.of((u) => {
    const was = u.startState.field(conflictField).chunks.length, now = u.state.field(conflictField)
    if (was !== now.chunks.length) queueMicrotask(() => now.open?.(now.chunks.length))
  }),
  invertedEffects.of((tr) => {
    const out: StateEffect<unknown>[] = []
    for (const e of tr.effects) if (e.is(dropChunk)) out.push(addChunk.of(e.value))
    return out
  }),
]

/** Show `clashes` (lines of `text`, now the doc) in place; false when one is where it can't be shown (a hidden
 *  frontmatter). `open` hears how many are left as each is settled (or undone). */
export function showConflicts(view: EditorView, clashes: Clash[], who: string | undefined, open: Open): boolean {
  const doc = view.state.doc, body = view.state.field(frontmatter, false) ?? 0
  let id = Date.now()
  const chunks: Chunk[] = []
  for (const k of clashes) {
    const first = k.at + 1
    if (first > doc.lines) { chunks.push({ id: id++, from: doc.length, to: doc.length, theirs: k.theirs }); continue }
    const from = doc.line(first).from
    const to = k.mine.length ? doc.line(Math.min(doc.lines, first + k.mine.length - 1)).to : from
    if (body && from < body) return false
    chunks.push({ id: id++, from, to, theirs: k.theirs })
  }
  view.dispatch({ effects: setConflicts.of({ chunks, who, open }) })
  const near = chunks.find((c) => c.to >= view.state.selection.main.head) ?? chunks[0]
  if (near && !view.hasFocus) view.dispatch({ effects: EditorView.scrollIntoView(near.from, { y: "center" }) })
  return true
}

/** Scroll to the first conflict left. */
export function revealConflict(view: EditorView) {
  const c = view.state.field(conflictField, false)?.chunks[0]
  if (c) view.dispatch({ effects: EditorView.scrollIntoView(c.from, { y: "center" }) })
}

/** The editor going: the conflicts left, as clashes in its text, handed to whoever showed them. */
export function leaveConflicts(view: EditorView) {
  const { chunks, open } = view.state.field(conflictField, false) ?? { chunks: [] }
  if (!chunks.length || !open) return
  const doc = view.state.doc
  open(chunks.length, chunks.map((c) => ({ at: doc.lineAt(c.from).number - (c.from === c.to && doc.lineAt(c.from).from !== c.from ? 0 : 1),
    mine: c.from === c.to ? [] : doc.sliceString(c.from, c.to).split("\n"), theirs: c.theirs })))
}
