// Lessons (Lessons/<Title>.md) and cards (Cards/<Title>.md), format in AGENTS.md. What the user remembers of each card
// is reviews.json, next to its settings: by source (the file's id) and card key.
import { bullets, OpError, Plugin, section } from "../../../core/plugins.ts"
import { isArchived, type Item, Kind, num, str, truthy } from "../../../core/vault.ts"
import { lessonCards, parseCards, parseLesson } from "./format.ts"
import { localDay, next, nextDue, queue, RATINGS, type Rating, type Reviews, type Source, span } from "./schedule.ts"

export const plugin = new Plugin(import.meta.url)

const created = (fm: Item) => fm.created ?? null

plugin.kind(new Kind({
  type: "lesson", collection: "lessons", folder: "Lessons",
  parse: (fm, body, stem) => [{
    title: truthy(fm.title) ? str(fm.title) : stem, step: num(fm.step) ?? 0, steps: parseLesson(body).steps.length,
    source: fm.source ?? null, created: created(fm), notes: body,
  }, []],
  render: (l) => [{ source: l.source, step: l.step || null, created: l.created }, l.notes || ""],
  key: (l) => str(l.title).toLowerCase(),
}))

plugin.kind(new Kind({
  type: "cards", collection: "decks", folder: "Cards",
  parse: (fm, body, stem) => [{
    title: truthy(fm.title) ? str(fm.title) : stem, cards: parseCards(body).length, source: fm.source ?? null,
    created: created(fm), notes: body,
  }, []],
  render: (d) => [{ source: d.source, created: d.created }, d.notes || ""],
  key: (d) => str(d.title).toLowerCase(),
}))

const reviews = () => plugin.settings({}, "reviews") as Reviews
const settings = () => {
  const s = plugin.settings({})
  return { retention: num(s.retention) ?? 0.9, newPerDay: num(s.new_per_day) ?? 20,
    remindAt: s.remind_at === undefined || s.remind_at === null ? "08:00" : str(s.remind_at).trim() }
}
const done = (l: Item) => l.steps > 0 && l.step >= l.steps

/** What has cards to review: every cards file, and each finished lesson's recall questions. */
function sources(): Source[] {
  const decks = plugin.vault.items("decks").filter((d) => !isArchived(d)).map((d) => ({ id: d.id, title: d.title, cards: parseCards(d.notes) }))
  const lessons = plugin.vault.items("lessons").filter((l) => !isArchived(l) && done(l))
    .map((l) => ({ id: l.id, title: l.title, cards: lessonCards(l.notes) })).filter((s) => s.cards.length)
  return [...decks, ...lessons]
}

function findSource(name: string) {
  const want = name.trim().replace(/\.md$/i, "").toLowerCase()
  return sources().find((s) => s.id.toLowerCase() === want || s.title.toLowerCase() === want)
}

plugin.route("GET", "lessons/state", () => ({ reviews: reviews(), ...settings() }))

// ---------- operations (core/ops.ts)

plugin.op({
  id: "cards.due",
  mcp: "cards_due",
  summary: "The cards due for review now, mixed across the user's cards files and finished lessons: to quiz them.",
  help: `Ask each prompt, let the user answer, show the answer, then record how it went with cards.review. A cloze card's
prompt has its blank as ==text==: hide it when asking.

  vau cards.due
  vau cards.due --source "Cards/Spanish verbs" --limit 5`,
  kind: "read",
  params: {
    source: { type: "string", description: "only this cards file or lesson (its path or title)" },
    limit: { type: "integer", minimum: 1, default: 20, description: "at most this many" },
  },
  run: ({ source, limit }) => {
    const all = source ? [findSource(source) ?? fail(source)] : sources()
    const now = new Date()
    const due = queue(all, reviews(), now, settings().newPerDay)
    return { due: due.length, next: due.length ? null : nextDue(all, reviews(), now),
      cards: due.slice(0, limit).map((c) => ({ source: c.source, card: c.key, prompt: c.prompt, answer: c.answer, cloze: c.cloze ?? null, new: c.fresh })) }
  },
  text: (r) => r.due
    ? `${r.due} due.\n\n${r.cards.map((c: Item) => `- ${c.prompt} (source: ${c.source}, card: ${c.card})\n  Answer: ${c.answer.replace(/\n+/g, " ")}`).join("\n")}`
    : `Nothing due.${r.next ? ` Next on ${str(r.next).slice(0, 10)}.` : ""}`,
})

