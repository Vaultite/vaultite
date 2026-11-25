import { useEffect, useMemo, useState, type MouseEvent } from "react"
import { Cloud, MessageCircle, SquareTerminal, type LucideIcon } from "lucide-react"
import { isViewOpen, openView, useMachines, type AgentRun } from "@vaultite"

export const KINDS: { kind: AgentRun["kind"]; icon: LucideIcon; label: string; one: string }[] = [
  { kind: "terminal", icon: SquareTerminal, label: "Terminals", one: "In a terminal" },
  { kind: "chat", icon: MessageCircle, label: "Chats", one: "In a chat" },
  { kind: "cloud", icon: Cloud, label: "Cloud", one: "In the cloud" },
]
export const kindOf = (k: AgentRun["kind"]) => KINDS.find((x) => x.kind === k) ?? KINDS[0]

export function useWhere() {
  const machines = useMachines()
  return useMemo(() => {
    const self = machines?.find((m) => m.self)?.label
    const several = (machines?.length ?? 0) > 1
    return (r: AgentRun) => r.where && !r.machine ? r.where : several ? (r.machine ? machines?.find((m) => m.id === r.machine)?.label ?? r.where ?? r.machine : self) : r.where
  }, [machines])
}

export function openRun(r: AgentRun, e: Pick<MouseEvent, "metaKey" | "ctrlKey" | "button">) {
  const newTab = e.metaKey || e.ctrlKey || e.button === 1
  if (r.to) openView(r.to, { newTab: newTab || !isViewOpen(r.to), stage: !newTab })
  else r.open?.(newTab)
}

export function useNow(on = true, every = 60_000) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => { if (!document.hidden) setNow(Date.now()) }, every)
    return () => clearInterval(id)
  }, [on, every])
  return now
}
