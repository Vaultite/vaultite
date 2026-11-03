// An agent's page live in this window: its frames as the desktop app sends them while the window watches it
// (electron/browser/live.ts), for the agents' corner card and a tab watching an agent's page.
import { useEffect, useRef, useState } from "react"
import { webPages } from "@vaultite"

const engine = (name: string, ...args: unknown[]) => Promise.resolve(webPages?.engine?.(name, ...args))

/** Whether this window is on screen: what's live stops while it isn't. */
export function useShown() {
  const [on, setOn] = useState(!document.hidden)
  useEffect(() => {
    const f = () => setOn(!document.hidden)
    document.addEventListener("visibilitychange", f)
    return () => document.removeEventListener("visibilitychange", f)
  }, [])
  return on
}

/** Page `id` live: its frames as the desktop app sends them while this window watches it (renewed: a window gone stops
 *  it). */
export function useFrame(id: number, on = true) {
  const [frame, setFrame] = useState<string | null>(null)
  const shown = useShown() && on
  const last = useRef(0)
  // (its own watch: another view of the page in this window going, the corner card as its tab opens, leaves this one)
  const [key] = useState(() => Math.random().toString(36).slice(2, 10))
  useEffect(() => {
    if (!shown) return
    let stop = false
    const watch = () => void engine("agents:watch", id, key).then((r) => {
      const f = (r as { frame?: string } | undefined)?.frame
      if (!stop && f && !last.current) setFrame(`data:image/jpeg;base64,${f}`)
    }, () => {})
    watch()
    const renew = setInterval(watch, 10_000)
    const off = webPages?.on((m) => {
      if (m.type !== "engine:live:frame" || m.tab !== id || typeof m.jpeg !== "string") return
      last.current = Date.now()
      setFrame(`data:image/jpeg;base64,${m.jpeg}`)
    })
    return () => { stop = true; last.current = 0; clearInterval(renew); off?.(); void engine("agents:unwatch", id, key).catch(() => {}) }
  }, [id, shown, key])
  return frame
}
