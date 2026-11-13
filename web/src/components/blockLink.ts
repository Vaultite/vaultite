import type { EditorView } from "@codemirror/view"
import { blockAt, newBlockId, blocksOf, type NoteBlock } from "../../../core/blockrefs.ts"
import { headingsOf, linkText } from "../../../core/sections.ts"
import { getStore } from "@/core/data"
import { editorOf } from "@/core/editors"
import { newLink } from "@/core/links"
import { copied } from "@/components/FileActions"
import { blockIdChange } from "@/editor/linkComplete"

export function linkableHere(view: EditorView): { path: string; heading?: string; block?: NoteBlock } | null {
  const path = editorOf(view)?.path
  if (!path || !/\.md$/i.test(path)) return null
  const doc = view.state.doc, text = doc.toString(), line = doc.lineAt(view.state.selection.main.head).number - 1
  const h = headingsOf(text).find((x) => x.line === line)
  if (h) return { path, heading: linkText(h.text).replace(/[[\]|#^]/g, " ").replace(/\s+/g, " ").trim() }
  const block = blockAt(text, line)
  return block && (block.id || !view.state.readOnly) ? { path, block } : null
}

export function copyBlockLink(view: EditorView): boolean {
  const here = linkableHere(view), s = getStore()
  if (!here || !s) return false
  let anchor = here.heading ?? ""
  if (here.block) {
    const b = here.block, text = view.state.doc.toString()
    const id = b.id ?? newBlockId((x) => blocksOf(text).some((o) => o.id === x))
    if (!b.id) view.dispatch({ changes: blockIdChange(view.state.doc, b, id), userEvent: "input.block-id" })
    anchor = `^${id}`
  }
  void copied(newLink(s, { path: here.path, anchor }), "link")
  return true
}
