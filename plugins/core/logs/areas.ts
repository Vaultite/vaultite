// Icon and colour of an area, shared by cards and detail sheets: its `icon` (a lucide name, like a dashboard's) and
// `tint` (a colour's name) from the areas setting, or from the plugin that brings the area (plugin.ts: `log-areas`).
import { Circle } from "lucide-react"
import { namedIcon } from "@vaultite"
import type { Area } from "./types"

export const areaStyle = (area?: Pick<Area, "icon" | "tint"> | null) => ({
  icon: namedIcon(area?.icon) ?? Circle,
  tint: area?.tint && /^[a-z][a-z-]*$/.test(area.tint) ? `var(--${area.tint})` : "var(--primary)",
})
