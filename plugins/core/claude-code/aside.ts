import { useEffect, useState } from "react"
import { isViewOpen, notifyError, op, openAside, shownAside, useTabList } from "@vaultite"

export type ThreadInfo = { id: string; git: boolean; repo?: string; dir?: string; cwd?: string; branch?: string; worktree?: boolean; turns?: number[] }

export const diffTo = (id: string) => `view:diff/${id}`
const shells = new Map<string, string>()
const shellTo = (id: string) => { const t = shells.get(id); return t ? `view:terminal/${t}` : "" }
const kin = (id: string) => (to: string) => to === diffTo(id) || (!!shellTo(id) && to === shellTo(id))

export const showDiff = (id: string, from: string) => openAside(diffTo(id), from, kin(id))

export async function showShell(id: string, from: string, t: ThreadInfo) {
  try {
    if (!shells.has(id) || !isViewOpen(shellTo(id))) {
      const r = await op<{ id: string }>("terminal.start", { cwd: t.cwd || t.dir || undefined, name: `${t.branch || "Thread"} shell`.slice(0, 80) })
      shells.set(id, r.id)
    }
    openAside(shellTo(id), from, kin(id))
  } catch (e) { notifyError(e, "Couldn't open a shell") }
}

export function useAside(id: string, from: string) {
  useTabList()
  return { diff: !!from && shownAside(diffTo(id), from), shell: !!from && !!shellTo(id) && shownAside(shellTo(id), from) }
}

const known = new Map<string, ThreadInfo>()
export const threadKnown = (id: string) => known.get(id) ?? null

export function useThread(id: string, turn: string): ThreadInfo | null {
  const [t, setT] = useState<ThreadInfo | null>(() => known.get(id) ?? null)
  useEffect(() => {
    if (!id) return
    let on = true
    void op<ThreadInfo>("claude-code.chat-thread", { id }).then((r) => { known.set(id, r); if (on) setT(r) }, () => {})
    return () => { on = false }
  }, [id, turn])
  return t
}
