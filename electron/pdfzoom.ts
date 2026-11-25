import type { WebContents } from "electron"
import { isNumber } from "../core/values.ts"

const step = (run: string) => `(() => {
  const v = document.querySelector("pdf-viewer")?.viewport
  if (!v) return null
  v.${run}
  return v.getZoom()
})()`
const STEPS = { "-1": step("zoomOut()"), 0: step("setZoom(1)"), 1: step("zoomIn()") }

export async function zoomPdf(page: WebContents, src: string, to: -1 | 0 | 1) {
  const frame = page.mainFrame.framesInSubtree.find((f) => f.parent === page.mainFrame && f.url === src)
  const chromiumViewer = frame?.framesInSubtree.find((f) => f.url.startsWith("chrome-extension://"))
  const zoom = await chromiumViewer?.executeJavaScript(STEPS[to])
  return isNumber(zoom) ? zoom : null
}
