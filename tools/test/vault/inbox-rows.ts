import type { VaultTest } from "./harness.ts"
import type { Act, Heard, Seen } from "../../../plugins/core/inbox/rows.ts"
import type { InboxEvent } from "../../../plugins/core/inbox/model.ts"

type Rows = typeof import("../../../plugins/core/inbox/rows.ts")
type Check = VaultTest["check"]

// An agent session's row in the inbox, decided from what was heard (rows.ts): no server, no store.
export default async ($: VaultTest) => {
  const R = await import("../../../plugins/core/inbox/rows.ts")
  for (const part of [hearing, heardProperties, asking, words, judged, quietTurns, delegation, rows]) part($.check, R)
}

const term = (state: Heard["state"], more: Partial<Heard> = {}): Heard => ({ agent: "claude", terminal: "claude-r1", state, from: "osc7501", ...more })
const row = (e: Partial<InboxEvent>): InboxEvent => ({ id: "r1", t: 1000, source: "claude", kind: "session", state: "open", title: "Lighthouse", ...e })
const all = (...xs: boolean[]) => xs.every(Boolean)

function heardIn(R: Rows, hs: Heard[]): Act[] {
  let seen: Seen | undefined
  return hs.map((h, i) => { const r = R.hear(seen, h, 1000 + i * 100); seen = r.seen; return r.act })
}

function hearing(check: Check, R: Rows) {
  const ask = term("blocked", { kind: "permission", msg: "Run ls?" })
  const twice = heardIn(R, [ask, ask])
  const hooked = heardIn(R, [term("done", { own: true, from: "hooks" }), term("done", { own: true, from: "hooks" })])
  check("rows: a terminal saying the same twice asks once; an agent's own hook is news each time",
    all(twice[0].do === "ask", twice[1].do === "repeat", hooked.every((t) => t.do === "turn")), [twice, hooked])

  const turn = heardIn(R, [term("working"), term("blocked", { kind: "permission" }), term("working"), term("working", { msg: "still" }), term("idle")])
  const end = turn.at(-1), answered = turn[2]
  check("rows: a turn's end is judged from when it last went to work, the user's answer counted",
    all(end?.do === "turn" && end.since === 1200, answered.do === "working" && answered.resolve === "answer"), turn)

  const refused = heardIn(R, [term("working"), term("blocked", { kind: "question" }), term("idle")])
  const failed = heardIn(R, [term("working"), term("blocked", { kind: "question" }), term("error")])
  check("rows: out of a question without working again is refused, not judged; an error out of one leaves its question",
    all(refused.at(-1)?.do === "refused", failed.at(-1)?.do === "nothing"), [refused, failed])

  const idle = heardIn(R, [term("idle"), term("done")])
  const restarted = R.hear(undefined, term("idle", { was: "working" }), 5000).act
  check("rows: idle with nothing working is no news; after a restart, what its terminal told before stands",
    all(idle.every((t) => t.do === "nothing"), restarted.do === "turn"), [idle, restarted])

  const prompted = R.hear(undefined, term("working", { own: true, from: "hooks" }), 0).act
  check("rows: a prompt its own hook saw is the user writing to it", prompted.do === "working" && prompted.resolve === "user", prompted)
}

function asking(check: Check, R: Rows) {
  const qs = [{ question: "Which port?", options: [{ label: "8080" }, { label: "9090", description: "the spare" }] }]
  const asked = R.askedRow({ kind: "question", questions: qs }, "permission", "Claude needs your permission")
  const plan = R.askedRow({ kind: "plan", plan: "1. Split the file" }, "plan")
  const bare = R.askedRow(null, R.askOf("auth")), other = R.askedRow(null, R.askOf("sudo"), "Wants to use Bash")
  check("rows: a question in its own words is the row's, its body listing the options; a plan its text; else what was said, else what it waits on",
    all(asked.state === "open", asked.ask === "question", asked.read === false, asked.questions === qs,
      /^Which port\?\n\n1\. \*\*8080\*\*\n2\. \*\*9090\*\*: the spare$/.test(asked.body ?? ""), plan.ask === "plan", plan.body === "1. Split the file",
      bare.ask === "auth", bare.body === "Needs you to sign in", other.ask === "question", other.body === "Wants to use Bash"), [asked, plan, bare, other])
}

