import type { Writer } from "../../../core/vault.ts"
import type { Change, Hunk } from "./text.ts"
import type { Target } from "../../../core/desktop/places.ts"

export type Mode = "off" | "quiet" | "pair"
export type Moment = { seq: number; t: number; kind: "ask" | "point" | "edit" | "open" | "reply" | "accept" | "reject" | "dismiss" | "move" | "change" | "watch"
  path?: string; line?: number; text?: string; selection?: string; hunks?: Hunk[]; item?: string; to?: string
  find?: string
  for?: string
  waited?: number
  more?: number
  again?: boolean
  x?: number; y?: number; changes?: string[]; scene?: string
  bubble?: boolean
  summoned?: boolean; voice?: boolean
  live?: string; shotWindow?: number
  pageJob?: string
  reviewed?: string
  tour?: boolean
  front?: "realtime"; talk?: string[]
  into?: "note" | "bubble"
  app?: string; appName?: string; window?: number; title?: string; screen?: string; shot?: string
  floating?: { app: string; name: string; frame: Rect }[]
  under?: string; sx?: number; sy?: number; shotAt?: Rect; near?: Near[]; ink?: Ink[]
  origin?: { x: number; y: number }
  region?: Rect
  clicks?: { sx: number; sy: number; under?: string }[]
  shotDown?: string; shotDownAt?: Rect; notices?: string
  closeUp?: { shot: string; at: Rect; scale: number; mark?: "ring" | "pointer" }
  displays?: Rect[]
  pane?: string; ui?: string; row?: number; el?: string
  chrome?: string
  what?: string; url?: string }
export type Rect = { x: number; y: number; width: number; height: number }
export type Near = import("./takeover.ts").Near
type Ink = { shape: string; box: Rect; points: [number, number][] }
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
export type Act = { t: number; as: string; op: string; seqs?: number[]; text?: string }
export type Excerpt = { path: string; from: number; to: number; of: number; lines: string[]; scene?: string
  pane?: string; title?: string; text?: string }
