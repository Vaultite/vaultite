// The editor's right-click menu: spelling (the desktop app), the link clicked (or Add link), Format ▸, Paragraph ▸ and
// Insert ▸ (the editing commands, with their keys), the clipboard, then searching for what's selected. Loaded with the editor.
import { EditorSelection } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import {
  BookA, BookPlus, Bold, ClipboardPaste, ClipboardType, Code, Copy, Footprints, Globe, Heading1, Heading2, Heading3, Heading4,
  Heading5, Heading6, Highlighter, ImagePlus, Italic, Link, Link2, List, ListOrdered, ListTodo, MessageSquareQuote, Minus, Percent,
  Pilcrow, Quote, RemoveFormatting, Scissors, Search, Sigma, SquareCode, SquareSigma, Strikethrough, Table, TextCursorInput,
  TextSelect, type LucideIcon,
} from "lucide-react"
import {
  copyText, drawnLink, editorMenuItems, editorOf, grouped, highlightItems, keyHint, keysOf, linkItems, linksIn, lookUp, notifyError, offeredCommand, openMenu,
  selectAllIn, selectedText, spelling, type Link as Linked, type LinkEdit, type LinkSpan, type MenuItem,
} from "@vaultite"

type Entry = [id: string, label: string, icon: LucideIcon]
const FORMAT: (Entry | null)[] = [
  ["editor:toggle-bold", "Bold", Bold], ["editor:toggle-italics", "Italic", Italic], ["editor:toggle-strikethrough", "Strikethrough", Strikethrough],
  ["editor:toggle-highlight", "Highlight", Highlighter], ["editor:toggle-code", "Code", Code], ["editor:toggle-inline-math", "Math", Sigma],
  ["editor:toggle-comment", "Comment", Percent], null, ["editor:clear-formatting", "Clear formatting", RemoveFormatting],
]
const PARAGRAPH: (Entry | null)[] = [
  ["editor:toggle-bullet-list", "Bullet list", List], ["editor:toggle-numbered-list", "Numbered list", ListOrdered],
  ["editor:toggle-task-list", "Task list", ListTodo], null,
  ...[Heading1, Heading2, Heading3, Heading4, Heading5, Heading6].map((icon, i): Entry => [`editor:set-heading-${i + 1}`, `Heading ${i + 1}`, icon]),
  ["editor:set-heading-0", "Body", Pilcrow], null, ["editor:toggle-blockquote", "Quote", Quote],
]
const INSERT: (Entry | null)[] = [
  ["editor:insert-footnote", "Footnote", Footprints], ["editor:insert-table", "Table", Table], ["editor:insert-callout", "Callout", MessageSquareQuote],
  ["editor:insert-horizontal-rule", "Horizontal rule", Minus], ["editor:insert-codeblock", "Code block", SquareCode],
  ["editor:insert-mathblock", "Math block", SquareSigma], null, ["editor:add-photo", "Photo", ImagePlus],
]

/** A command as an item, with its keys in effect; none while it isn't offered (its plugin off, a read-only note). It
 *  runs in this editor: the focus goes back to it first, since commands act on the editor that has it. */
function command(view: EditorView, e: Entry | null, sep = false): MenuItem[] {
  const c = e && offeredCommand(e[0])
  if (!e || !c) return []
  const keys = keysOf(c)[0]
  return [{ label: e[1], icon: e[2], sep, hint: keys ? keyHint(keys) : undefined, run: () => { view.focus(); c.run() } }]
}
/** A submenu of commands, a line where the list has a null. Highlight: a click toggles it, its submenu colours it. */
const submenu = (view: EditorView, label: string, icon: LucideIcon, list: (Entry | null)[]): MenuItem[] => {
  const items = list.flatMap((e, i) => command(view, e, list[i - 1] === null)
    .map((it) => (e?.[0] === "editor:toggle-highlight" ? { ...it, split: true, items: highlightItems(view) } : it)))
  return items.length ? [{ label, icon, run: () => {}, items }] : []
}