function words(check: Check, R: Rows) {
  const last = { session: "s1", prompt: "Fix it", text: "Fixed.", at: 0, final: true }
  check("rows: a turn's words are its hook's over its transcript's; Codex starting up is no turn; only a transcript says the session started it",
    all(R.wordsOf(term("idle"), null) === null, R.wordsOf(term("idle", { from: "hooks" }), null)?.text === "",
      R.wordsOf(term("done", { text: " Done. " }), last)?.text === "Done.", R.wordsOf(term("done"), last)?.prompt === "Fix it",
      R.wordsOf(term("done"), { ...last, auto: true })?.auto === true, R.wordsOf(term("done", { prompt: "Go" }), { ...last, auto: true })?.auto === false,
      R.wordsOf(term("error", { msg: "Crashed" }), null)?.text === "Crashed"))
}

const reply = { needs: true, why: "reply", by: "rule" } as const
const answer = { needs: true, why: "answer", by: "model" } as const
const nothing = { needs: false, why: null, by: "rule" } as const
const turn = { body: "Two ways to do it?", prompt: "Plan the Lighthouse page", auto: false, quietAnswers: true }

function judged(check: Check, R: Rows) {
  const asks = R.afterTurn(undefined, reply, turn), quiet = R.afterTurn(undefined, answer, turn), loud = R.afterTurn(undefined, answer, { ...turn, quietAnswers: false })
  check("rows: a turn that needs the user opens its row, unread and told; an answer only to read is done, unread, untold, unless answers go to the inbox",
    all(asks?.news === true, asks?.patch.state === "open", asks?.patch.ask === "reply", asks?.patch.read === false, !!asks?.patch.turn,
      quiet?.news === false, quiet?.patch.state === "done", quiet?.patch.ask === "answer", quiet?.patch.read === false,
      loud?.news === true, loud?.patch.state === "open", loud?.patch.ask === "answer"), [asks, quiet, loud])
  check("rows: a quiet turn with no row is done, read", R.afterTurn(undefined, nothing, turn)?.patch.state === "done")
}

function quietTurns(check: Check, R: Rows) {
  const left = row({ ask: "reply", turn: R.turnOf(turn.prompt) })
  const same = R.afterTurn(left, nothing, turn), next = R.afterTurn(left, nothing, { ...turn, prompt: "Now build it" })
  const itself = R.afterTurn(left, nothing, { ...turn, prompt: "A background task finished", auto: true })
  const blockedNow = R.afterTurn(row({ ask: "permission" }), nothing, { ...turn, auto: true })
  check("rows: a quiet turn keeps what the same turn left to read; the user's next message settles it, a turn the session started doesn't",
    all(same === null, next?.patch.state === "done", next?.patch.read === true, next?.news === false, itself === null, blockedNow?.patch.state === "done"),
    [same, next, itself, blockedNow])
  check("rows: a report filed since its turn started is that turn's row", all(R.reportedSince(row({ ask: "report", t: 5000 }), 6000),
    !R.reportedSince(row({ ask: "report", t: 3000 }), 6000), !R.reportedSince(row({ ask: "report", state: "working", t: 7000 }), 6000), !R.reportedSince(row({ t: 7000 }), 6000)))
  const long = R.bodyOf("x".repeat(9000)) ?? ""
  check("rows: a long answer is cut, said so; none is no body", all(long.endsWith("\n\n…"), long.length < 8100, R.bodyOf("") === undefined, R.bodyOf("Done.") === "Done."))
}

function delegation(check: Check, R: Rows) {
  const line = { parent: { agent: "claude", session: "p1", task: "Check the links" }, consumes: true, waits: 0 }
  const sub = R.delegatedRow(line, false, "All good", "x"), subFailed = R.delegatedRow(line, true, "Broke", "x")
  const waiting = R.delegatedRow({ parent: null, consumes: false, waits: 2 }, false, "Started two", "Split it")
  check("rows: a subagent's turn is its parent's (done, read; failed says so); a session waiting on its subagents is working",
    all(R.delegated(line), !R.delegated({ parent: line.parent, consumes: false, waits: 0 }), !R.delegated(null),
      sub.state === "done", sub.read === true, sub.ask === undefined, subFailed.ask === "error", waiting.state === "working", waiting.turn === R.turnOf("Split it")),
    [sub, subFailed, waiting])
}

