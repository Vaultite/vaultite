import path from "node:path"
import { type SampleAsk } from "../../../core/agents.ts"
import { type Op, type OpCtx, OpError, quoted } from "../../../core/plugins.ts"
import { isArchived, type Item, nowStamp, sortBy, str, truthy } from "../../../core/vault.ts"
import { answerOf, type DecisionSpec, overlap, sameQuestion, specOf } from "./decisions.ts"
import { clip, previewOf, TERMINAL } from "./model.ts"
import { latest, resultAt, tldrOf } from "./results.ts"
import { agentOfTerminal, DAY, holdNow, plugin, selfMachine } from "./server.ts"
import { rowOf, type Who } from "./rows.ts"
import { agentLabel, sessionTitle, track } from "./sessions.ts"
import { snoozed, stampOf } from "./snooze.ts"
import { addEvent, list } from "./store.ts"

// decisions: what an agent asks the user, a file each (decisions.ts), the answer sent back to its session

const openDecisions = () => plugin.vault.items("inbox").filter((r) => truthy(r.question) && str(r.status) === "new" && !isArchived(r))
export const baseOf = (p: string) => path.posix.basename(p.replace(/\.md$/i, ""))
const linkTo = (p: string) => /^\[\[([^\]|#]+)/.exec(p.trim())?.[1]?.trim() ?? p.trim()
const reportOf = (link: string) => {
  const name = baseOf(linkTo(link))
  return name ? plugin.vault.items("inbox").find((r) => baseOf(str(r.id)) === name && !truthy(r.question)) : undefined
}

export type Asker = { agent: string; session: string; terminal: string; machine: string | null; from: string }
const askerFields = (w: Asker) => ({ ...(w.agent ? { agent: w.agent } : {}), ...(w.session ? { session: w.session } : {}), ...(w.terminal ? { terminal: w.terminal } : {}),
  ...(w.machine ? { machine: w.machine } : {}) })

/** A decision that waits on the user is told (toast, notifications) by an event linking its file: not listed apart, done
 *  once the file is archived, and not its session's (whose row is its thread). */
function tellDecision(r: Item, w: Asker) {
  const options = (r.options as string[]) ?? []
  addEvent({ source: w.agent || "vau", kind: "waiting", state: "open", ask: "question", title: str(r.question), link: `${r.id}.md`,
    body: options.map((o) => (o === r.default ? `${o} (default)` : o)).join(" · ") })
}

/** Ask the user `specs`: each a file, or merged into the same question already open (from another agent or note: its
 *  report added to `also`, waiting if this one waits). `report`: the report asking them (its basename). */
export async function askAll(ctx: OpCtx, specs: DecisionSpec[], w: Asker, report: string, gist = "") {
  await plugin.vault.sync()
  // (read cold days later: which session asked, and what its report said then, kept with it)
  const k: Who = { agent: w.agent, terminal: w.terminal, session: w.session }
  const where = w.terminal || w.session ? clip(list().find(rowOf(k))?.title || await sessionTitle(k), 120) : ""
  const out: { path: string; question: string; merged: boolean; blocking: boolean }[] = []
  for (const d of specs) {
    const same = openDecisions().find((r) => sameQuestion(str(r.question), d.question)) ??
      out.map((x) => resultAt(x.path)).find((r) => r && sameQuestion(str(r.question), d.question))
    if (same) {
      const link = report ? `[[${report}]]` : ""
      const also = (same.also as string[] | undefined) ?? []
      const more = link && baseOf(linkTo(str(same.report))) !== report && !also.some((l) => baseOf(linkTo(l)) === report)
      const waits = d.blocking && same.blocking !== true
      if (more || waits) await ctx.api("PUT", `inbox/${encodeURIComponent(same.id)}`, { ...(more ? { also: [...also, link] } : {}), ...(waits ? { blocking: true } : {}) })
      if (waits) tellDecision({ ...same, blocking: true }, w)
      out.push({ path: `${same.id}.md`, question: str(same.question), merged: true, blocking: waits || same.blocking === true })
      continue
    }
    const r = await ctx.api("POST", "inbox", { title: d.title, body: d.why, from: w.from, question: d.question, options: d.options, effects: d.effects, default: d.default, blocking: d.blocking,
      ...(report ? { report: `[[${report}]]` } : {}), ...(gist ? { gist: clip(gist, 400) } : {}), ...(where ? { where } : {}), ...askerFields(w) }) as Item
    if (d.blocking) tellDecision(r, w)
    out.push({ path: `${r.id}.md`, question: d.question, merged: false, blocking: d.blocking })
  }
  knockSoon(out.some((x) => x.blocking))
  const fresh = out.filter((x) => !x.merged).map((x) => x.path)
  if (fresh.length) track(mergeAlike(ctx, fresh))
  return out
}

/** The same question said another way ("Keep the quieter island?", "Should the island stay quieter?"): a small model
 *  matches new decisions against the open ones, and a match is merged into the one asked first, saying so. */
async function mergeAlike(ctx: OpCtx, made: string[]) {
  const sample = plugin.service("sample") as ((a: SampleAsk) => Promise<{ text: string }>) | null
  const fresh = made.map(resultAt).filter((r): r is Item => !!r && str(r.status) === "new")
  const open = openDecisions().filter((r) => !fresh.some((f) => f.id === r.id)).slice(0, 40)
  if (!sample || !fresh.length || !open.length) return
  const L = "ABCDEFGHIJ"
  const prompt = `New questions:\n${fresh.slice(0, 10).map((r, i) => `${L[i]}. ${str(r.question)} (options: ${((r.options as string[]) ?? []).join(" / ")})`).join("\n")}\n\n` +
    `Questions already open:\n${open.map((r, i) => `${i + 1}. ${str(r.question)} (options: ${((r.options as string[]) ?? []).join(" / ")})`).join("\n")}`
  let text = ""
  try {
    text = (await sample({ tier: "quick", signal: AbortSignal.timeout(60_000), prompt,
      system: "You keep a user's open questions free of duplicates. A new question is a duplicate when it asks for the same decision as an open one, whatever the wording: answering one would answer the other. Different parts of a feature, or related but separate choices, aren't. Reply with one line per duplicate, \"<letter>: <number>\", or the word NONE." })).text
  } catch { return }
  for (const m of text.matchAll(/^\s*([A-J])\s*[:=-]\s*(\d+)/gm)) {
    const r = fresh[L.indexOf(m[1])], into = open[Number(m[2]) - 1]
    // (the model's match alone merged unrelated questions: the same question shares some of its words)
    if (!r || !into || str(into.status) !== "new" || overlap(str(r.question), str(into.question)) < 0.2) continue
    const link = str(r.report)
    const also = [...((into.also as string[] | undefined) ?? []), ...(link && baseOf(linkTo(link)) !== baseOf(linkTo(str(into.report))) ? [link] : [])]
    await ctx.api("PUT", `inbox/${encodeURIComponent(into.id)}`, { also, ...(r.blocking === true && into.blocking !== true ? { blocking: true } : {}) }).catch(() => {})
    await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { status: "done", closed: `Same as [[${baseOf(str(into.id))}]]` }).catch(() => {})
  }
}

export function specsOf(given: unknown, blocking: boolean): DecisionSpec[] {
  const xs = Array.isArray(given) ? given : given === undefined || given === null || given === "" ? [] : [given]
  try { return xs.map((x) => specOf(x, blocking)) } catch (e) { throw new OpError(`decision: ${(e as Error).message}`) }
}

/** The sessions a decision's answer goes to: its report's (the reply goes on in it), else its own; and those of the
 *  reports that asked it too. Each once, by the file the reply goes into. */
function answerTargets(d: Item): string[] {
  const out: string[] = [], seen = new Set<string>()
  for (const r of [reportOf(str(d.report)) ?? d, ...((d.also as string[] | undefined) ?? []).map(reportOf)]) {
    const key = r ? str(r.session) || str(r.terminal) : ""
    if (!r || !key || seen.has(key)) continue
    seen.add(key)
    out.push(`${r.id}.md`)
  }
  return out
}

/** What its agent is told of an answer: a decision it waits on, or a default it took that the user changed; nothing
 *  when they kept the default it took. */
const toldOf = (d: Item, answer: string) => d.blocking === true
  ? `"${str(d.question)}": ${answer}`
  : answer !== str(d.default) ? `"${str(d.question)}": you went with "${str(d.default)}"; the user wants "${answer}" instead, so change it` : ""

/** Answers to the sessions that asked, one reply each (inbox.reply: typed in, resumed, or a new session reading the
 *  report). Never fails the answer: what couldn't be sent is said. */
async function sendAnswers(ctx: OpCtx, answered: { d: Item; answer: string }[]) {
  const by = new Map<string, string[]>()
  for (const { d, answer } of answered) {
    const line = toldOf(d, answer)
    if (line) for (const to of answerTargets(d)) by.set(to, [...by.get(to) ?? [], line])
  }
  const sent: string[] = [], failed: string[] = []
  for (const [to, lines] of by) {
    const text = `The user decided${lines.length > 1 ? ` ${lines.length} of your questions` : ""}: ${lines.map((l, i) => (lines.length > 1 ? `${i + 1}. ${l}` : l)).join(" ")}`
    try { await ctx.op("inbox.reply", { to, text }); sent.push(to) } catch (e) { failed.push(`${to}: ${(e as Error).message}`) }
  }
  return { sent, failed }
}

/** Open decisions that later work settled (a report, another answer) close themselves, saying why: a small model reads
 *  what was done against them, and only what it clearly settles goes. Runs after its op has answered. */
export async function closeSettled(ctx: OpCtx, said: string, by: string, skip: Set<string>) {
  const sample = plugin.service("sample") as ((a: SampleAsk) => Promise<{ text: string }>) | null
  const open = openDecisions().filter((r) => !skip.has(str(r.id))).slice(0, 30)
  if (!sample || !open.length || !said.trim()) return
  const prompt = `What was just done or decided (${by}):\n<done>\n${said.slice(0, 6000)}\n</done>\n\nQuestions still open for the user:\n` +
    open.map((r, i) => `${i + 1}. ${str(r.question)} (options: ${((r.options as string[]) ?? []).join(" / ")})`).join("\n")
  let text = ""
  try {
    text = (await sample({ tier: "quick", signal: AbortSignal.timeout(60_000), prompt,
      system: "You keep a user's list of open questions tidy. A question is settled when what was just done answers it, does what it asks or decides it, or makes it moot (the thing it's about was removed or replaced). Only clear cases: when unsure, leave it open. Reply with one line per settled question, \"<number>: <why, in a few plain words>\", or the word NONE." })).text
  } catch { return }
  for (const m of text.matchAll(/^\s*(\d+)\s*[:.)-]\s*(.+)$/gm)) {
    const r = open[Number(m[1]) - 1]
    if (!r || str(r.status) !== "new") continue
    await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { status: "done", closed: clip(`Settled by ${by}: ${m[2]}`, 300) }).catch(() => {})
  }
}