type Spelled = { word: string; suggestions: string[] }

/** The link right-clicked (`target`: the element under the pointer): what it goes to as drawn, where it's written. */
function linkAt(view: EditorView, target: EventTarget | null): { link: Linked; text: string; span: LinkSpan | null } | null {
  const drawn = drawnLink(target)
  if (!drawn || !view.contentDOM.contains(drawn.el)) return null
  let pos: number
  try { pos = view.posAtDOM(drawn.el) } catch { return { ...drawn, span: null } }
  const line = view.state.doc.lineAt(pos)
  return { ...drawn, span: linksIn(line.text, line.from).find((l) => !l.embed && l.from <= pos && pos <= l.to) ?? null }
}

/** Editing a link where it's written: its target selected to type over; taken out, its text (or alias) left. */
function linkEdit(view: EditorView, span: LinkSpan): LinkEdit {
  const [a, b] = span.target, doc = view.state.doc
  const shown = span.text ? doc.sliceString(...span.text) : doc.sliceString(a, b)
  // (the note changed while the menu showed: the link may be elsewhere now)
  const same = () => view.state.doc === doc
  return {
    edit: () => { if (!same()) return; view.focus(); view.dispatch({ selection: EditorSelection.range(a, b), scrollIntoView: true, userEvent: "select" }) },
    // (a bare address is only its text already)
    unlink: span.from === a && span.to === b ? undefined : () => {
      if (same()) view.dispatch({ changes: { from: span.from, to: span.to, insert: shown }, selection: { anchor: span.from + shown.length }, userEvent: "delete.unlink" })
    },
  }
}

/** The menu for a right-click at `at` on `target` (`spelled`: what the desktop app's spell checker said of the word there). */
function menuItems(view: EditorView, at: { x: number; y: number }, target: EventTarget | null, spelled: Spelled | null): MenuItem[] {
  const editable = view.state.facet(EditorView.editable)
  const pos = view.posAtCoords(at)
  const link = linkAt(view, target)
  // Outside what's selected, the cursor goes where the click was (a paste goes there), as in Obsidian; not onto a link,
  // which would show as its Markdown under the menu.
  if (editable && pos !== null && !link && !view.state.selection.ranges.some((r) => r.from <= pos && pos <= r.to)) view.dispatch({ selection: EditorSelection.cursor(pos) })
  const text = selectedText({ view })
  const short = text.replace(/\s+/g, " ").trim().replace(/^(.{24}).+$/, "$1…")
  const edit = link?.span && editable && !link.link.tag ? linkEdit(view, link.span) : null
  return grouped([
    editable && pos !== null && spelled?.word ? spellItems(view, spelled, pos) : [],
    // A link: its own menu (open it, copy it, change it), as a browser's has; else ways to add one.
    link ? linkItems(link.link, { from: editorOf(view)?.path, text: link.text, edit })
      : [...command(view, ["editor:insert-wikilink", "Add link", Link]), ...command(view, ["editor:insert-link", "Add external link", Link2])],
    [...submenu(view, "Format", Bold, FORMAT), ...submenu(view, "Paragraph", Pilcrow, PARAGRAPH), ...submenu(view, "Insert", TextCursorInput, editable ? INSERT : [])],
    editorMenuItems(view),
    [
      ...(text && editable ? [{ label: "Cut", icon: Scissors, hint: keyHint("Mod+X"), run: () => cut(view, text) }] : []),
      ...(text ? [{ label: "Copy", icon: Copy, hint: keyHint("Mod+C"), run: () => { copyText(text).catch((e) => notifyError(e)) } }] : []),
      ...(editable ? [{ label: "Paste", icon: ClipboardPaste, hint: keyHint("Mod+V"), run: () => void paste(view) }] : []),
      ...command(view, ["editor:paste-plain-text", "Paste as plain text", ClipboardType]),
      { label: "Select all", icon: TextSelect, hint: keyHint("Mod+A"), run: () => selectAllIn(view) },
    ],
    !text ? [] : [
      ...command(view, ["search:selection", `Search for “${short}”`, Search]),
      ...(lookUp ? [{ label: `Look up “${short}”`, icon: BookA, run: () => { view.focus(); void lookUp!() } }] : []),
      ...command(view, ["web:search-selection", "Search the web", Globe]),
    ],
  ])
}

