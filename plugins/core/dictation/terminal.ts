import { joinText, type DictationTarget } from "@vaultite"
import { TypedLine } from "../../../core/desktop/dictationlearn.ts"
import { WATCH_MS, watchFix, type Watch } from "./learning.ts"

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

export const oneLine = (text: string) => text.replace(/\s*[\x00-\x1f\x7f\x85\u2028\u2029]+\s*/g, " ")

export function terminalTarget(el: HTMLElement, term: TerminalInput): DictationTarget {
  let sent: string | null = null
  let fixing: Fixing | null = null
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
      fixing = fixLine(el, insert, fixing)
    },
    end() { term.pending(""); el.removeEventListener("keydown", typed, true) },
    rect() {
      if (!el.isConnected) return null
      if (!el.getClientRects().length) return new DOMRect()
      const c = term.caret()
      if (c) return c.rect
      const r = el.getBoundingClientRect()
      return new DOMRect(r.left, r.bottom, 0, 0)
    },
  }
}

type Fixing = { line: TypedLine; said: string; watch: Watch; off: () => void }
function fixLine(el: HTMLElement, insert: string, last: Fixing | null): Fixing {
  if (last && !last.line.edited && !last.line.lost && last.said) {
    last.said += insert
    last.line = new TypedLine(last.said)
    last.watch = watchFix(last.said, () => (last.line.lost ? null : last.line.text))
    return last
  }
  last?.off()
  const f: Fixing = { line: new TypedLine(insert), said: insert, watch: watchFix(insert, () => (f.line.lost ? null : f.line.text)), off: () => {
    el.removeEventListener("keydown", key, true); el.removeEventListener("mousedown", f.off, true); clearTimeout(t); f.said = ""; f.watch.done()
  } }
  const key = (e: KeyboardEvent) => {
    const goes = f.line.key(e)
    if (f.line.lost || !goes) return f.off()
    if (f.line.edited) f.watch.edited()
  }
  const t = setTimeout(f.off, WATCH_MS)
  el.addEventListener("keydown", key, true)
  el.addEventListener("mousedown", f.off, true)
  return f
}
