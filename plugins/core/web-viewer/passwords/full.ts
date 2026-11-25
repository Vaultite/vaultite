import { useEffect, useState } from "react"
import { call, lockedNow } from "./store"
import type { Full, Row } from "./types"

const REST_MS = 60
export function useFull(row: Row | undefined): Full | null | undefined {
  const [full, setFull] = useState<Full | null | undefined>(undefined)
  const id = row?.id
  useEffect(() => {
    if (!id) return
    let stop = false
    const t = setTimeout(() => call("get", id).then((f) => { if (!stop) setFull(f) }, (e) => { if (!stop && !lockedNow(e)) setFull(null) }), REST_MS)
    return () => { stop = true; clearTimeout(t) }
  }, [id, row])
  return full && full.id !== id ? undefined : full
}
