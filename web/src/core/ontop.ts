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
export function keepOnTop(on: boolean) {
  state.set(on)
  const ids = new Set(getWorkspace().windows?.map((w) => w.id))
  const kept = read().filter((id) => id !== me && (popoutId() || id === "main" || ids.has(id)))
  try { localStorage.setItem(KEY, JSON.stringify(on ? [...kept, me] : kept)) } catch { /* private mode */ }
  void desktop?.onTop?.(on).catch(() => {})
}
if (state.get()) void desktop?.onTop?.(true).catch(() => {})
