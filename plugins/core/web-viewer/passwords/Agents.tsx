import { useEffect, useMemo, useState } from "react"
import { Bot } from "lucide-react"
import { Empty, fmtAgo } from "@vaultite"
import { approvedText, fetchUses, openEntry } from "./store"
import type { Row, Use } from "./types"

export function useUses() {
  const [uses, setUses] = useState<Use[] | null | undefined>(undefined)
  useEffect(() => { let stop = false; void fetchUses().then((u) => { if (!stop) setUses(u) }); return () => { stop = true } }, [])
  return uses
}

export function UseRow({ u, entry }: { u: Use; entry?: Row }) {
  const title = entry?.title || u.entry.title || "An entry"
  return (
    <div className="flex min-h-12 items-center gap-3 py-1.5" data-passwords-use={u.agent}>
      <span className="grid size-8 shrink-0 place-items-center rounded-control bg-foreground/[0.05] text-muted-foreground"><Bot className="size-[18px]" strokeWidth={1.75} /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] leading-[20px] md:text-[14px]">
          {entry ? <button type="button" className="cursor-pointer hover:underline" onClick={() => openEntry(entry.id)}>{title}</button> : title}
          {u.entry.username && <span className="text-muted-foreground"> · {u.entry.username}</span>}
        </div>
        <div className="truncate text-[13px] text-muted-foreground md:text-[12px]">{[u.agent, u.site, fmtAgo(u.t), approvedText(u)].filter(Boolean).join(" · ")}</div>
      </div>
    </div>
  )
}

export function AgentLogins({ uses, entries, q }: { uses: Use[]; entries: Row[]; q: string }) {
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries])
  const entryOf = (u: Use) => (u.entry.id ? byId.get(u.entry.id) : entries.find((e) => e.title === u.entry.title && e.username === u.entry.username))
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = uses.filter((u) => words.every((w) => [u.agent, u.site, u.entry.title, u.entry.username, u.task ?? ""].join(" ").toLowerCase().includes(w)))
  if (!shown.length) return <div className="px-1 pt-6"><Empty>{q.trim() ? `No agent login matches "${q.trim()}".` : "No agent has logged in with your passwords yet."}</Empty></div>
  return <div className="flex flex-col" data-passwords-uses>{shown.map((u, i) => <UseRow key={`${u.t}-${i}`} u={u} entry={entryOf(u)} />)}</div>
}
