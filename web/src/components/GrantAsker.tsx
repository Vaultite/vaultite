// A plugin's write that wanted a grant the user was never asked about ("ask": core/grants.ts): asked now, once.
import { useEffect } from "react"
import type { Store } from "@/core/data"
import { askGrant, waitingGrants } from "@/core/grants"

export function GrantAsker({ store }: { store: Store }) {
  const waiting = waitingGrants(store).join(",")
  useEffect(() => {
    // (one at a time: the dialog shows one question)
    void (async () => { for (const id of waiting ? waiting.split(",") : []) await askGrant(id) })()
  }, [waiting])
  return null
}
