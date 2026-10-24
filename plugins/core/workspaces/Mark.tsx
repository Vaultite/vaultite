// A workspace's mark: its icon in its tint, else its number in a box. Kept apart so state.ts's menus can use it.
import { forwardRef } from "react"
import type { LucideIcon, LucideProps } from "lucide-react"
import { cn, colorVar, namedIcon, type WorkspaceInfo } from "@vaultite"

type Look = Pick<WorkspaceInfo, "icon" | "tint">

/** Workspace n's mark. `look`: the box's own classes for the number (the switcher's, a row's). */
export function Mark({ n, icon, tint, look, size = "size-[18px]", glyph = "size-[15px]" }: Look & { n: number; look: string; size?: string; glyph?: string }) {
  const Icon = icon ? namedIcon(icon) : null
  const c = tint ? colorVar(tint) : undefined
  if (Icon) return <span data-workspace-icon={icon} className={cn("grid shrink-0 place-items-center", size)}><Icon className={glyph} strokeWidth={2} style={c ? { color: c } : undefined} /></span>
  return <span className={cn("grid shrink-0 place-items-center rounded-[4px] text-[11px] leading-none tabular-nums", size, look)} style={c ? { color: c, borderColor: c } : undefined}>{n}</span>
}

const icons = new Map<string, LucideIcon>()
/** Workspace n's mark as a menu row's icon (the phone's workspace menu). */
export function markIcon(n: number, { icon, tint }: Look): LucideIcon {
  const key = `${n} ${icon ?? ""} ${tint ?? ""}`
  let c = icons.get(key)
  if (!c) {
    c = forwardRef<SVGSVGElement, LucideProps>(({ className }, _ref) => (
      <span className={cn(className, "grid place-items-center")}><Mark n={n} icon={icon} tint={tint} look="border border-current font-medium text-[13px] md:text-[11px]" size="size-full" glyph="size-full" /></span>
    )) as unknown as LucideIcon
    icons.set(key, c)
  }
  return c
}
