import { devicePref } from "@/core/prefs"
import { trackSoon } from "@/core/unsaved"

const MOST = 200, SETTLED_MS = 400
const zooms = devicePref<Record<string, number>>("zooms", {})
const moving = new Map<string, number>()
let timer = 0

export const keptZoom = (path: string) => moving.get(path) ?? zooms.get()[path] ?? 1

function settle() {
  timer = 0
  const others = Object.entries(zooms.get()).filter(([p]) => !moving.has(p))
  zooms.set(Object.fromEntries([...others, ...[...moving].filter(([, z]) => z !== 1)].slice(-MOST)))
  moving.clear()
}

export function keepZoom(path: string, zoom: number) {
  moving.set(path, zoom)
  clearTimeout(timer)
  timer = window.setTimeout(settle, SETTLED_MS)
}
trackSoon("a file's zoom kept", () => timer > 0, true)
