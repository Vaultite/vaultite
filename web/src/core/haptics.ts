import { phoneApp } from "@/core/phoneapp"

/** iOS's kinds: impacts (light: a menu, a swipe past its mark, a tick; medium: picked up, put down, a row's action done),
 *  `selection` (an item passing another, a choice ticked), notifications (success, warning, error). */
export type Haptic = "light" | "medium" | "heavy" | "soft" | "rigid" | "selection" | "success" | "warning" | "error"

/** A finger is the pointer (phones, tablets): no hover, so what shows on hover is swiped or held for instead. */
export const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches
let native: boolean | null = phoneApp ? null : false
const BUZZ: Partial<Record<Haptic, number | number[]>> = { selection: 5, medium: 14, heavy: 20, rigid: 12, success: [10, 60, 14], warning: [14, 80, 14], error: [14, 50, 14, 50, 14] }

/** The only haptic a web page gets on iOS: a hidden `<input switch>` flipped while handling a touch. */
function flip() {
  const label = document.createElement("label")
  label.ariaHidden = "true"
  label.style.display = "none"
  const input = document.createElement("input")
  input.type = "checkbox"
  input.setAttribute("switch", "")
  label.append(input)
  document.head.append(label)
  label.click()
  label.remove()
}

export function haptic(weight: Haptic = "light") {
  if (!coarse) return
  if (native !== false && phoneApp) {
    phoneApp.haptic({ weight }).then(() => { native = true }, () => { native = false; flip() })
    return
  }
  if ("vibrate" in navigator) navigator.vibrate(BUZZ[weight] ?? 8)
  else flip()
}

export function sortHaptics() {
  let last: unknown = null
  return {
    onDragStart: ({ active }: { active: { id: unknown } }) => { last = active.id; haptic("medium") },
    onDragOver: ({ over }: { over: { id: unknown } | null }) => {
      if (over && over.id !== last) haptic("selection")
      if (over) last = over.id
    },
    onDragEnd: () => haptic("medium"),
  }
}
