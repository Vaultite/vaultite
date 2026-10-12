// The mark beside a plugin Vaultite makes (built in, or one of Vaultite's in the directory): the trust signal at a
// glance, in place of stars and bylines.
import { BadgeCheck } from "lucide-react"
import { cn } from "@/lib/utils"

export function Certified({ className }: { className?: string }) {
  return (
    <span className={cn("inline-grid shrink-0 place-items-center align-[-2px] text-primary", className)} data-tip="Made by Vaultite" data-certified>
      <BadgeCheck className="size-[15px] fill-current stroke-background" strokeWidth={2.25} aria-label="Made by Vaultite" />
    </span>
  )
}