/** A misspelled word's guesses (it, found on its line around `pos`), and Add to dictionary. */
function spellItems(view: EditorView, { word, suggestions }: Spelled, pos: number): MenuItem[] {
  const l = view.state.doc.lineAt(pos)
  let from = -1
  for (let i = l.text.indexOf(word); i >= 0 && from < 0; i = l.text.indexOf(word, i + 1)) if (l.from + i <= pos && pos <= l.from + i + word.length) from = l.from + i
  if (from < 0) return []
  const to = from + word.length
  const fix = (s: string): MenuItem => ({ label: s, run: () => view.dispatch({ changes: { from, to, insert: s }, selection: { anchor: from + s.length }, userEvent: "input.spell" }) })
  const learn = () => spelling!.learn(word).then(() => {
    // (the browser checks the text again only once it's told to)
    view.contentDOM.spellcheck = false
    requestAnimationFrame(() => { view.contentDOM.spellcheck = true })
  }, (e) => notifyError(e, "Couldn't add it to the dictionary"))
  // (macOS's checker gives Electron no guesses, only that the word is misspelled)
  return [
    ...suggestions.slice(0, 5).map(fix),
    { label: "Add to dictionary", icon: BookPlus, run: () => void learn() },
  ]
}

function cut(view: EditorView, text: string) {
  copyText(text).then(() => view.dispatch(view.state.replaceSelection(""), { userEvent: "delete.cut" }), (e) => notifyError(e))
}

/** Paste, as ⌘V does: what's on the clipboard handed to the editor as a paste, so a picture is saved as an attachment. */
async function paste(view: EditorView) {
  const data = new DataTransfer()
  try {
    for (const item of await navigator.clipboard.read()) {
      for (const type of item.types) {
        const blob = await item.getType(type)
        // (nameless, like a screenshot's: saved as "Pasted image <date time>")
        if (type.startsWith("image/")) data.items.add(new File([blob], "", { type }))
        else if (type.startsWith("text/")) data.setData(type, await blob.text())
      }
    }
  } catch (e) {
    try { data.setData("text/plain", await navigator.clipboard.readText()) } catch { notifyError(e, "Couldn't read the clipboard"); return }
  }
  view.focus()
  const ev = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })
  view.contentDOM.dispatchEvent(ev)
  // (a browser that leaves a made-up paste's data out: its text put in directly)
  const t = data.getData("text/plain")
  if (!ev.defaultPrevented && t) view.dispatch(view.state.replaceSelection(t), { userEvent: "input.paste", scrollIntoView: true })
}

/** The menu on right-click. Shift+right-click in a browser (its spelling) and a finger (the phone's own menu) keep the
 *  system's; images and drawn blocks have their own (CodeMirror leaves their events to them). */
export const editorMenu = EditorView.domEventHandlers({
  contextmenu(e, view) {
    if (e.defaultPrevented || (e.shiftKey && !spelling) || (e as PointerEvent).pointerType === "touch") return false
    // (the commands' "is there a note being edited" asks the editor with the keyboard)
    const editable = view.state.facet(EditorView.editable)
    if (editable) view.focus()
    const at = { x: e.clientX, y: e.clientY }
    // The desktop app's spell checker answers once the event has gone on to the system (Electron draws no menu of its
    // own): the menu waits for it.
    if (spelling && editable) { void spelling.at().then((s) => openMenu(at, menuItems(view, at, e.target, s))); return false }
    const items = menuItems(view, at, e.target, null)
    if (!items.length) return false
    e.preventDefault()
    openMenu(at, items)
    return true
  },
})
