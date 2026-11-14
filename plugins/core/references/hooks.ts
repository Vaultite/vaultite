import { useEffect, useState } from "react"
import { settings } from "./client.ts"

export function useLibraryVersion(): string {
  const [focus, setFocus] = useState(0)
  useEffect(() => {
    const on = () => setFocus((n) => n + 1)
    addEventListener("focus", on)
    return () => removeEventListener("focus", on)
  }, [])
  return `${focus}:${JSON.stringify(settings.use())}`
}
