import { useEffect, useRef, useState } from "react"
import { webPages } from "@vaultite"
import { engine } from "./engine"


export function useShown() {
  const [on, setOn] = useState(!document.hidden)
  useEffect(() => {
    const f = () => setOn(!document.hidden)
    document.addEventListener("visibilitychange", f)
    return () => document.removeEventListener("visibilitychange", f)
  }, [])
  return on
}

export function useFrame(id: number, on = true) {
  const [frame, setFrame] = useState<string | null>(null)
  const shown = useShown() && on
  const last = useRef(0)
  const [key] = useState(() => Math.random().toString(36).slice(2, 10))
  useEffect(() => {
    if (!shown) return
    let stop = false
    const watch = () => void engine("agents:watch", id, key).then((r) => {
      const f = r?.frame
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
