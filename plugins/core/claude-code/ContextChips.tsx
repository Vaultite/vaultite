import { MessageSquareText, X } from "lucide-react"
import { dropChip, useChips } from "./chips"

export function ContextChips({ chat }: { chat: string }) {
  const cs = useChips(chat)
  if (!cs.length) return null
  return (
    <div data-context-chips className="flex flex-wrap gap-1.5 px-3 pt-3">
      {cs.map((c) => (
        <span key={c.key} data-context-chip data-tip={c.comment}
          className="flex h-6 max-w-[260px] items-center gap-1 rounded-chip bg-foreground/[0.06] pr-0.5 pl-2 text-[12px] max-md:h-8 max-md:text-[14px]">
          <MessageSquareText className="size-3 shrink-0 text-muted-foreground" strokeWidth={2} />
          <span className="truncate">{c.path.split("/").at(-1)}:{c.line}</span>
          <button type="button" aria-label={`Remove the comment on ${c.path}:${c.line}`} onClick={() => dropChip(chat, c.key)}
            className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground">
            <X className="size-3" strokeWidth={2.5} />
          </button>
        </span>
      ))}
    </div>
  )
}
