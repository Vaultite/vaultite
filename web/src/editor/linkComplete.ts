import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete"
import type { Text } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { blockIdAt, blocksOf, findBlockByText, newBlockId, type NoteBlock } from "../../../core/blockrefs.ts"
import type { NewLink } from "../../../core/linkformat.ts"
import { headingsOf, linkText } from "../../../core/sections.ts"

export type LinkName = { label: string; detail?: string; path: string; alias?: boolean }
export type Anchor = { path: string; text: string; id?: string }

export type Linking = {
  from: string
  names: () => LinkName[]
  isFile: (path: string) => boolean
  note: (name: string) => Promise<{ path: string; text: string } | null>
  across: (kind: "heading" | "block", query: string) => Promise<Anchor[]>
  link: (to: NewLink) => string
  giveId: (path: string, words: string, id: string) => void
}

export const blockIdChange = (doc: Text, b: NoteBlock, id: string) => ({ from: blockIdAt(doc.toString(), b), insert: ` ^${id}` })

const short = (t: string) => (t.length > 90 ? `${t.slice(0, 89)}…` : t)
const plain = (h: string) => linkText(h).replace(/[[\]|#^]/g, " ").replace(/\s+/g, " ").trim()

const put = (start: number, link: () => string) => (view: EditorView, _c: Completion, _from: number, to: number) => {
  const end = view.state.sliceDoc(to, to + 2) === "]]" ? to + 2 : to, insert = link()
  view.dispatch({ changes: { from: start, to: end, insert }, selection: { anchor: start + insert.length }, scrollIntoView: true, userEvent: "input.complete" })
}

function pickBlock(l: Linking, start: number, path: string, b: { text: string; id?: string; line?: number }) {
  return (view: EditorView, _c: Completion, _from: number, to: number) => {
    const end = view.state.sliceDoc(to, to + 2) === "]]" ? to + 2 : to
    const own = path === l.from ? blocksOf(view.state.doc.toString()) : null
    const here = own && findBlockByText(own, b.text, b.line)
    const mine = here && !Array.isArray(here) ? here : null
    const id = mine?.id ?? b.id ?? newBlockId((x) => !!own?.some((o) => o.id === x))
    const insert = l.link({ path, anchor: `^${id}` })
    const add = mine && !mine.id ? [blockIdChange(view.state.doc, mine, id)] : []
    view.dispatch({ changes: [{ from: start, to: end, insert }, ...add], selection: { anchor: start + insert.length }, scrollIntoView: true, userEvent: "input.complete" })
    if (!own && !b.id) l.giveId(path, b.text, id)
  }
}

const blockOption = (l: Linking, start: number, path: string, b: NoteBlock | Anchor, detail?: string): Completion => ({
  label: b.text, displayLabel: short(b.text), detail: detail ?? (b.id ? `^${b.id}` : undefined), apply: pickBlock(l, start, path, b),
})

async function across(l: Linking, start: number, typed: string): Promise<CompletionResult | null> {
  const kind = typed.startsWith("##") ? "heading" : "block", found = await l.across(kind, typed.slice(2))
  if (!found.length) return null
  const where = (p: string) => p.replace(/\.md$/i, "")
  return {
    from: start + 4, filter: false,
    options: found.map((a) => (kind === "heading"
      ? { label: a.text, displayLabel: short(a.text), detail: where(a.path), apply: put(start, () => l.link({ path: a.path, anchor: plain(a.text) })) }
      : blockOption(l, start, a.path, a, where(a.path)))),
  }
}

async function inNote(l: Linking, start: number, typed: string, hash: number): Promise<CompletionResult | null> {
  const note = await l.note(typed.slice(0, hash))
  if (!note) return null
  if (typed[hash + 1] === "^") {
    const blocks = blocksOf(note.text).filter((b) => b.text)
    return blocks.length ? { from: start + hash + 4, options: blocks.map((b) => blockOption(l, start, note.path, b)), validFor: /^[^[\]\n|#^]*$/ } : null
  }
  const heads = [...new Set(headingsOf(note.text).map((h) => plain(h.text)).filter(Boolean))]
  return heads.length ? { from: start + hash + 3, options: heads.map((h) => ({ label: h, apply: put(start, () => l.link({ path: note.path, anchor: h })) })), validFor: /^[^[\]\n|#^]*$/ } : null
}

export function linkSource(get: () => Linking | undefined) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const l = get(), m = ctx.matchBefore(/\[\[[^[\]\n]*/)
    if (!l || !m) return null
    const typed = m.text.slice(2)
    if (typed.includes("|")) return null
    if (typed.startsWith("##") || typed.startsWith("^^")) return across(l, m.from, typed)
    const hash = typed.indexOf("#")
    if (hash >= 0) return inNote(l, m.from, typed, hash)
    return {
      from: m.from + 2,
      options: l.names().map((n) => ({ label: n.label, detail: n.detail, apply: put(m.from, () => l.link({ path: n.path, text: n.alias ? n.label : undefined })) })),
      validFor: /^[^[\]\n|#]*$/,
    }
  }
}
