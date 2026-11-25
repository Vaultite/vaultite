import { useEffect, useState } from "react"
import { getTabLayout, isViewOpen, notifyError, op, openAside, panesOf, shownAside, shownAsideMatch, shownTab, useTabList } from "@vaultite"
import { isWebView, previewOf, rememberPreview } from "./preview"

export type ThreadInfo = { id: string; git: boolean; repo?: string; dir?: string; cwd?: string; branch?: string; worktree?: boolean; turns?: number[] }

export const diffTo = (id: string) => `view:diff/${id}`
const shells = new Map<string, string>()
const shellTo = (id: string) => { const t = shells.get(id); return t ? `view:terminal/${t}` : "" }
const previewTo = (id: string, url?: string) => { const u = url || previewOf(id); return u ? `view:web/${u}` : "view:web" }
const kin = (id: string) => (to: string) => to === diffTo(id) || isWebView(to) || (!!shellTo(id) && to === shellTo(id))

export const showDiff = (id: string, from: string) => openAside(diffTo(id), from, kin(id))

export function showPreview(id: string, from: string, url?: string) {
  if (url) rememberPreview(id, url)
  openAside(previewTo(id, url), from, kin(id), isWebView)
}

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
  return {
    diff: !!from && shownAside(diffTo(id), from),
    preview: !!from && shownAsideMatch(isWebView, from),
    shell: !!from && !!shellTo(id) && shownAside(shellTo(id), from),
  }
}

export function activeChatInTab(): string {
  const tab = shownTab(getTabLayout())
  if (!tab) return ""
  const found = panesOf(tab).find((p) => p.to.startsWith("view:claude-session/") && p.to !== "view:claude-session/new")
  return found ? found.to.slice(20) : ""
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
