import { ArrowDown, ArrowUp, ClipboardPaste, Delete, Heading1, Heading2, Heading3, Heading4, Heading5, Heading6, ImagePlus, Link, Link2, List, ListOrdered, ListTodo, PenLine, Pilcrow, RemoveFormatting, SquareCheck, Superscript, TextQuote } from "lucide-react"
import { activeFile, currentEditor, definePlugin, notifyError } from "@vaultite"
import type { EditorView } from "@codemirror/view"
import { addPhotos } from "./photo"

// Editing commands with Obsidian's ids, so its names and keys carry over; they win over the editor's own keys, and make
// up its right-click menu (menu.ts). edit.ts loads with the first editor; then they act at once, so a caller (an Obsidian
// plugin) sees the change when the command returns.
let loading: Promise<typeof import("./edit")> | null = null, edit: typeof import("./edit") | null = null
const load = () => (loading ??= import("./edit").then((m) => (edit = m)))

/** The note being edited, if it can be. */
const note = () => { const ed = currentEditor(); return ed?.kind === "markdown" && !ed.view.state.readOnly ? ed.view : null }
const run = (fn: (m: typeof import("./edit")) => (v: EditorView) => unknown) => () => {
  const v = note()
  if (!v) return
  if (edit) { fn(edit)(v); v.focus() } else void load().then((m) => { fn(m)(v); v.focus() })
}
const when = () => !!note()
// (a phone has no right-click menu in a note: Add photo is at the top of the note's … menu there, else under More)
const coarse = () => matchMedia("(pointer: coarse)").matches

const marks: [string, string, string, string[]?][] = [
  ["bold", "Toggle bold", "**", ["Mod+B"]], ["italics", "Toggle italics", "*", ["Mod+I"]], ["highlight", "Toggle highlight", "=="],
  ["strikethrough", "Toggle strikethrough", "~~"], ["code", "Toggle code", "`"], ["inline-math", "Toggle inline math", "$"],
  ["comment", "Toggle comment", "%%", ["Mod+/"]],
]
// (‸ is where the cursor goes.)
const blocks: [string, string, string][] = [
  ["insert-callout", "Insert callout", "> [!note]\n> ‸"],
  ["insert-codeblock", "Insert code block", "```\n‸\n```"],
  ["insert-mathblock", "Insert math block", "$$\n‸\n$$"],
  ["insert-table", "Insert table", "| ‸ |  |\n| --- | --- |\n|  |  |"],
  ["insert-horizontal-rule", "Insert horizontal rule", "---\n‸"],
]

export default definePlugin({
  icon: PenLine,
  commands: [
    ...marks.map(([id, name, m, keys]) => ({ id: `editor:toggle-${id}`, name, keys, when, run: run((e) => e.toggleMark(m)) })),
    { id: "editor:clear-formatting", name: "Clear formatting", when, run: run((e) => e.clearFormatting), icon: RemoveFormatting },
    { id: "editor:insert-link", name: "Insert Markdown link", keys: ["Mod+K"], when, run: run((e) => e.insertLink), icon: Link },
    { id: "editor:insert-wikilink", name: "Add internal link", when, run: run((e) => e.insertWikilink), icon: Link2 },
    { id: "editor:toggle-checklist-status", name: "Toggle checkbox status", keys: ["Mod+L"], when, run: run((e) => e.toggleChecklist), icon: SquareCheck },
    { id: "editor:toggle-bullet-list", name: "Toggle bullet list", when, run: run((e) => e.toggleBullets), icon: List },
    { id: "editor:toggle-numbered-list", name: "Toggle numbered list", when, run: run((e) => e.toggleNumbers), icon: ListOrdered },
    { id: "editor:toggle-task-list", name: "Toggle task list", when, run: run((e) => e.toggleTasks), icon: ListTodo },
    { id: "editor:toggle-blockquote", name: "Toggle blockquote", when, run: run((e) => e.toggleQuote), icon: TextQuote },
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `editor:set-heading-${n}`, name: `Set as heading ${n}`, when, run: run((e) => e.setHeading(n)), icon: [Heading1, Heading2, Heading3, Heading4, Heading5, Heading6][n - 1] })),
    { id: "editor:set-heading-0", name: "Remove heading", when, run: run((e) => e.setHeading(0)), icon: Pilcrow },
    { id: "editor:delete-paragraph", name: "Delete paragraph", keys: ["Mod+D"], when, run: run((e) => e.deleteParagraph), icon: Delete },
    { id: "editor:swap-line-up", name: "Move line up", when, run: run((e) => e.lineUp), icon: ArrowUp },
    { id: "editor:swap-line-down", name: "Move line down", when, run: run((e) => e.lineDown), icon: ArrowDown },
    ...blocks.map(([id, name, text]) => ({ id: `editor:${id}`, name, when, run: run((e) => e.insertBlock(text)) })),
    { id: "editor:insert-footnote", name: "Insert footnote", when, run: run((e) => e.insertFootnote), icon: Superscript },
    // (not through `run`: the picker opens only while the tap or key is being handled)
    { id: "editor:add-photo", name: "Add photo", when: () => !!activeFile(), run: () => { const f = activeFile(); if (f) void addPhotos(f.path) }, icon: ImagePlus },
    { id: "editor:paste-plain-text", name: "Paste as plain text", when, run: () => { const v = note(); if (v) void load().then((m) => m.pastePlain(v)).catch((e) => notifyError(e, "Couldn't read the clipboard")) }, icon: ClipboardPaste },
  ],
  slash: () => (!activeFile() ? [] : [{
    id: "editor:add-photo", title: "Photo", section: "Media", keywords: "photo image picture camera library attachment upload",
    detail: coarse() ? "Library or camera" : "Image file", line: true,
    run: (put) => { const f = activeFile(); if (f) return addPhotos(f.path, put) },
  }]),
  fileMenu: (path) => (/\.md$/i.test(path) && !path.startsWith(".")
    ? [{ label: "Add photo", icon: ImagePlus, section: coarse() ? "actions" : "more", run: () => void addPhotos(path) }] : []),
  editor: () => { void load(); return import("./menu").then((m) => m.editorMenu) },
})
