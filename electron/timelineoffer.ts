/** The timeline off (their choice) when they ask for what needs it: one line, said and on a card by their pointer, offers
 *  to turn it on (its button or a spoken yes), never a dead end; on, it keeps from then, and says what came before wasn't. */
import { answerOf } from "../core/desktop/yesno.ts"
import type { Answer } from "./takeoverlogic.ts"

/** What needed it: a replay of the last seconds, or a skill from what they just did. */
export type Needs = "replay" | "skill"
/** What helper.ts lends it. */
export type OfferHost = {
  /** The card by their pointer: its line, a word under it, its yes; how it ended. */
  offer: (id: string, line: string, sub: string, yes: string) => Promise<Answer>
  answer: (id: string, how: Answer) => void
  /** Said aloud (as the voice setting says) and shown a moment. */
  say: (text: string, card?: boolean) => void
  /** The setting on, in the home vault. */
  turnOn: () => Promise<void>
}

export const LINES: Record<Needs, string> = {
  replay: "I wasn't keeping your screen, so there's nothing to send. Turn it on?",
  skill: "I wasn't watching, so I didn't see what you did. Turn it on?",
}
export const SUB = "Keeps the last 30 s of your screen, in memory only till you send it. It starts now."
export const YES = "Turn it on"
export const ON: Record<Needs, string> = {
  replay: "It's on from now. The last 30 s weren't kept, so show me again.",
  skill: "It's on from now. What you just did wasn't kept, so do it again.",
}
/** How long the card waits for an answer. */
export const OFFER_UP_MS = 30_000

let host: OfferHost | null = null
let up: { id: string; needs: Needs } | null = null
let n = 0

export function offerHost(h: OfferHost) { host = h }
export const offerScene = () => up

/** Offer to turn it on, said once (a second ask while it's up says it again). */
export async function offerTimeline(needs: Needs): Promise<Answer | null> {
  if (!host) return null
  if (up) { host.say(LINES[up.needs], true); return null }
  const id = `timeline-${++n}`
  up = { id, needs }
  host.say(LINES[needs], true)
  const how = await host.offer(id, LINES[needs], SUB, YES).finally(() => { if (up?.id === id) up = null })
  if (how !== "yes") return how
  try {
    await host.turnOn()
    host.say(ON[needs])
  } catch (e) {
    host.say(`Couldn't turn it on: ${(e as Error).message}`)
  }
  return how
}

/** Their words while it's up: a yes or no answers it (true: they're its, not an ask); anything else moves on from it. */
export function offerHeard(text: string): boolean {
  if (!up || !host) return false
  const yes = answerOf(text)
  host.answer(up.id, yes === null ? "asked" : yes ? "yes" : "no")
  return yes !== null
}
