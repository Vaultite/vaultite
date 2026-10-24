// Where the vault's name goes (the sidebar's foot, a phone's drawer), a guest sees the folder shared with them and what
// they may do in it, as shared documents say it (Can view, Can comment, Can edit).
import { Users } from "lucide-react"
import { dateText } from "@/core/data"
import { share } from "@/core/share"
import { cn } from "@/lib/utils"

const CAN = { read: "Can view", comment: "Can comment", edit: "Can edit" }
const DAY = { day: "numeric", month: "short" } as const

export function SharedWith({ phone }: { phone?: boolean }) {
  if (!share) return null
  return (
    <div data-shared-with="" data-tip={`Shared with ${share.guest} until ${dateText(new Date(share.expires), DAY)}`} data-tip-side="top"
      className={cn("flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap", phone ? "h-11 text-[15px]" : "h-7 px-1.5 text-[13px]")}>
      <Users className={cn("shrink-0 text-tertiary", phone ? "size-[18px]" : "size-4")} strokeWidth={2} />
      <span className="min-w-0 truncate font-medium">{share.folder}</span>
      <span className="ml-auto shrink-0 text-muted-foreground">{CAN[share.role]}</span>
    </div>
  )
}
