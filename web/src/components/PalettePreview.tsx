import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { trackSoon } from "@/core/unsaved"

export const PREVIEW_WIDTH = 340
const PALETTE = 680, GAP = 12, EDGE = 12
const ROOM = `(hover: hover) and (pointer: fine) and (min-width: ${PALETTE + 2 * (GAP + PREVIEW_WIDTH + EDGE)}px)`
const REST = 350, SETTLE = 200

function useRoom(wanted: boolean) {
  const [room, setRoom] = useState(() => wanted && matchMedia(ROOM).matches)
  useEffect(() => {
    if (!wanted) return
    const m = matchMedia(ROOM)
    const fit = () => setRoom(m.matches)
    fit()
    m.addEventListener("change", fit)
    return () => m.removeEventListener("change", fit)
  }, [wanted])
  return wanted && room
}

type Shown = { node: ReactNode; cold: boolean }

export function usePalettePreview<T extends { id: string }>(preview: ((item: T) => ReactNode | null) | undefined, selected: T | null, query: string): ReactNode {
  const room = useRoom(!!preview)
  const [shown, setShown] = useState<Shown | null>(null)
  const draw = useRef(preview)
  useLayoutEffect(() => { draw.current = preview })
  const last = useRef({ query, warm: false, shown: false })
  useEffect(() => {
    if (!room) return
    const typed = last.current.query !== query
    last.current.query = query
    const show = () => {
      const node = selected ? draw.current?.(selected) ?? null : null
      setShown(node ? { node, cold: !last.current.shown } : null)
      last.current.shown = !!node
      if (node) last.current.warm = true
    }
    const wait = !last.current.warm ? REST : typed || !selected ? SETTLE : 0
    if (!wait) { show(); return }
    const off = trackSoon("the palette's preview", () => true)
    const t = setTimeout(() => { off(); show() }, wait)
    return () => { off(); clearTimeout(t) }
  }, [room, selected?.id, query]) // eslint-disable-line react-hooks/exhaustive-deps -- follows the selected row by id
  if (!room || !shown) return null
  return (
    <div data-palette-preview data-cold={shown.cold || undefined} inert className="pointer-events-none absolute top-0 left-full"
      style={{ width: PREVIEW_WIDTH, marginLeft: GAP }}>
      {shown.node}
    </div>
  )
}
