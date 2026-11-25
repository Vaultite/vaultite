import { useEffect, useState } from "react"
import { call } from "./store"

const SOON_MS = 50
export function useBits(text: string): number | null {
  const [bits, setBits] = useState<number | null>(null)
  useEffect(() => {
    let stop = false
    const t = setTimeout(() => { if (text) call("strength", text).then((n) => { if (!stop) setBits(n) }, () => {}) }, SOON_MS)
    return () => { stop = true; clearTimeout(t) }
  }, [text])
  return text ? bits : null
}