plugin.op({
  id: "cards.review",
  mcp: "cards_review",
  summary: "Record how the user did on a card (again, hard, good or easy), which decides when it comes back.",
  help: `again: forgot it; hard: got it with effort; good: got it; easy: instantly. The card by its key (cards.due's
\`card\`) or its prompt.

  vau cards.review "Cards/Spanish verbs" 1kx9a2 good`,
  kind: "write",
  params: {
    source: { type: "string", required: true, description: "the cards file or lesson (its path or title)" },
    card: { type: "string", required: true, description: "the card's key, or its prompt" },
    rating: { type: "string", enum: [...RATINGS], required: true, description: "again, hard, good or easy" },
  },
  args: ["source", "card", "rating"],
  run: ({ source, card, rating }) => {
    const src = findSource(source) ?? fail(source)
    const c = src.cards.find((x) => x.key === card) ?? src.cards.find((x) => x.prompt.toLowerCase() === str(card).trim().toLowerCase())
    if (!c) throw new OpError(`no card '${card}' in ${src.id} (cards.due lists them)`, 404)
    const all = plugin.readSettings("reviews") ?? {}
    const now = new Date()
    const m = next(all[src.id]?.[c.key], (RATINGS.indexOf(rating) + 1) as Rating, now, settings().retention)
    plugin.saveSettings({ ...all, [src.id]: { ...all[src.id], [c.key]: m } }, "reviews")
    if (!queue(sources(), reviews(), now, settings().newPerDay).length) inbox("inbox:drop")?.("lessons", KEY)
    return { source: src.id, card: c.key, due: m.due, in: span(now, m.due) }
  },
  text: (r) => `Back in ${r.in}.`,
})

function fail(source: string): never {
  throw new OpError(`no cards file or finished lesson called '${source}' (cards.due lists what's due)`, 404)
}

// ---------- the day's reminder: one Inbox event (pushed to the phone) when cards are due, which a newer one replaces and
// the last card reviewed takes away, so they never pile up.

const KEY = "cards-due"
const inbox = (name: string) => plugin.service(name) as ((...a: unknown[]) => unknown) | null

/** Checked every 15 minutes (so a changed time applies at once, and a Mac asleep at that time catches up): once a day,
 *  from remind_at on, if cards are due. When it last did is kept next to the settings. */
plugin.every("reminder", { every: "15m" }, () => {
  const at = settings().remindAt
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(at)
  if (!m) return
  const now = new Date()
  const today = localDay(now)
  if (now.getHours() * 60 + now.getMinutes() < Number(m[1]) * 60 + Number(m[2])) return
  if (plugin.readSettings("reminded")?.day === today) return
  plugin.saveSettings({ day: today }, "reminded")
  remind(now)
})

/** Only for someone who uses cards: due ones, and a review done before (new cards alone never remind). */
function remind(now = new Date()) {
  const due = queue(sources(), reviews(), now, settings().newPerDay)
  if (!due.length || !Object.values(reviews()).some((r) => Object.keys(r ?? {}).length)) return void inbox("inbox:drop")?.("lessons", KEY)
  const from = [...new Set(due.map((d) => d.title))]
  inbox("inbox:event")?.({ source: "lessons", kind: "info", key: KEY, link: "detail:review",
    title: `${due.length} card${due.length === 1 ? "" : "s"} to review`,
    body: from.length > 3 ? `${from.slice(0, 3).join(", ")} and ${from.length - 3} more` : from.join(", ") })
}

// ---------- blocks as text (GET /api/render) ----------

plugin.block("lessons", (ctx) => {
  const lessons = plugin.vault.items("lessons").filter((l) => !isArchived(l))
  const decks = plugin.vault.items("decks").filter((d) => !isArchived(d))
  ctx.source([lessons, decks])
  const now = new Date()
  const due = queue(sources(), reviews(), now, settings().newPerDay).length
  const at = (l: Item) => (done(l) ? "done" : l.step ? `step ${l.step + 1} of ${l.steps}` : `${l.steps} steps, not started`)
  const nxt = nextDue(sources(), reviews(), now)
  return section("Lessons",
    due ? `${due} cards to review now.` : `Nothing to review${nxt ? ` until ${localDay(new Date(nxt))}` : ""}.`,
    lessons.length ? `Lessons:\n${bullets(lessons.map((l) => `[[${l.title}]]: ${at(l)}`))}` : "",
    decks.length ? `Cards:\n${bullets(decks.map((d) => `[[${d.title}]]: ${d.cards} cards`))}` : "",
    !lessons.length && !decks.length ? "_No lessons or cards yet._" : "")
})
