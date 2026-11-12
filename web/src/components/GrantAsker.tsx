import { useEffect } from "react"
import type { Store } from "@/core/data"
import { askGrant, waitingGrants } from "@/core/grants"

export function GrantAsker({ store }: { store: Store }) {
  const waiting = waitingGrants(store).join(",")
  useEffect(() => {
    void (async () => { for (const id of waiting ? waiting.split(",") : []) await askGrant(id) })()
  }, [waiting])
  return null
}
