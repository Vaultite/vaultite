// The keyboard's way through a replay of an agent's run: the commands (index.tsx: ← →, Home, End, Space) act on the
// replay that has the keyboard, which each Replay says by its element while it's drawn.
import { activePane, typingIn } from "@vaultite"

export type ReplayKeys = { step: (by: number) => void; edge: (last: boolean) => void; play: () => void; playing: () => boolean }
export const replays = new WeakMap<HTMLElement, () => ReplayKeys>()

/** The replay with the keyboard (not in a field, a menu or a dialog), or, with nothing focused in a page, the focused
 *  pane's; none while hidden (a kept tab). */
export function focusedReplay(): ReplayKeys | null {
  const a = document.activeElement
  let el: HTMLElement | null = null
  if (a instanceof HTMLElement && a !== document.body) {
    if (typingIn(a) || a.closest("[role=menu], [role=dialog], dialog")) return null
    el = a.closest<HTMLElement>("[data-web-replay-steps]") ?? a.querySelector<HTMLElement>("[data-web-replay-steps]")
  } else {
    const pane = activePane()
    el = pane ? document.querySelector<HTMLElement>(`[data-pane="${CSS.escape(pane.id)}"] [data-web-replay-steps]`) : null
  }
  if (!el || !el.getClientRects().length) return null
  return replays.get(el)?.() ?? null
}
