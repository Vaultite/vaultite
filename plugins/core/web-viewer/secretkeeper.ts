import { useEffect } from "react"
import { setSecretKeeper, webPages } from "@vaultite"

type Row = { id: string; title: string; username: string; group: string }
type Status = { locked: boolean; touchId: boolean; error?: string } | null
const engine = <T,>(name: string, ...args: unknown[]) => Promise.resolve(webPages?.engine?.(name, ...args)) as Promise<T>

async function entries() {
  const st = await engine<Status>("passwords:status")
  if (!st || st.error) return null
  if (st.locked) {
    if (!st.touchId) return null
    const r = await engine<{ ok?: boolean }>("passwords:unlock")
    if (!r?.ok) return null
  }
  const { groups, entries } = await engine<{ groups: { id: string; bin: boolean }[]; entries: Row[] }>("passwords:list")
  const bin = new Set(groups.filter((g) => g.bin).map((g) => g.id))
  return entries.filter((e) => !bin.has(e.group)).map(({ id, title, username }) => ({ id, title, username }))
}

export function useSecretKeeper() {
  useEffect(() => {
    if (!webPages?.engine) return
    let on = true
    const check = () => void engine<Status>("passwords:status").then((st) => {
      if (!on) return
      setSecretKeeper(st && !st.error ? {
        entries,
        value: (id) => engine<string>("passwords:give", id),
        keep: (title, value) => engine("passwords:keep-secret", title, value).then(() => {}),
      } : null)
    }, () => {})
    check()
    const off = webPages.on((m) => { if (m.type === "engine:passwords:changed") check() })
    return () => { on = false; off?.(); setSecretKeeper(null) }
  }, [])
}
