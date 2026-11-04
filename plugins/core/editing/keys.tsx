// Phones: while a note is being written, a row of editing keys over the on-screen keyboard (the terminal's KeyBar),
// made of commands by id, in the order the `toolbar` setting lists them.
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import {
  Bold, ChevronLeft, ChevronRight, Code, Heading1, Heading2, Heading3, Highlighter, ImagePlus, Italic, Link, Link2, List, ListIndentDecrease, ListIndentIncrease,
  ListOrdered, Plus, Quote, Redo2, SquareCheck, Strikethrough, Undo2, type LucideIcon,
} from "lucide-react"
import { cn, currentEditor, Group, KeyBar, notifyError, offeredCommand, usePluginSettings, useVisibleArea } from "@vaultite"
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

// ---------- its settings: the keys as they'll show

/** Keys over the keyboard, drawn as the row is: one tapped is moved along or taken off; the rest are a tap to add. */
export function ToolbarSettings() {
  const [settings, save] = usePluginSettings("editing")
  const [picked, setPicked] = useState<string | null>(null)
  const ids = (Array.isArray(settings?.toolbar) ? (settings.toolbar as string[]) : DEFAULT).filter((id) => ICONS[id])
  const rest = Object.keys(ICONS).filter((id) => !ids.includes(id))
  const custom = Array.isArray(settings?.toolbar)
  const put = (next: string[]) => save({ toolbar: next.join() === DEFAULT.join() ? null : next }).catch((e) => notifyError(e, "Couldn't save it"))
  const name = (id: string) => LABELS[id as keyof typeof LABELS] ?? id
  const at = picked ? ids.indexOf(picked) : -1
  const move = (by: number) => {
    const j = at + by
    if (at < 0 || j < 0 || j >= ids.length) return
    const next = [...ids]; [next[at], next[j]] = [next[j], next[at]]
    void put(next)
  }
  const key = "grid size-10 shrink-0 cursor-pointer place-items-center rounded-[8px] transition-colors"
  const btn = "flex h-8 cursor-pointer items-center gap-1 rounded-[7px] border-[0.5px] border-border bg-card px-2.5 text-[13px] hover:bg-foreground/[0.05] disabled:cursor-default disabled:opacity-40"
  return (
    <Group>
      <div className="py-2.5" data-setting="toolbar" data-toolbar-settings>
        <div className="text-[15px] leading-[20px] md:text-[13px] md:leading-[18px]">Keys over the keyboard</div>
        <div className="text-[13px] leading-[18px] text-muted-foreground md:text-[12px] md:leading-[16px]">On a phone, while you write. Tap one to move it or take it off.</div>
        <div role="listbox" aria-label="Keys over the keyboard" aria-orientation="horizontal"
          className="mt-2.5 flex gap-0.5 overflow-x-auto rounded-[12px] bg-muted p-1 shadow-[inset_0_0.5px_0_var(--border)]" data-toolbar-bar>
          {ids.map((id) => {
            const Icon = ICONS[id]!, on = picked === id
            return (
              <button key={id} type="button" role="option" aria-selected={on} aria-label={name(id)} data-tip={name(id)} data-toolbar-key={id}
                onClick={() => setPicked(on ? null : id)}
                className={cn(key, on ? "bg-card text-primary shadow-[0_1px_3px_rgb(0_0_0/0.15)] ring-1 ring-primary" : "text-foreground hover:bg-foreground/[0.06]")}>
                <Icon className="size-[18px]" strokeWidth={2} />
              </button>
            )
          })}
          {!ids.length && <span className="px-2 py-2.5 text-[13px] text-muted-foreground">No keys: add some below</span>}
        </div>
        {at >= 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5" data-toolbar-picked={picked}>
            <span className="mr-auto text-[13px] font-medium">{name(picked!)}</span>
            <button type="button" className={btn} disabled={at === 0} onClick={() => move(-1)} aria-label="Move left"><ChevronLeft className="size-3.5" strokeWidth={2.25} />Left</button>
            <button type="button" className={btn} disabled={at === ids.length - 1} onClick={() => move(1)} aria-label="Move right">Right<ChevronRight className="size-3.5" strokeWidth={2.25} /></button>
            <button type="button" className={cn(btn, "text-ink-(--red)")} data-toolbar-remove onClick={() => { void put(ids.filter((x) => x !== picked)); setPicked(null) }}>Take off</button>
          </div>
        )}
        {!!rest.length && (
          <>
            <div className="mt-3 mb-1.5 text-[12px] font-medium text-muted-foreground">More keys</div>
            <div className="flex flex-wrap gap-1.5">
              {rest.map((id) => {
                const Icon = ICONS[id]!
                return (
                  <button key={id} type="button" data-toolbar-add={id} onClick={() => { void put([...ids, id]); setPicked(id) }}
                    className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full border-[0.5px] border-border pr-3 pl-2 text-[13px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground">
                    <Plus className="size-3.5" strokeWidth={2.25} /><Icon className="size-4" strokeWidth={2} />{name(id)}
                  </button>
                )
              })}
            </div>
          </>
        )}
        {custom && (
          <button type="button" onClick={() => { void put(DEFAULT); setPicked(null) }} data-toolbar-reset
            className="mt-3 cursor-pointer text-[13px] text-primary hover:underline">Back to the default keys</button>
        )}
      </div>
    </Group>
  )
}