// The companion says what's waiting at a pause (a knock by the notch), once a burst of decisions has come: told again
// only when there are more than it said.
let knockTimer: ReturnType<typeof setTimeout> | null = null
let knocked = 0, knockWaits = false
function knockSoon(waits: boolean) {
  knockWaits ||= waits
  if (knockTimer) clearTimeout(knockTimer)
  knockTimer = setTimeout(() => { knockTimer = null; void knockNow().catch(() => {}) }, 20_000)
  knockTimer.unref?.()
}

const NUMBERS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"]
async function knockNow() {
  const open = openDecisions().filter((r) => !snoozed(str(r.snoozed)))
  const waits = knockWaits
  knockWaits = false
  if (open.length <= knocked && !waits) { knocked = open.length; return }
  knocked = open.length
  if (!open.length || holdNow()) return
  const n = open.length
  const line = n === 1 ? `A decision waiting: ${str(open[0].question)}` : `${NUMBERS[n] ?? n} decisions waiting`
  await plugin.runOp("companion.knock", { line: clip(line, 140), who: "Inbox", open: "view:inbox", urgency: waits ? "high" : "low", for: waits ? "1h" : "4h" })
}

export function decisionAt(p: string): Item | undefined {
  const r = resultAt(p) ?? (() => { const n = baseOf(p); return plugin.vault.items("inbox").find((x) => truthy(x.question) && baseOf(str(x.id)) === n) })()
  return r && truthy(r.question) ? r : undefined
}

