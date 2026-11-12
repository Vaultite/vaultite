import type { Writer } from "../../../core/vault.ts"
import type { Change, Hunk } from "./text.ts"
import type { Target } from "../../../core/desktop/places.ts"

export type Mode = "off" | "quiet" | "pair"
/** What the user did, as an agent sees it. ask: they addressed it; point: an ask without words (its Talk key held, they
 *  drew or pointed); edit and open only in pair; reply, accept, reject, dismiss: their answer to one of its items. */
export type Moment = { seq: number; t: number; kind: "ask" | "point" | "edit" | "open" | "reply" | "accept" | "reject" | "dismiss" | "move" | "change" | "watch"
  path?: string; line?: number; text?: string; selection?: string; hunks?: Hunk[]; item?: string; to?: string
  /** A point's word or selection, where its cursor stays. */
  find?: string
  /** The agent it's for (an ask to @name, an answer to its item); none (edit, open): the companion and agents that watch. */
  for?: string
  /** How long (ms) the user had stopped typing when the app sent it: the pause they waited (a Talk key's ask: since
   *  it was let go, its words finished and what's there gathered). */
  waited?: number
  /** An ask whose line they went on writing after it went: the seq of the one it continues. */
  more?: number
  /** Handed again, as they went on with it before its agent acted: that turn was stopped. */
  again?: boolean
  /** On a drawing (`find`: the element asked in): the user's pointer, what changed after a pause, the scene as text. */
  x?: number; y?: number; changes?: string[]; scene?: string
  /** A reply to or a dismissal of one of its bubbles (`item`: the say), not a comment. */
  bubble?: boolean
  /** Asked with its Talk key (over the screen, Vaultite's windows too: the helper's): its summoned session's (summoned.ts); `voice`:
   *  said, not typed (its answer is said aloud, the desktop app's voice.ts). */
  summoned?: boolean; voice?: boolean
  /** Sent straight to the job working on its page (live editing, liveedit.ts): that job's id; `shotWindow`, the window
   *  under their pointer (Vaultite's own too), pictured before and after its change. */
  live?: string; shotWindow?: number
  /** A question asked over a page a job works on, so the companion's, not sent live: that job's id (its work to read). */
  pageJob?: string
  /** Asked right after a job's change was shown (Show me, then its choice card): that job's id; their words are about it. */
  reviewed?: string
  /** A tour's step handed to the model (tours.ts): the player's words, never the user's, so it's no ask in their box. */
  tour?: boolean
  /** Asked through the realtime voice (the desktop app's realtimefront.ts): it already told them it's looking and says
   *  the answer itself; `talk`, what was said with it before. */
  front?: "realtime"; talk?: string[]
  /** A move: its words moved by the user, a bubble put in the note or what it wrote folded back into a bubble. */
  into?: "note" | "bubble"
  /** On screen, outside the app (the desktop app's helper): the app (bundle id, `appName` its name), its window and title,
   *  what the window says (its Accessibility text) and its picture (a PNG on this machine). */
  app?: string; appName?: string; window?: number; title?: string; screen?: string; shot?: string
  /** Other apps' panels floating over the screen then (a tray, a palette), front first: whose a thing in the picture is. */
  floating?: { app: string; name: string; frame: Rect }[]
  /** What was under their pointer, in words; on screen, that point (sx, sy), the picture's frame (`shotAt`: a pixel a
   *  point), what Accessibility found near it (`near`, ids for --ax) and what they drew (`ink`). */
  under?: string; sx?: number; sy?: number; shotAt?: Rect; near?: Near[]; ink?: Ink[]
  /** Where its picture's top left was on the screen, once its points are the picture's (summoned.ts' inPicture). */
  origin?: { x: number; y: number }
  /** The box they drew on screen and keep there (a drag with the Talk key held: what they record), screen points. */
  region?: Rect
  /** What they clicked as they spoke, the Talk key held (each went on to the app as a click): where, and what was there. */
  clicks?: { sx: number; sy: number; under?: string }[]
  /** The display's picture as the key went down too, when the screen changed while they spoke (a toast gone); over
   *  Vaultite, its toasts of the last minute (`notices`, in words). */
  shotDown?: string; shotDownAt?: Rect; notices?: string
  /** A closer look at what they pointed at, for what's too small in the picture (a logo): its picture, where on screen,
   *  its pixels a point and what's drawn on it to show the spot (their ring, else their pointer's arrow). */
  closeUp?: { shot: string; at: Rect; scale: number; mark?: "ring" | "pointer" }
  /** On screen, its displays' bounds (screen points): where a mark can show. */
  displays?: Rect[]
  /** In a pane (a terminal, a web page: today's tab id) or the app's UI (a data-ui id), by its title; a terminal's row, a
   *  page's element (a snapshot ref) or the text under the pointer (`text`). */
  pane?: string; ui?: string; row?: number; el?: string
  /** Under the pointer, Vaultite's own UI over the pane or note (a menu, a dialog, a pane's bar, the web viewer's bar), by
   *  kind: the ask is likely about the app, not what the pane shows (a job's place, where.ts). */
  chrome?: string
  /** change: what a pane it follows did (`what`: a command ended, the page changed; `changes` its lines); watch: a
   *  watch's hit (`item` the watch, `text` what to do). A page's address. */
  what?: string; url?: string }
