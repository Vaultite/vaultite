// Dictation into a terminal: each settled chunk goes in at its cursor as a paste (bracketed when its program asked), on
// one line and never with an Enter, so nothing runs until the user presses it. The terminal draws the pending words.
import { joinText, type DictationTarget } from "@vaultite"

/** What a terminal view offers dictation, on its [data-terminal] element (plugins/core/terminal/Terminal.tsx). */
export type TerminalInput = {
  /** Typed in, as the keyboard sends it. */
  send: (data: string) => void
  /** Its program asked for bracketed pastes. */
  bracketed: () => boolean
  /** The cursor on screen and what its line shows before it; null while it's off screen. */
  caret: () => { rect: DOMRect; before: string } | null
  /** Words not settled yet, drawn dimmed at the cursor ("" none). */
  pending: (text: string) => void
}

/** Said words as one line of plain text: a line break or any other control character is a space. */
export const oneLine = (text: string) => text.replace(/\s*[\x00-\x1f\x7f\x85\u2028\u2029]+\s*/g, " ")

/** Dictate into the terminal drawn in `el`, at its cursor. */
export function terminalTarget(el: HTMLElement, term: TerminalInput): DictationTarget {
  /** The last words sent, while the screen may not show them yet; forgotten once the user types there. */
  let sent: string | null = null
  const typed = () => { sent = null }
  el.addEventListener("keydown", typed, true)
  const before = () => sent ?? term.caret()?.before ?? ""
  return {
    showsPending: true,
    owns: (e) => el.contains(e),
    pending(text) { term.pending(text ? joinText(before(), oneLine(text)) : "") },
    final(text) {
      term.pending("")
      if (!el.isConnected) return
      const insert = joinText(before(), oneLine(text))
      if (!insert) return
      term.send(term.bracketed() ? `\x1b[200~${insert}\x1b[201~` : insert)
      sent = insert
    },
    end() { term.pending(""); el.removeEventListener("keydown", typed, true) },
    rect() {
      if (!el.isConnected) return null
      // (its tab hidden: nowhere now)
      if (!el.getClientRects().length) return new DOMRect()
      const c = term.caret()
      if (c) return c.rect
      const r = el.getBoundingClientRect()
      return new DOMRect(r.left, r.bottom, 0, 0)
    },
  }
}