/** A decision's options as text, each with what it causes: "Keep (default): the island stays quiet · Go back: ...". */
const optionsText = (r: Item, sep = " · ") => ((r.options as string[]) ?? []).map((o, i) => {
  const does = str(((r.effects as string[] | undefined) ?? [])[i])
  return `${o}${o === r.default ? " (default)" : ""}${does ? `: ${does}` : ""}`
}).join(sep)

export const decisionRow = (r: Item) => ({ path: `${r.id}.md`, question: str(r.question), options: (r.options as string[]) ?? [], effects: (r.effects as string[] | undefined) ?? [], default: str(r.default), blocking: r.blocking === true,
  from: str(r.from) || null, where: str(r.where) || null, report: str(r.report) || null, gist: str(r.gist) || null, why: previewOf(str(r.body).replace(/```[\s\S]*?```/g, "")).slice(0, 300) || null, created: r.created ?? null,
  ...(str(r.answer) ? { answer: str(r.answer), answered: r.answered ?? null } : {}), ...(str(r.closed) ? { closed: str(r.closed) } : {}),
  ...(snoozed(str(r.snoozed)) ? { snoozed: str(r.snoozed) } : {}) })

export const decisionLine = (r: Item) => {
  const why = previewOf(str(r.body).replace(/```[\s\S]*?```/g, "")).slice(0, 300), gist = str(r.gist) || tldrOf(str(reportOf(str(r.report))?.body ?? ""))
  return [`[[${r.id}|${str(r.question)}]]`, str(r.answer) ? `answered: ${str(r.answer)}` : str(r.closed) ? `closed: ${str(r.closed)}` : r.blocking ? "waits on you" : `went with ${str(r.default)}`,
    `options: ${optionsText(r, " / ")}`, ...(str(r.from) ? [`from ${str(r.from)}${str(r.where) ? ` (${str(r.where)})` : ""}`] : [])].join(" · ") +
    (why ? `\n  - Why: ${why}` : "") + (gist ? `\n  - Its report: ${gist}` : "")
}

