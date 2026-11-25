import { useEffect, useState } from "react"

type DiffViewType = typeof import("./DiffView").DiffView

export function DiffTab({ id }: { id: string }) {
  const [View, setView] = useState<DiffViewType | null>(null)
  const [failed, setFailed] = useState<{ error: unknown } | null>(null)
  useEffect(() => { void import("./DiffView").then((m) => setView(() => m.DiffView), (error) => setFailed({ error })) }, [])
  if (failed) throw failed.error
  return View ? <View id={id} /> : null
}
