import { Combine, Merge, Scissors } from "lucide-react"
import {
  choose, createFile, currentEditor, currentFile, definePlugin, deleteFile, folderOf, freeName, get, getStore, isHidden, linkTo, notify,
  notifyError, openFile, put, readFile, restoreFile, splitFm, stem, type Choice,
} from "@vaultite"

// Note composer: extract the selection into another note (leaving a link), or merge this note into
// another (this one to the trash; Undo puts both back).

/** The notes that can take text: Markdown, not hidden, not this one. */
function notes(except: string) {
  const s = getStore()
  return (s?.files.files ?? []).filter((f) => f.path.endsWith(".md") && f.path !== except && !isHidden(f.path))
    .sort((a, b) => b.mtime - a.mtime)
    .map((f): Choice => ({ id: f.path, label: stem(f.path).replace(/^.*\//, ""), detail: folderOf(f.path) || undefined }))
}

/** `text` at the end of `path`, a blank line before it; answers the file's text before. */
async function append(path: string, text: string) {
  const f = await readFile(path)
  const next = `${f.text.replace(/\s*$/, "")}${f.text.trim() ? "\n\n" : ""}${text.replace(/\s*$/, "")}\n`
  await put("file", { path, text: next, base: f.text })
  return { before: f.text, after: next }
}

/** The note the editor shows, and its editor, when there's text selected in it that can be moved. */
function selection() {
  const ed = currentEditor()
  if (!ed || ed.kind !== "markdown" || ed.view.state.readOnly || !ed.path) return null
  const r = ed.view.state.selection.main
  return r.empty ? null : { view: ed.view, path: ed.path, from: r.from, to: r.to }
}

function extract() {
  const sel = selection()
  if (!sel) return
  const text = sel.view.state.sliceDoc(sel.from, sel.to)
  choose({
    title: "Extract current selection",
    placeholder: "Move the selection to a note…",
    items: notes(sel.path),
    other: (typed) => ({ id: `new:${typed.trim()}`, label: typed.trim(), detail: "New note" }),
    onPick: (it) => void (async () => {
      try {
        let to: string
        if (it.id.startsWith("new:")) {
          const s = getStore()!
          const folder = folderOf(sel.path)
          to = (await createFile(folder, freeName(s.files, folder, it.id.slice(4).replace(/[/\\:]/g, "-")), `${text.replace(/\s*$/, "")}\n`)).path
        } else {
          to = it.id
          await append(to, text)
        }
        let after = "link"
        try { after = (await get<{ afterExtract?: string }>("config/plugin/note-composer")).afterExtract ?? after } catch { /* the default */ }
        const insert = after === "none" ? "" : `${after === "embed" ? "!" : ""}${linkTo(to)}`
        // Where the selection is now (typing meanwhile moved it).
        const doc = sel.view.state.doc
        const from = Math.min(sel.from, doc.length), end = Math.min(sel.to, doc.length)
        if (doc.sliceString(from, end) === text) sel.view.dispatch({ changes: { from, to: end, insert }, selection: { anchor: from + insert.length }, userEvent: "input" })
        notify(`Moved to ${stem(to).replace(/^.*\//, "")}`)
      } catch (e) { notifyError(e, "Couldn't move it") }
    })(),
  })
}

function merge() {
  const from = currentFile()
  if (!from.endsWith(".md")) return
  choose({
    title: "Merge current file with another file",
    placeholder: `Merge ${stem(from).replace(/^.*\//, "")} into…`,
    items: notes(from),
    onPick: (it) => void (async () => {
      try {
        const body = splitFm((await readFile(from)).text).body.replace(/^\n+/, "")
        const { before, after } = await append(it.id, body)
        openFile(it.id)
        const trashed = await deleteFile(from, { quiet: true })
        notify(`Merged ${stem(from).replace(/^.*\//, "")} into ${stem(it.id).replace(/^.*\//, "")}`, { action: { label: "Undo", run: async () => {
          await put("file", { path: it.id, text: before, base: after })
          if (trashed) openFile(await restoreFile(trashed))
        } } })
      } catch (e) { notifyError(e, "Couldn't merge them") }
    })(),
  })
}

export default definePlugin({
  icon: Combine,
  commands: [
    { id: "note-composer:extract", name: "Extract current selection…", when: () => !!selection(), run: extract, icon: Scissors },
    { id: "note-composer:merge-file", name: "Merge current file with another file…", when: () => currentFile().endsWith(".md"), run: merge, icon: Merge },
  ],
})