export function decisionsIn(p: string): Item[] {
  const name = baseOf(p)
  const all = plugin.vault.items("inbox").filter((r) => truthy(r.question))
  const own = all.find((r) => `${r.id}.md` === p || r.id === p.replace(/\.md$/, ""))
  if (own) return [own]
  const asks = (r: Item) => baseOf(linkTo(str(r.report))) === name || ((r.also as string[] | undefined) ?? []).some((l) => baseOf(linkTo(l)) === name)
  return sortBy(all.filter(asks), (r) => str(r.created), false)
}

const decisionsOp: Op = {
  id: "inbox.decisions",
  cli: "inbox decisions",
  summary: "The decisions waiting on the user: each question an agent asked, its options and the default it takes; the ones an agent waits on first.",
  help: `Each is a file in Inbox/ (vau docs inbox): a question, its options, its default, and whether its agent waits on it
(blocking) or already went with the default. The user answers with vau inbox decide; recent: the last day's answered and
closed ones too. The companion walks the user through these by voice.

  vau inbox decisions
  vau inbox decisions --recent`,
  kind: "read",
  params: { recent: { type: "boolean", description: "the last day's answered and closed ones too" } },
  run: async ({ recent }) => {
    await plugin.vault.sync()
    const open = sortBy(openDecisions(), (r) => `${r.blocking === true ? 1 : 0}${latest(r)}`, true)
    const since = stampOf(new Date(Date.now() - DAY))
    const past = recent ? plugin.vault.items("inbox").filter((r) => truthy(r.question) && str(r.status) === "done" && str(r.answered || r.modified || "") >= since) : []
    return { decisions: open.map(decisionRow), ...(recent ? { recent: past.map(decisionRow) } : {}) }
  },
  text: (r) => {
    const line = (d: Item, i: number) => `${i + 1}. ${d.blocking ? "[waits on you] " : `[went with ${d.default}] `}${d.question}\n   ${optionsText(d)}` +
      `${d.why ? `\n   ${d.why}` : ""}${d.gist ? `\n   Its report: ${d.gist}` : ""}\n   ${d.path}${d.from ? ` · from ${d.from}` : ""}${d.where ? ` (${d.where})` : ""}${d.snoozed ? ` · snoozed until ${d.snoozed}` : ""}`
    const out = [r.decisions.length ? `Waiting on the user (${r.decisions.length}):\n${r.decisions.map(line).join("\n")}` : "No decision waits on the user."]
    if (r.recent?.length) out.push(`Dealt with in the last day:\n${r.recent.map((d: Item) => `  ${d.question}: ${d.answer ? `answered ${d.answer}` : `closed (${d.closed})`}  (${d.path})`).join("\n")}`)
    return out.join("\n\n")
  },
}

