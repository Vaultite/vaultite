import type { IconType } from "@/core/icons"
import { COLOR_NAMES, COLORS, colorVar, type Color } from "../../../core/colors.ts"
import type { MenuItem } from "@/components/ContextMenu"
import { cn } from "@/lib/utils"

const dots = new Map<string, IconType>()
/** A colour's dot (a CSS colour), as a menu row's icon. */
export function dotIcon(color: string): IconType {
  let c = dots.get(color)
  if (!c) {
    c = ({ className }) => (
      <span className={cn(className, "grid place-items-center")}><span className="size-2.5 rounded-full" style={{ background: color }} /></span>
    )
    dots.set(color, c)
  }
  return c
}

/** The palette as menu rows, `current` checked. */
export const colorItems = (current: string, pick: (c: Color) => void): MenuItem[] =>
  COLORS.map((c) => ({ label: COLOR_NAMES[c], icon: dotIcon(colorVar(c)), checked: c === current, run: () => pick(c) }))
