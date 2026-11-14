import { useEffect } from "react"
import { onMarkdownDrawn } from "@vaultite"

let drawing: Promise<typeof import("./drawn.ts")> | null = null

export function DrawnCitations() {
  useEffect(() => onMarkdownDrawn((el) => { void (drawing ??= import("./drawn.ts")).then((m) => m.drawCitations(el)) }), [])
  return null
}
