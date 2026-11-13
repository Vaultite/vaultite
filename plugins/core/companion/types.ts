import type { z } from "zod"
import type { Writer } from "../../../core/vault.ts"
import type { ActRow, MomentRow, RectRow } from "./rows.ts"
import type { Change } from "./text.ts"
import type { Target } from "../../../core/desktop/places.ts"

export type Mode = "off" | "quiet" | "pair"
export type Moment = z.infer<typeof MomentRow>
export type JobAsk = Omit<Moment, "seq">
export type Rect = z.infer<typeof RectRow>
export type Near = import("./takeover.ts").Near
export type Agent = Target & Boxed & { name: string; tint: string; state: "watching" | "reading" | "thinking" | "writing" | "starting" | "away"; t: number; seen?: boolean; why?: string
  pointed?: number
  rests?: boolean
  runs?: string; model?: string; effort?: string; asks?: { event: string; text: string } }
export type KeptAgent = Omit<Agent, "state">
export type Boxed = { box?: { x: number; y: number; w: number; h: number; zoom: number } }
export type Note = Target & Boxed & { id: string; kind: "say" | "comment" | "suggestion" | "proposal" | "highlight" | "ask"; agent: string; t: number
  text?: string; replace?: string; anchor?: string; replies?: Reply[]
  changes?: Change[]; took?: number; left?: number
  writer?: Writer
  by?: "user" | "guest"
  ask?: string
  tint?: string; share?: string
  pinned?: string
  question?: boolean; seen?: boolean; placed?: boolean
  dismissed?: number
  orphaned?: boolean
  answers?: { t: number; voice?: true; lang?: string; realtime?: true } }
export type Reply = { by: "user" | "agent" | "guest"; text: string; name?: string; t?: number }
export type Act = z.infer<typeof ActRow>
export type Excerpt = { path: string; from: number; to: number; of: number; lines: string[]; scene?: string
  pane?: string; title?: string; text?: string }
