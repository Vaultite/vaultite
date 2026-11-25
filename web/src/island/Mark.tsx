import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { type Presence, restCounts } from "../../../core/desktop/knocks"

function Dot({ kind, n }: { kind: "needs" | "working"; n: number }) {
  return <span className={cn("island-dot", kind === "needs" ? "island-dot-needs" : "island-dot-working")} data-island-dot={kind} aria-hidden>{n > 99 ? "99+" : n}</span>
}

export function Mark({ presences }: { presences: Presence[] }) {
  const { needs, working } = restCounts(presences)
  const was = useRef(needs), [nudge, setNudge] = useState(0)
  useEffect(() => {
    if (needs > was.current) setNudge((x) => x + 1)
    was.current = needs
  }, [needs])
  if (!needs && !working) return null
  const one = presences.filter((p) => p.state === "needs you" && (p.terminal || p.chat)).sort((a, b) => b.since - a.since)[0]
  const label = [needs && `${needs} need${needs === 1 ? "s" : ""} you`, working && `${working} working`].filter(Boolean).join(", ")
  return (
    <span key={nudge} role="img" className={cn("flex items-center gap-[3px]", nudge > 0 && "island-nudge")} data-island-mark={needs ? "needs you" : "working"} data-count={needs || working} aria-label={label}
      {...(one ? { "data-island-at": one.id } : {})}>
      {needs > 0 && <Dot kind="needs" n={needs} />}
      {working > 0 && <Dot kind="working" n={working} />}
    </span>
  )
}