export type Rect = { x: number; y: number; width: number; height: number }
/** An element near the pointer (the helper's Accessibility): its id to point by, its role, its words, its frame. */
export type Near = import("./takeover.ts").Near
/** A stroke of ink: what it looks like (a ring round something, a line, an underline, a scribble), its box, its points. */
type Ink = { shape: string; box: Rect; points: [number, number][] }
/** reading: it was handed what the user did; thinking: something to answer; seen: it let that pass (why: its words on it);
 *  starting: its session boots (asks wait for its first `next`); runs (claude, codex), model, effort; asks: a permission. */
export type Agent = Target & Boxed & { name: string; tint: string; state: "watching" | "reading" | "thinking" | "writing" | "starting" | "away"; t: number; seen?: boolean; why?: string
  /** When it last pointed at its place (look, highlight, a say given one): a phone, with no cursor, shows it a moment. */
  pointed?: number
  /** Moved there without acting (after the user's note, back from the screen): its cursor rests at home till it acts. */
  rests?: boolean
  runs?: string; model?: string; effort?: string; asks?: { event: string; text: string } }
export type KeptAgent = Omit<Agent, "state">
/** Where a page's element is in its page (CSS px, at its zoom), for the window to draw at: the engine's answer for `el`. */
export type Boxed = { box?: { x: number; y: number; w: number; h: number; zoom: number } }
/** What an agent leaves in the app: words by its cursor and highlights (gone after a while), a margin comment, a
 *  suggestion, a proposal (a large change, taken in part). `anchor`: a comment's line as it read, to find it again. */
export type Note = Target & Boxed & { id: string; kind: "say" | "comment" | "suggestion" | "proposal" | "highlight" | "ask"; agent: string; t: number
  text?: string; replace?: string; anchor?: string; replies?: Reply[]
  /** A proposal's changes not decided yet (its placeholders while it's written); how many were taken and left. */
  changes?: Change[]; took?: number; left?: number
  /** Who proposed it (or said it), as its request named them: what it takes is written as theirs (Provenance). */
  writer?: Writer
  /** A thread a person started, not an agent: the user, or a shared folder's guest (`agent` is then their name). */
  by?: "user" | "guest"
  /** The agent a person's thread asks (an @name in it): it hears the thread's words and answers in it. */
  ask?: string
  /** A person's colour (a token), where an agent's is its own; a guest's share (its id). */
  tint?: string; share?: string
  /** A say the user pinned: the comment it became. */
  pinned?: string
  /** A say that asks the user something (shown as a question, with a box to answer); one they saw (the unread dot);
   *  one they put in the note. */
  question?: boolean; seen?: boolean; placed?: boolean
  /** A comment the user dismissed, when: kept in its note's history. */
  dismissed?: number
  /** The text it was on is gone: shown by its last line, found again if the text comes back. */
  orphaned?: boolean
  /** A say answering a Talk key's ask: when that ask came, whether it was said (`voice`) and in what language, for the
   *  desktop app to say it aloud (`realtime`: said already, the realtime voice's own). Its exchange's: gone with it. */
  answers?: { t: number; voice?: true; lang?: string; realtime?: true } }
/** A word in a thread: the user's, an agent's, or a guest's (`name`: the guest's, or the agent's in a person's thread); when
 *  (older ones have none). */
export type Reply = { by: "user" | "agent" | "guest"; text: string; name?: string; t?: number }
/** What an agent did when (logged, for timings): called next, was handed moments (seqs), or acted (say, edit...). */
export type Act = { t: number; as: string; op: string; seqs?: number[]; text?: string }
/** A note's lines from..to (1-based, of `of`), sent with the moments in it; a drawing's scene as text. */
export type Excerpt = { path: string; from: number; to: number; of: number; lines: string[]; scene?: string
  /** A pane pointed at: what it shows now (a terminal's screen, a page's tree), by its title. */
  pane?: string; title?: string; text?: string }
