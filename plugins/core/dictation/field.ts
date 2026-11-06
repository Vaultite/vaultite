// Dictation into a field (the Ask box, a chat's input): the settled words typed in as if typed (the field's own undo
// and input events); the pending ones are shown by the indicator, as a field can't draw them.
import { joinText, type DictationTarget } from "@vaultite"

type Field = HTMLInputElement | HTMLTextAreaElement

export function fieldTarget(el: HTMLElement): DictationTarget {
  const text = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? (el as Field) : null
  let at = text?.selectionEnd ?? 0
  let pending = ""
  /** Words starting now go where the cursor is, if the user moved it since the last ones. */
  const anchor = () => {
    if (text && !pending && document.activeElement === text && text.selectionEnd !== null && text.selectionEnd !== at) at = text.selectionEnd
    return at
  }
  return {
    pending(t) { if (!pending) anchor(); pending = t },
    final(t) {
      if (!el.isConnected) return
      if (!text) {
        // (a contenteditable: typed where its selection is; the session having left, focused again)
        if (document.activeElement !== el) el.focus()
        const sel = window.getSelection()
        if (document.activeElement === el) document.execCommand("insertText", false, joinText(sel?.anchorNode?.textContent?.slice(0, sel.anchorOffset) ?? "", t))
        pending = ""
        return
      }
      const where = pending ? at : anchor(), insert = joinText(text.value.slice(0, where), t)
      pending = ""
      if (!insert) return
      if (document.activeElement === text && text.selectionStart === where && text.selectionEnd === where) {
        document.execCommand("insertText", false, insert)
      } else {
        text.setRangeText(insert, where, where, "end")
        text.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: insert }))
      }
      at = where + insert.length
    },
    end() { pending = "" },
    owns: (e) => el === e || el.contains(e),
    rect() { return el.isConnected ? el.getBoundingClientRect() : null },
  }
}
