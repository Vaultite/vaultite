import type { RefObject } from "react"
import type { Map as MLMap } from "maplibre-gl"
import { useZoomTarget } from "@/core/zoom"

export function useMapZoom(box: RefObject<HTMLElement | null>, map: RefObject<MLMap | null>, fit: () => void) {
  useZoomTarget(box, (step) => { if (step > 0) map.current?.zoomIn({ duration: 250 }); else if (step) map.current?.zoomOut({ duration: 250 }); else fit(); return null }, { fit, keyboardIn: true })
}
