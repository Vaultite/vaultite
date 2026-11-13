import type { DesktopApi } from "@/core/desktop"
import type { CapacitorGlobal } from "@/core/phoneapp"
import type { Share } from "@/core/share"
import type { TraceEvent } from "@/core/trace"
import type { IslandBridge } from "./screenisland"
import type { ScreenBridge } from "./screen"

declare global {
  interface Window {
    vaultite?: DesktopApi
    vaultiteScreen?: ScreenBridge & { island?: IslandBridge }
    __vauEarly?: Record<string, Promise<Response>>
    __vauEarlyChunks?: Promise<void>
    __vauStarted?: boolean
    showBootError?: (error: unknown, title?: string, opts?: { fresh?: boolean; again?: boolean }) => void
    queryLocalFonts?: () => Promise<{ family: string }[]>
  }
  interface Navigator { standalone?: boolean }
  // A clone has its original's interface (the DOM's cloning steps); TypeScript's DOM types say only Node.
  interface Node { cloneNode(subtree?: boolean): this }
  var Capacitor: CapacitorGlobal | undefined
  var vaultiteShare: Share | undefined
  var __vauTrace: Record<string, TraceEvent[]> | undefined
  var __vauLoadShifts: (() => unknown) | undefined
}
