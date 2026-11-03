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
