import { Globe, MessageSquareText, X } from "lucide-react"
import { dropChip, useChips, type ContextChip } from "./chips"

function pageLabel(url: string, title: string) {
  if (title.trim()) return title.trim()
  try { const u = new URL(url); return `${u.host}${u.pathname === "/" ? "" : u.pathname}` } catch { return url }
}

function chipMeta(c: ContextChip) {
  if (c.kind === "page") return { icon: Globe, label: pageLabel(c.url, c.title), tip: c.comment?.trim() || c.url, remove: `Remove ${c.url}` }
  return { icon: MessageSquareText, label: `${c.path.split("/").at(-1)}:${c.line}`, tip: c.comment, remove: `Remove the comment on ${c.path}:${c.line}` }
}

export function ContextChips({ chat }: { chat: string }) {
  const cs = useChips(chat)
  if (!cs.length) return null
  return (
    <div data-context-chips className="flex flex-wrap gap-1.5 px-3 pt-3">
      {cs.map((c) => {
        const m = chipMeta(c), Icon = m.icon
        return (
          <span key={c.key} data-context-chip={c.kind ?? "line"} data-tip={m.tip}
            className="flex h-6 max-w-[260px] items-center gap-1 rounded-chip bg-foreground/[0.06] pr-0.5 pl-2 text-[12px] max-md:h-8 max-md:text-[14px]">
            <Icon className="size-3 shrink-0 text-muted-foreground" strokeWidth={2} />
            <span className="truncate">{m.label}</span>
            <button type="button" aria-label={m.remove} onClick={() => dropChip(chat, c.key)}
              className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground">
              <X className="size-3" strokeWidth={2.5} />
            </button>
          </span>
        )
      })}
    </div>
  )
}