const askOp: Op = {
  id: "inbox.ask",
  home: true,
  cli: "inbox ask",
  owner: "files on this machine",
  lock: false,
  summary: "Ask the user one decision: a question with its options as buttons and the default you take if they don't answer; their answer comes back to this session.",
  help: `A file in Inbox/ the user answers with a tap (or by voice, through the companion). blocking: you're stopped on
it (it comes first, with a toast and a push to the phone); else you've gone with the default already, and it reads "Went
with X; change it?", quietly. The same question open already (from another agent or report) is that one, not a second.
They read it cold: the question names its subject (the feature, the note, never "it" or "the first two steps"), each
option says what it causes after a colon (shown under its button), and why says what it's about and who asks.
Ending a task, ask them in your report instead (vau inbox report --decision). The answer is typed into this session (or
resumes it): a default they kept isn't sent.

  vau inbox ask "Ship the new sidebar to the phone too?" --options "Ship it: the phone gets it today" "Not yet: desktop only for now" \\
    --default "Not yet" --blocking --why "The Lighthouse sidebar job finished on desktop; the phone build is untested."
  vau inbox ask "Keep the quieter island by the notch?" --options "Keep: the spinner shows only on hover" "Go back: it spins all the time" \\
    --default Keep --why "The notch job made the island quieter."`,
  kind: "write",
  params: {
    question: { type: "string", required: true, description: "the question, one sentence that stands alone (the user may not remember the task)" },
    options: { type: "array", items: { type: "string" }, commas: false, required: true, description: "2 to 6 options, each \"<button>: <what it causes, a few words>\"" },
    default: { type: "string", required: true, description: "the option you take (or took) if the user doesn't answer" },
    blocking: { type: "boolean", description: "you wait on it: it comes first and pushes to the phone (default: you went with the default already)" },
    why: { type: "string", required: true, description: "one or two plain sentences: what it's about (which agent, project or note asks) and what the choice changes for them" },
    title: { type: "string", description: "its file's name, a few words (default: the question's)" },
    report: { type: "string", description: "the report it's about (Inbox/<Title>.md)" },
    from: { type: "string", description: "who asks (default: you, as the server knows the caller)" },
    terminal: { type: "string", env: "VAULTITE_TERMINAL", description: "the app terminal you run in (filled in from VAULTITE_TERMINAL)" },
    session: { type: "string", env: "CLAUDE_CODE_SESSION_ID", description: "your session's id, for the answer (filled in from CLAUDE_CODE_SESSION_ID)" },
    agent: { type: "string", env: "VAULTITE_AGENT", description: "who you are (claude, codex): from VAULTITE_AGENT, else the terminal's id" },
  },
  args: ["question"],
  run: async (p, ctx) => {
    const [spec] = specsOf([{ question: p.question, options: p.options, default: p.default, blocking: p.blocking === true, why: p.why, title: p.title }], false)
    const terminal = TERMINAL.test(str(p.terminal).trim()) ? str(p.terminal).trim() : ""
    const session = clip(p.session, 120), agent = clip(p.agent, 40).toLowerCase() || agentOfTerminal(terminal)
    const rep = str(p.report).trim() ? reportOf(str(p.report)) : undefined
    if (str(p.report).trim() && !rep) throw new OpError(`no report ${p.report} in the inbox`, 404)
    const w: Asker = { agent, session, terminal, machine: terminal || session ? await selfMachine() : null, from: str(p.from).trim() || (agent ? agentLabel(agent) : ctx.who.label) }
    const [made] = await askAll(ctx, [spec], w, rep ? baseOf(str(rep.id)) : "", rep ? tldrOf(str(rep.body), true) : "")
    return { ...made, session: !!(terminal || session), ...(spec.warn ? { warn: spec.warn } : {}) }
  },
  text: (r) => (r.merged ? `The same question was open already: ${r.path} (it says you asked it too).` : `Asked: ${r.path}${r.blocking ? " (it comes first, with a push to the phone)" : ""}.`) +
    (r.session ? " Their answer comes back to this session." : "") + (r.warn ? `\nWarning: ${r.warn}` : ""),
  did: (p) => ({ action: "create", text: `Asked ${quoted(p.question)}` }),
}

