// A map's buttons
// (fit everyone, where you are, zoom). Only MapLibre's types are imported, so this stays out of the map's chunk.
import type { RefObject } from "react"
import type { Map as MLMap } from "maplibre-gl"
import { Minus, Plus, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export type MapButton = { label: string; icon: LucideIcon; run: () => void }

const btn = "grid size-11 cursor-pointer place-items-center text-primary hover:bg-foreground/[0.06] active:bg-foreground/10"

function Group({ buttons }: { buttons: MapButton[] }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-[10px] glass-strong">
      {buttons.map((b, i) => (
        <button key={b.label} type="button" aria-label={b.label} data-tip={b.label} onClick={b.run} className={cn(btn, i > 0 && "border-t-[0.5px] border-border")}>
          <b.icon className="size-[18px]" strokeWidth={2.25} />
        </button>
      ))}
    </div>
  )
}

export function MapControls({ map, extra = [] }: { map: RefObject<MLMap | null>; extra?: MapButton[] }) {
  return (
    <div className="absolute top-3 right-3 z-10 flex flex-col gap-2">
      {extra.length > 0 && <Group buttons={extra} />}
      <Group buttons={[
        { label: "Zoom in", icon: Plus, run: () => map.current?.zoomIn({ duration: 250 }) },
        { label: "Zoom out", icon: Minus, run: () => map.current?.zoomOut({ duration: 250 }) },
      ]} />
    </div>
  )
}
