import { Circle } from "lucide-react"
import { namedIcon } from "@vaultite"
import type { Area } from "./types"

export const areaStyle = (area?: Pick<Area, "icon" | "tint"> | null) => ({
  icon: namedIcon(area?.icon) ?? Circle,
  tint: area?.tint && /^[a-z][a-z-]*$/.test(area.tint) ? `var(--${area.tint})` : "var(--primary)",
})
