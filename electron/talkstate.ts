// Whether the menu-bar helper is talking with the user, from the facts it keeps: one answer that every place asking
// (knocks, a reload, hands-free, the held mic, news said after an answer) reads by name. No Electron.
import type { Phase } from "./pressmachine.ts"

export type TalkFacts = {
  /** The helper's own session hears the mic; one is on its way. */
  session: boolean; starting: boolean
  /** The companion's box is open. */
  box: boolean
  /** Its cursor shows it speaking (the voice's level); the voice has words said or still to say; the realtime voice
   *  speaks or is about to. */
  level: boolean; saying: boolean; realtime: boolean
  /** The Talk key's press (its machine's phase), whether its turn was seen at work, and whether it's the exchange's. */
  press: { phase: Phase; begun: boolean; ofExchange: boolean } | null
  /** The exchange on: whether its answer is spoken, and whether its agent is at work. */
  exchange: { spoken: boolean; working: boolean } | null
  /** An offer of an agent's hands is up (takeover.ts): the turn waits on their answer. */
  offering: boolean
}

export type TalkState = {
  listening: boolean
  starting: boolean
  box: boolean
  /** Either voice is heard, or about to be. */
  speaking: boolean
  /** A press under way: held, sent, or its answer coming (not open, missed or closed). */
  pressing: boolean
  /** A press let go whose turn isn't seen at work yet: words may come before the agent's state says so. */
  waiting: boolean
  /** A spoken exchange's answer still going: being said, its turn at work, or an offer of it up. */
  answering: boolean
}

const ACTIVE = new Set<Phase>(["listening", "failed", "sending", "thinking", "working", "answering"])
const WAITING = new Set<Phase>(["sending", "thinking"])
const waits = (p: { phase: Phase; begun: boolean }) => WAITING.has(p.phase) || (p.phase === "answering" && !p.begun)

export function talkState(f: TalkFacts): TalkState {
  const p = f.press, x = f.exchange
  return {
    listening: f.session,
    starting: f.starting,
    box: f.box,
    speaking: f.level || f.saying || f.realtime,
    pressing: !!p && ACTIVE.has(p.phase),
    waiting: !!p && waits(p),
    answering: !!x && x.spoken && (f.level || f.saying || x.working || (!!p && p.ofExchange && waits(p)) || f.offering),
  }
}
