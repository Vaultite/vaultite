// Phones: while a note is being written, a row of editing keys over the on-screen keyboard (the terminal's KeyBar),
// made of commands by id, in the order the `toolbar` setting lists them.
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import {
  Bold, Code, Heading1, Heading2, Heading3, Highlighter, ImagePlus, Italic, Link, Link2, List, ListIndentDecrease, ListIndentIncrease,
  ListOrdered, Quote, Redo2, SquareCheck, Strikethrough, Undo2, type LucideIcon,
} from "lucide-react"
import { currentEditor, KeyBar, offeredCommand, usePluginSettings, useVisibleArea } from "@vaultite"
import type { EditorView } from "@codemirror/view"
import manifest from "./manifest.json"

const ICONS: Partial<Record<string, LucideIcon>> = {
  "editor:undo": Undo2, "editor:redo": Redo2, "editor:insert-wikilink": Link, "editor:insert-link": Link2,
  "editor:toggle-checklist-status": SquareCheck, "editor:toggle-bullet-list": List, "editor:toggle-numbered-list": ListOrdered,
  "editor:unindent-list": ListIndentDecrease, "editor:indent-list": ListIndentIncrease, "editor:toggle-bold": Bold,
  "editor:toggle-italics": Italic, "editor:toggle-strikethrough": Strikethrough, "editor:toggle-highlight": Highlighter,
  "editor:toggle-code": Code, "editor:set-heading-1": Heading1, "editor:set-heading-2": Heading2, "editor:set-heading-3": Heading3,
  "editor:toggle-blockquote": Quote, "editor:add-photo": ImagePlus,
}
const { default: DEFAULT, labels: LABELS } = manifest.settings.toolbar

/** The note being typed in on a touch screen: an editable Markdown editor with the keyboard. */
function typingIn(): EditorView | null {
  const ed = currentEditor()
  return ed?.kind === "markdown" && document.activeElement === ed.view.contentDOM && !ed.view.state.readOnly ? ed.view : null
}

export function NoteKeys() {
  const [view, setView] = useState<EditorView | null>(null)
  const [settings] = usePluginSettings("editing")
  useEffect(() => {
    if (!matchMedia("(pointer: coarse)").matches) return
    // (on focusout the focus hasn't landed yet)
    const check = () => setTimeout(() => setView(typingIn()))
    document.addEventListener("focusin", check)
    document.addEventListener("focusout", check)
    return () => { document.removeEventListener("focusin", check); document.removeEventListener("focusout", check) }
  }, [])
  const area = useVisibleArea(!!view)
  if (!view || !area?.keyboard) return null
  const ids = Array.isArray(settings?.toolbar) ? settings.toolbar as string[] : DEFAULT
  const keys = ids.flatMap((id) => {
    const Icon = ICONS[id], c = offeredCommand(id)
    return Icon && c ? [{ name: LABELS[id as keyof typeof LABELS] ?? c.name, label: <Icon className="size-[18px]" strokeWidth={2} />, run: () => void c.run() }] : []
  })
  return createPortal(
    <div className="fixed inset-x-0 z-[45] -translate-y-full" style={{ top: area.top + area.height }}>
      <KeyBar label="Editing keys" scroll keys={keys} hide={() => view.contentDOM.blur()} />
    </div>,
    // (in a sheet: a modal <dialog> is above everything outside it)
    view.dom.closest<HTMLElement>("dialog[open]") ?? document.body,
  )
}