const decideOp: Op = {
  id: "inbox.decide",
  cli: "inbox decide",
  owner: "the terminal",
  lock: false,
  summary: "Answer a decision for the user (their pick, by its option's words or number), accept its default, accept every default at once, or close one that's moot.",
  help: `The user's answer, as their buttons give it (or their words to the companion): the decision is archived with its
answer, and its agent told when it waits on it or the user changed a default it took (one reply per session, into its
report). A default they keep isn't sent: the agent went with it already. moot closes one that later work settled, saying
why; undo opens it again. Only with the user's own answer: never decide for them.

  vau inbox decide "Inbox/Keep the quieter island.md" "Go back"
  vau inbox decide "Inbox/Keep the quieter island.md" 2
  vau inbox decide "Inbox/Keep the quieter island.md" --default
  vau inbox decide --defaults                     every open decision's default (Accept all defaults)
  vau inbox decide "Inbox/Faces by the notch.md" --moot "The island was removed in 3f2a1c"`,
  kind: "write",
  params: {
    item: { type: "string", description: "the decision (Inbox/<Title>.md, vau inbox decisions lists them)" },
    answer: { type: "string", description: "the user's answer: an option's words or its number; other words are their own answer" },
    default: { type: "boolean", description: "accept its default" },
    defaults: { type: "boolean", description: "accept the default of every open decision (not snoozed ones)" },
    moot: { type: "string", description: "close it without an answer: why it no longer matters" },
    undo: { type: "boolean", description: "open it again (its answer taken back; its agent isn't told)" },
  },
  args: ["item", "answer"],
  run: async (p, ctx) => {
    await plugin.vault.sync()
    const all = p.defaults === true
    const items = all ? openDecisions().filter((r) => !snoozed(str(r.snoozed))) : (() => {
      const r = decisionAt(str(p.item).trim())
      if (!str(p.item).trim()) throw new OpError("`item`: the decision (vau inbox decisions lists them), or --defaults for all")
      if (!r) throw new OpError(`no decision ${p.item} (vau inbox decisions lists them)`, 404)
      return [r]
    })()
    if (p.undo === true) {
      const r = items[0]
      const back = await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { status: "new", archived: false, answer: null, answered: null, closed: null }) as Item
      return { decided: [{ path: `${back.id}.md`, question: str(back.question), reopened: true }], sent: [], failed: [] }
    }
    const moot = str(p.moot).trim()
    if (!all && !moot && p.default !== true && !str(p.answer).trim()) throw new OpError("`answer`: the user's pick (an option's words or number), --default, or --moot \"<why>\"")
    const done: { d: Item; answer: string }[] = [], rows: Item[] = []
    for (const r of items) {
      if (str(r.status) !== "new" || isArchived(r)) throw new OpError(`${r.id}.md was dealt with already${str(r.answer) ? ` (answered ${str(r.answer)})` : ""}: --undo opens it again`, 409)
      if (moot) {
        const out = await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { status: "done", closed: clip(moot, 300) }) as Item
        rows.push({ path: `${out.id}.md`, question: str(r.question), closed: clip(moot, 300) })
        continue
      }
      const answer = all || p.default === true ? str(r.default) : answerOf((r.options as string[]) ?? [], str(p.answer)).answer
      const out = await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { status: "done", answer, answered: nowStamp() }) as Item
      done.push({ d: { ...r, ...out }, answer })
      rows.push({ path: `${out.id}.md`, question: str(r.question), answer, told: !!toldOf(r, answer) })
    }
    const { sent, failed } = await sendAnswers(ctx, done)
    // (an answer may settle another question: the rest are read against it)
    const said = done.map(({ d, answer }) => `${str(d.question)} The user answered: ${answer}`).join("\n")
    if (said && !all) track(closeSettled(ctx, said, "your answer", new Set(done.map(({ d }) => str(d.id)))))
    knocked = Math.min(knocked, openDecisions().length)
    return { decided: rows, sent, failed }
  },
  text: (r) => {
    if (!r.decided.length) return "No decision was open."
    const lines = r.decided.map((d: Item) => `  ${d.reopened ? "Open again" : d.closed ? "Closed" : `Answered ${quoted(d.answer)}`}: ${d.question}${d.told === false ? " (kept the default: nothing to tell)" : ""}`)
    return [`${r.decided.length === 1 ? "Done" : `${r.decided.length} done`}:`, ...lines,
      ...(r.sent.length ? [`Sent to ${r.sent.length === 1 ? "its session" : `${r.sent.length} sessions`}.`] : []), ...(r.failed.length ? [`Couldn't send: ${r.failed.join("; ")}`] : [])].join("\n")
  },
  did: (p) => ({ action: "edit", text: p.defaults ? "Accepted every default" : `Decided ${quoted(str(p.item))}` }),
}

export function register() {
  plugin.onUnload(() => { if (knockTimer) clearTimeout(knockTimer) })
  plugin.op(decisionsOp)
  plugin.op(askOp)
  plugin.op(decideOp)
}
