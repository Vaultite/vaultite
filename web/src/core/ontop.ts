// Keep window on top (the desktop app's, a window at a time: the main one, a pop-out), as a video call's pop-out: over
// other apps' windows and on every Space (electron/ontop.ts). Kept on this device by window, a pop-out by its id.
import { cell } from "@/core/signal"
import { desktop } from "@/core/desktop"
import { getWorkspace, popoutId } from "@/core/workspace"

const KEY = "vaultite.onTop"
const me = popoutId() ?? "main"
const read = (): string[] => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v : [] } catch { return [] } }
const state = cell(read().includes(me))

export const canKeepOnTop = !!desktop?.onTop
export const onTop = state.get
export const useOnTop = () => state.use()
/** This window kept on top, or not. */
export function keepOnTop(on: boolean) {
  state.set(on)
  // (the windows kept on top: this one's changed; the main window's drops pop-outs no longer there)
  const ids = new Set(getWorkspace().windows?.map((w) => w.id))
  const kept = read().filter((id) => id !== me && (popoutId() || id === "main" || ids.has(id)))
  try { localStorage.setItem(KEY, JSON.stringify(on ? [...kept, me] : kept)) } catch { /* private mode */ }
  void desktop?.onTop?.(on).catch(() => {})
}
// (as it opens: as it was)
if (state.get()) void desktop?.onTop?.(true).catch(() => {})
