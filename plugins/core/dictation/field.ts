import { joinText, type DictationTarget } from "@vaultite"
import { WATCH_MS, watchFix, type Watch } from "./learning.ts"

type Field = HTMLInputElement | HTMLTextAreaElement

export function fieldTarget(el: HTMLElement): DictationTarget {
  const text = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? (el as Field) : null
  let at = text?.selectionEnd ?? 0
  let pending = ""
  let fixing: Watch | null = null
  let ours = false
  const input = () => { if (!ours) fixing?.edited() }
  let unhook: ReturnType<typeof setTimeout> | undefined
  const anchor = () => {
    if (text && !pending && document.activeElement === text && text.selectionEnd !== null && text.selectionEnd !== at) at = text.selectionEnd
    return at
  }
  return {
    pending(t) { if (!pending) anchor(); pending = t },
    final(t) {
      if (!el.isConnected) return
      if (!text) {
        if (document.activeElement !== el) el.focus()
        const sel = window.getSelection()
        if (document.activeElement === el) document.execCommand("insertText", false, joinText(sel?.anchorNode?.textContent?.slice(0, sel.anchorOffset) ?? "", t))
        pending = ""
        return
      }
      const where = pending ? at : anchor(), insert = joinText(text.value.slice(0, where), t)
      pending = ""
      if (!insert) return
      ours = true
      if (document.activeElement === text && text.selectionStart === where && text.selectionEnd === where) {
        document.execCommand("insertText", false, insert)
      } else {
        text.setRangeText(insert, where, where, "end")
        text.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: insert }))
      }
      ours = false
      at = where + insert.length
      fixing?.done()
      text.addEventListener("input", input)
      clearTimeout(unhook)
      unhook = setTimeout(() => text.removeEventListener("input", input), 3 * WATCH_MS)
      const before = text.value.slice(0, where), after = text.value.slice(at)
      fixing = watchFix(insert, () => {
        const v = text.isConnected ? text.value : null
        return v !== null && v.length >= before.length + after.length && v.startsWith(before) && v.endsWith(after) ? v.slice(before.length, v.length - after.length) : null
      })
    },
    end() { pending = "" },
    owns: (e) => el === e || el.contains(e),
    rect() { return el.isConnected ? el.getBoundingClientRect() : null },
  }
}