function rows(check: Check, R: Rows) {
  const who = { agent: "claude", terminal: "claude-r1", session: "" }
  const qs = [{ question: "Which port?", options: [{ label: "8080" }, { label: "9090" }] }]
  const made = R.rowWith(null, { state: "open", ask: "question", questions: qs, body: "a body", link: undefined }, who, { id: "n1", t: 9, title: "", fallback: "Claude Code session" })
  const renamed = R.rowWith(row({ body: "## Done\n\nAll **good**", ask: "reply" }), { state: "done", ask: undefined }, { ...who, session: "s9" }, { id: "n2", t: 10, title: "", fallback: "x" })
  check("rows: a new row is the session's, named for its agent when nothing names it, its preview its question; a field patched undefined is gone",
    all(made.id === "n1", made.kind === "session", made.title === "Claude Code session", made.terminal === "claude-r1", !("session" in made), !("link" in made),
      made.preview === "Which port? 8080 or 9090", renamed.id === "r1", renamed.title === "Lighthouse", renamed.session === "s9", !("ask" in renamed),
      renamed.preview === "Done All good"), [made, renamed])
  check("rows: a thread named by its host is that row alone; else by its session, else its terminal; never a gate's or another machine's",
    all(R.rowOf({ ...who, thread: "r1" })(row({})), !R.rowOf({ ...who, thread: "r2" })(row({ terminal: "claude-r1" })), R.rowOf(who)(row({ terminal: "claude-r1" })),
      !R.rowOf(who)(row({ terminal: "claude-r1", gate: true })), !R.rowOf(who)(row({ terminal: "claude-r1", machine: "m2" })),
      !R.rowOf({ ...who, agent: "codex" })(row({ terminal: "claude-r1" }))))
}

const STATES: Heard["state"][] = ["idle", "working", "blocked", "done", "error"]

/** What a session's row promises of the act each change makes, against what was heard before it (`before`), and when
 *  its turn started; null when it holds. */
function broken(h: Heard, act: Act, before: Heard | null, startedAt: number): string | null {
  const prev = before?.state
  if (h.state === "blocked" && act.do !== "ask") return "a question not asked"
  if (h.state === "working" && act.do !== "working") return "working not heard as working"
  if (act.do === "working" && act.resolve !== (h.own ? "user" : prev === "blocked" ? "answer" : null)) return "working not the user's answer or message"
  if (act.do === "turn" && (act.since !== startedAt || (!h.own && prev !== "working"))) return "a turn judged from the wrong start, or with nothing working"
  if (act.do === "refused" && (prev !== "blocked" || h.own || h.state === "error")) return "refused without a question it left"
  if (h.own && h.state !== "working" && h.state !== "blocked" && act.do !== "turn") return "an agent's own end not a turn"
  return null
}

function randomHeard(pick: <T>(xs: T[]) => T, rand: (n: number) => number, terminal?: string): Heard {
  return { agent: "claude", state: pick(STATES), from: pick(["osc7501", "hooks", "agent"] as const), ...(terminal ? { terminal } : { session: "s1" }),
    ...(rand(3) === 0 ? { own: true } : {}), ...(rand(2) ? { kind: pick(["permission", "question"]) } : {}), ...(rand(3) === 0 ? { msg: pick(["a", "b"]) } : {}) }
}

const repeated = (h: Heard, before: Heard | null) =>
  !!before && !h.own && !!h.terminal && before.state === h.state && before.kind === h.kind && before.msg === h.msg

/** rows.ts' hear on random sequences of changes, against what a session's row promises. */
function heardProperties(check: Check, R: Rows) {
  let seed = 11
  const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n }
  const pick = <T,>(xs: T[]) => xs[rand(xs.length)]
  const found: unknown[] = []
  for (let run = 0; run < 3000 && found.length < 3; run++) {
    const terminal = rand(4) ? "claude-p1" : undefined
    let seen: Seen | undefined, before: Heard | null = null, startedAt: number | null = null
    const hs: Heard[] = []
    for (let i = 0, n = 1 + rand(25); i < n; i++) {
      const h = randomHeard(pick, rand, terminal), now = 1000 + i * 100
      hs.push(h)
      const { seen: next, act } = R.hear(seen, h, now)
      if (repeated(h, before) !== (act.do === "repeat") || (act.do === "repeat" && next !== seen)) { found.push({ why: "a terminal's repeat not heard exactly once", hs, act }); continue }
      if (act.do === "repeat") continue
      if (h.state === "working" && before?.state !== "working") startedAt = now
      startedAt ??= now
      const why = broken(h, act, before, startedAt) ?? (next.since === startedAt ? null : "its turn's start lost")
      if (why) found.push({ why, hs, act })
      seen = next
      before = h
    }
  }
  check("rows (3000 random runs): a terminal's repeat heard once, every question asked, a turn judged from its start and only after work or its own word, refused only out of a question",
    found.length === 0, found[0])
}
