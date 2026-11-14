import { useEffect, type ComponentProps } from "react"
import { whenIdle } from "@/lib/utils"
import { signal } from "@/core/signal"
import { trackSoon } from "@/core/unsaved"
import type * as Drawn from "@/components/HoverCardDrawn"

let drawn: typeof Drawn | null = null, loading: Promise<void> | null = null
const loaded = signal()
const load = () => (loading ??= import("@/components/HoverCardDrawn").then((m) => { drawn = m; loaded.notify() }))
trackSoon("a hover card's code", () => !!loading && !drawn)
if (typeof window !== "undefined" && matchMedia("(any-hover: hover)").matches) whenIdle(() => void load())

function useDrawn() {
  useEffect(() => { void load() }, [])
  return loaded.use(() => drawn)
}

export function HoverCard(p: ComponentProps<typeof Drawn.HoverCard>) {
  const m = useDrawn()
  return m && <m.HoverCard {...p} />
}

export function Captioned(p: ComponentProps<typeof Drawn.Captioned>) {
  const m = useDrawn()
  return m && <m.Captioned {...p} />
}
