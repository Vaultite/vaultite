import type { Knock, Presence } from "../../../core/desktop/knocks"
import type { WalkScene } from "../../../core/desktop/walks"

export type Spot = { x: number; y: number; bar: number; align: "left" | "centre"; attached: boolean; room?: number }
export type Companion = { name: string; tint: string; doing: string }
export type IslandData = { presences: Presence[]; knock: (Knock & { tint: string; left: number }) | null; walk: WalkScene | null; companion?: Companion | null
  answering?: Record<string, "approve" | "deny">; spot: Spot; left: number; width: number }
export type IslandAct = "open" | "approve" | "deny" | "settle" | "later" | "dismiss" | "ignore" | "walk" | "companion" | "agents"
export type IslandBridge = { on: (fn: (d: IslandData) => void) => () => void; act: (act: IslandAct, id: string, mute?: boolean) => void
  faces?: (list: { id: string; x: number; y: number; width: number; height: number }[]) => void }
export const api = window.vaultiteScreen?.island
