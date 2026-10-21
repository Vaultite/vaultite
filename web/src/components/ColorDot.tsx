// A colour of the shared palette (core/colors.ts) as a menu row's icon, and the Colour submenu's rows.
import { forwardRef } from "react"
import type { LucideIcon, LucideProps } from "lucide-react"
import { COLOR_NAMES, COLORS, colorVar, type Color } from "../../../core/colors.ts"
import type { MenuItem } from "@/components/ContextMenu"
import { cn } from "@/lib/utils"

const dots = new Map<string, LucideIcon>()
/** A colour's dot (a CSS colour), as a menu row's icon. */
export function dotIcon(color: string): LucideIcon {
  let c = dots.get(color)
  if (!c) {
    c = forwardRef<SVGSVGElement, LucideProps>(({ className }, _ref) => (
      <span className={cn(className, "grid place-items-center")}><span className="size-2.5 rounded-full" style={{ background: color }} /></span>
    )) as unknown as LucideIcon
    dots.set(color, c)
  }
  return c
}

/** The palette as menu rows, `current` checked. */
export const colorItems = (current: string, pick: (c: Color) => void): MenuItem[] =>
  COLORS.map((c) => ({ label: COLOR_NAMES[c], icon: dotIcon(colorVar(c)), checked: c === current, run: () => pick(c) }))
