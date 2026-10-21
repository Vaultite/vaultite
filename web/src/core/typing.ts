// Writing, the bars above files fade (appearance `typingFade`), as writing apps do: back once the pointer moves or at
// Escape. Two keys in a file start it, so a shortcut's key doesn't.
import { useEffect } from "react"

/** How far (px) the pointer moves, and how long (ms) after a key, before it counts: a palm brushing the trackpad mid-sentence isn't a reach for the bar. */
const MOVE = 16, AFTER_KEY = 500

export function useTypingFade(on: boolean) {
  useEffect(() => {
    const root = document.documentElement.dataset
    if (!on) { delete root.typing; return }
    let keys = 0, last = 0, moved = 0
    const show = () => { keys = 0; moved = 0; delete root.typing }
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return show()
      if (e.metaKey || e.ctrlKey || e.altKey || !(e.key.length === 1 || e.key === "Backspace" || e.key === "Enter")) return
      if (!(e.target as Element).closest?.("[data-pane] :is([contenteditable=true], textarea)")) return
      last = e.timeStamp; moved = 0
      if (++keys >= 2) root.typing = ""
    }
    const move = (e: PointerEvent) => {
      if (!("typing" in root) || e.pointerType === "touch" || e.timeStamp - last < AFTER_KEY) return
      moved += Math.abs(e.movementX) + Math.abs(e.movementY)
      if (moved > MOVE) show()
    }
    addEventListener("keydown", key, true)
    addEventListener("pointermove", move, { passive: true })
    addEventListener("blur", show)
    return () => { show(); removeEventListener("keydown", key, true); removeEventListener("pointermove", move); removeEventListener("blur", show) }
  }, [on])
}
