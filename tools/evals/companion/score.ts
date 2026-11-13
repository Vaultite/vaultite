// The companion eval's check: what a turn did, as the contract sees it, against what a step expects (fixtures beside
// this file; tools/evals/companion.ts runs them). No Node: the tests read it too.

/** What a turn did: silent (nothing, a pass, only a look), a bubble (say), the note (edit, propose, suggest) or a comment. */
export type Outcome = "silent" | "bubble" | "note" | "comment"
export type Step = { moments: Record<string, unknown>[]; notes: Record<string, string>; expect: Outcome[]; why: string }
export type Fixture = { about: string; mode: string; steps: Step[]; baseline: string[][] }

const NOTE = new Set(["edit", "propose", "suggest", "draw"])

/** A turn's outcome from the ops it ran, in order: the note beats a comment, which beats a bubble. */
export function outcomeOf(ops: string[]): Outcome {
  if (ops.some((o) => NOTE.has(o))) return "note"
  if (ops.includes("comment")) return "comment"
  if (ops.includes("say")) return "bubble"
  return "silent"
}

export type Scored = { step: number; got: Outcome; expect: Outcome[]; ok: boolean; why: string; ops: string[]; spoke: boolean; wanted: boolean }

/** Each step against what it expects: whether it spoke when it should (or stayed silent), and put its words where. */
export function score(steps: Step[], did: string[][]): { rows: Scored[]; right: number; speak: number; place: number; of: number } {
  const rows = steps.map((s, i) => {
    const ops = did[i] ?? [], got = outcomeOf(ops)
    return { step: i + 1, got, expect: s.expect, ok: s.expect.includes(got), why: s.why, ops, spoke: got !== "silent", wanted: !s.expect.includes("silent") }
  })
  // (speak: spoke when it had to, or kept quiet when it could; place: of those it spoke in, where it was wanted)
  const speak = rows.filter((r) => (r.spoke ? r.expect.some((e) => e !== "silent") : r.expect.includes("silent"))).length
  const place = rows.filter((r) => r.spoke && r.ok).length
  return { rows, right: rows.filter((r) => r.ok).length, speak, place, of: rows.length }
}

/** The score as a table: each step, what it expected and what it got, then the totals. */
export function scoreText(label: string, r: ReturnType<typeof score>) {
  const spoke = r.rows.filter((x) => x.spoke).length
  return [`${label}: ${r.right}/${r.of} as expected (speak or stay silent right ${r.speak}/${r.of}; where, of the ${spoke} it spoke in, ${r.place}/${spoke})`,
    ...r.rows.map((x) => `${x.ok ? "  ok  " : "  MISS"} ${String(x.step).padStart(2)} ${x.got.padEnd(7)} want ${x.expect.join("|").padEnd(13)} ${x.why}`)].join("\n")
}

// ---------- spoken: a summoned answer is read aloud (tools/evals/summoned.ts --fixture)

/** What a voice can't say well, each a way an answer reads as text rather than speech. */
const UNSPOKEN: [string, RegExp][] = [
  ["list", /(^|\n)\s*([-*•]|\d+[.)])\s/],
  ["markup", /[*_`#>|]|\*\*/],
  ["brackets", /[()[\]{}]/],
  ["quotes", /["“”«»]|(^|\s)'[^']+'(\s|[.,!?]|$)/],
  ["symbols", /[/\\=~^%$€@&+]|->|→|≈/],
  ["colon list", /:(?!\d)\s*\S[^.!?]*,/],
  ["version or id", /\bv?\d+\.\d+(\.\d+)*\b|\b[a-z]\d{1,3}\b|\w+_\w+|\b\w+-\d+\b/i],
  ["date or time in digits", /\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\b/],
  ["several lines", /\n/],
]
/** How an answer starts when it isn't with the answer. */
const PREAMBLE = /^(sure|certainly|of course|great question|good question|let me|i'll|i will|i can see|looking at|it looks like you('re| are) asking|based on|according to|here('s| is) (what|a))\b/i

export type Spoken = { words: number; sentences: number; faults: string[] }
/** An answer as speech: its words and sentences, and what makes it read as text (lists, brackets, symbols, ids, dates
 *  in digits, a colon list, a preamble before the answer, too long). */
export function spokenStyle(text: string, most = { words: 35, sentences: 3 }): Spoken {
  const t = text.trim(), words = t.split(/\s+/).filter((w) => /\w/.test(w)).length
  const sentences = t.split(/(?<=[.!?])\s+(?=\S)|\n+/).filter((s) => /\w/.test(s)).length
  const faults = UNSPOKEN.filter(([, re]) => re.test(t)).map(([name]) => name)
  if (words > most.words) faults.push("too long")
  if (sentences > most.sentences) faults.push("too many sentences")
  if (PREAMBLE.test(t)) faults.push("preamble")
  return { words, sentences, faults }
}
/** A run's answers as speech: how many sound right, their length, and which faults came up how often. */
export function spokenScore(texts: string[]) {
  const rows = texts.map((t) => spokenStyle(t)), n = rows.length || 1
  const tally: Record<string, number> = {}
  for (const r of rows) for (const f of r.faults) tally[f] = (tally[f] ?? 0) + 1
  const sorted = rows.map((r) => r.words).sort((a, b) => a - b)
  return { rows, clean: rows.filter((r) => !r.faults.length).length, of: rows.length, short: rows.filter((r) => r.words <= 30).length,
    words: { mean: Math.round(rows.reduce((s, r) => s + r.words, 0) / n), median: sorted[Math.floor((sorted.length - 1) / 2)] ?? 0, most: sorted.at(-1) ?? 0 }, tally }
}
/** An answer to someone overwhelmed (`calm`): one thing in two sentences at most, nothing opened, pointed at or drawn;
 *  a task's state from earlier (`aged`): said with its age, or checked again (a tool run) first. */
export function calmFaults(text: string, o: { calm?: boolean; aged?: boolean; pointed: boolean; tools: string[] }) {
  const f: string[] = []
  if (o.calm) {
    if (spokenStyle(text).sentences > 2) f.push("more than two sentences")
    if (o.pointed) f.push("pointed around")
    if (o.tools.some((t) => /^(open|act|page|job-open|split)$/.test(t))) f.push("opened something")
  }
  if (o.aged && !o.tools.length && !/\b(as of|this morning|earlier|last (check|time)|when I (last )?checked|haven.t checked|check(ing)? (again|now))\b/i.test(text)) f.push("stale state as now")
  return f
}
const LOOKS = new Set(["see", "check", "jobs", "job", "where", "conversation", "open", "follow", "page", "draw", "layer", "clear", "pass"])
export function whereFaults(o: { where?: "here" | "away" | "live"; tools: string[]; words: string[] }) {
  const first = o.tools.findIndex((t) => t === "handoff"), wrote = o.tools.indexOf("edit"), opened = o.tools.indexOf("open")
  if (o.where === "here") {
    if (first >= 0 && (wrote < 0 || first < wrote)) return ["handed off what they'd watch"]
    if (wrote < 0) return [opened < 0 ? "wrote no note" : "opened a note but wrote nothing in it"]
  }
  if (o.where === "away" && first < 0) return ["didn't hand it off"]
  if (o.where === "live") {
    const changed = o.tools.findIndex((t) => t !== "handoff" && t !== "Bash" && !LOOKS.has(t))
    if (changed >= 0 && (first < 0 || changed < first)) return []
    if (first < 0) return ["neither changed it nor handed it off"]
    if (!/\b(live|myself|right here|from here|yet)\b/i.test(o.words.join(" "))) return ["handed it off without saying it can't be done live"]
  }
  return []
}
