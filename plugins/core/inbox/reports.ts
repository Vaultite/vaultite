import fs from "node:fs"
import path from "node:path"
import { localDate, type Op, OpError } from "../../../core/plugins.ts"
import { isArchived, type Item, nowStamp, safeName, sortBy, str, truthy } from "../../../core/vault.ts"
import { askAll, type Asker, baseOf, closeSettled, decisionAt, specsOf } from "./asked.ts"
import { ending, handed } from "./handed.ts"
import { clip, TERMINAL } from "./model.ts"
import { editBody, latest, withTldr } from "./results.ts"
import { agentOfTerminal, DAY, plugin, selfMachine } from "./server.ts"
import { rowOf } from "./rows.ts"
import { agentLabel, sessionRow, track } from "./sessions.ts"
import { stampOf } from "./snooze.ts"
import { addEvent, list } from "./store.ts"

/** What a report is about and where it stands, said first in its title ("Feature done · Sidebar scrolls again"), so
 *  the inbox reads at a glance. */
const WORK: Record<string, string> = { feature: "Feature", fix: "Fix", change: "Change", research: "Research", plan: "Plan", answer: "Answer" }
const STATE: Record<string, string> = { done: "done", waiting: "needs you", stuck: "stuck" }
const reportTitle = (work: string, state: string, title: string) => `${WORK[work] ?? "Work"} ${STATE[state] ?? state} · ${title}`
/** What a report's title is about, without its work and state ("Sidebar scrolls again"); a title named by hand whole. */
const subjectOf = (title: string) => {
  const m = /^(\S+) (.+?) · (.+)$/.exec(title)
  return m && Object.values(WORK).concat("Work").includes(m[1]) && Object.values(STATE).includes(m[2]) ? m[3] : title
}

const IMAGE = /\.(png|jpe?g|gif|webp)$/i, VIDEO = /\.(mp4|m4v|mov|webm)$/i
export const REPLY_BLOCK = "```block-reply\n```"
const DECISIONS_BLOCK = "```block-decisions\n```"
/** A report's details at most (about 1,500 words): a report reads in a minute; files hold the rest. */
const SUMMARY_MAX = 10_000
const folded = (title: string, md: string) => `> [!info]- ${title}\n${md.trim().split(/\r?\n/).map((l) => `> ${l}`.trimEnd()).join("\n")}`

const reportsOp: Op = {
  id: "inbox.reports",
  cli: "inbox reports",
  summary: "The reports agents filed lately, one line each linking the whole report: what the morning brief's digest lists (results go there, not in the inbox).",
  help: `Each report agents ended a task with (vau inbox report), since a time (default: the last day), newest first, as
one line: its title and TL;DR, linked. The morning brief puts these under its digest. A failed one, or one that went out
publicly, stayed in the inbox and says so.

  vau inbox reports
  vau inbox reports --since 2026-11-06`,
  kind: "read",
  params: { since: { type: "string", description: "from when: YYYY-MM-DD, a local stamp, or a span back (12h, 2d; default 24h)" } },
  run: async ({ since }) => {
    await plugin.vault.sync()
    const s = str(since).trim()
    const span = /^(\d+)\s*([hd])$/.exec(s)
    const from = !s ? stampOf(new Date(Date.now() - DAY)) : span ? stampOf(new Date(Date.now() - Number(span[1]) * (span[2] === "d" ? DAY : 3600_000))) : /^\d{4}-\d\d-\d\d/.test(s) ? s : null
    if (!from) throw new OpError(`since: YYYY-MM-DD, a local stamp or a span back (12h, 2d), not ${s}`)
    const rs = sortBy(plugin.vault.items("inbox").filter((r) => !truthy(r.question) && truthy(r.work || r.agent || r.session || r.terminal) && latest(r) >= from), latest, true)
    return { since: from, reports: rs.map((r) => ({ path: `${r.id}.md`, title: str(r.title), tldr: str(r.tldr) || null, at: latest(r), inbox: str(r.status) === "new" && !isArchived(r) })) }
  },
  text: (r) => r.reports.length
    ? r.reports.map((x: Item) => `- [[${baseOf(str(x.path))}]]${x.tldr ? `: ${x.tldr}` : ""}${x.inbox ? " (in the inbox)" : ""}`).join("\n")
    : `No reports since ${r.since}.`,
}

const progressOp: Op = {
  id: "inbox.progress",
  home: true,
  cli: "inbox progress",
  owner: "files on this machine",
  lock: false,
  summary: "Say how your work goes (a check-in, still working, a step done): your session's row shows it, each line replacing the last; never told, never in the inbox.",
  help: `For what a watcher or a long task would have said in a report ("still working", "two of five fixes in"): it goes
on your own row in the Agents panel, not to the user. The inbox is for decisions: a question
is vau inbox ask, the end of a task vau inbox report.

  vau inbox progress "Two of five fixes in; CI running on the third"`,
  kind: "write",
  params: {
    text: { type: "string", required: true, description: "where it stands, one line" },
    terminal: { type: "string", env: "VAULTITE_TERMINAL", description: "the app terminal you run in (filled in from VAULTITE_TERMINAL)" },
    session: { type: "string", env: "CLAUDE_CODE_SESSION_ID", description: "your session's id (filled in from CLAUDE_CODE_SESSION_ID)" },
    agent: { type: "string", env: "VAULTITE_AGENT", description: "who you are (claude, codex): from VAULTITE_AGENT, else the terminal's id" },
  },
  args: ["text"],
  run: async (p) => {
    const terminal = TERMINAL.test(str(p.terminal).trim()) ? str(p.terminal).trim() : ""
    const session = clip(p.session, 120), agent = clip(p.agent, 40).toLowerCase() || agentOfTerminal(terminal)
    if (!terminal && !session) throw new OpError("progress is a session's: run it in an app terminal (VAULTITE_TERMINAL), or give --session")
    const text = clip(p.text, 300)
    if (!text) throw new OpError("`text`: where it stands, one line")
    const who = { agent: agent || "vau", terminal, session }
    const row = list().find(rowOf(who))
    // (a row that needs the user stays as it is: only its line changes)
    await sessionRow(who, { progress: text, ...(!row || row.state === "done" ? { state: "working" as const, read: true } : {}) }, false)
    return { ok: true, progress: text }
  },
  text: () => "Shown on your row.",
}

const reportOp: Op = {
  id: "inbox.report",
  home: true,
  cli: "inbox report",
  owner: "files on this machine",
  lock: false,
  summary: "End a task you were handed (a voice note, a dispatch) with a report: a one-line TL;DR, each question for the user as its own decision (options and the default you take), the details folded; the user replies from it into this session.",
  help: `The report is a record, not an inbox item: it goes straight to the archive, and the morning brief lists it in one
line (its TL;DR, linked). What reaches the user's inbox is each decision: a question with its options as buttons and
the default you take if they don't answer. Write it in this order, short:
- tldr: one line, what happened in plain words (the brief and the push say it).
- decision: one per question only the user can settle, never prose questions in the summary. Text "Question? | Option:
  what it causes* | Option: what it causes | why: <what it's about, who asks>" (* marks the default) or JSON {"question",
  "options", "default", "why", "blocking"}. They read it cold, without the report: name its subject. You've gone with its
  default already: it reads "Went with X; change it?", quietly. blocking (or --state waiting for the text ones): you
  stop until they answer; it comes first and pushes to the phone. A question already open (yours or another agent's) is
  the same decision, not a second one.
- summary: the details, folded under the TL;DR: what was asked (link the note), what you did, where (files, repo,
  branch, commit), what's left; enough for a new session to pick it up. At most about 1,500 words: link files for more.
- settles: decisions this work answered or made moot (their paths): they close, saying so.
Stuck (couldn't finish) or public (it went out where others see it: a release, a post, a message) keeps it in the inbox
too, told. Progress on the way is vau inbox progress, never a report.
Its session is named (VAULTITE_TERMINAL, CLAUDE_CODE_SESSION_ID): the user's answers and replies come back here (this
session resumed, or a new one once its context is no longer cached). Handed a task to do alone, your terminal ends once
this turn does: report last. Your session's next report goes on in the same file: one file per exchange. The title
starts with the work and where it stands: "Feature done · Sidebar scrolls again".

  vau inbox report "Sidebar scrolls again" --work fix --tldr "The left sidebar scrolls again, live on the M1." \\
    --summary "The sidebar's list had ..." \\
    --decision "Ship the sidebar fix to the phone too? | Yes: the phone gets it today | Not yet: desktop only for now* | why: It's live on desktop; the phone build is untested." \\
    --images /tmp/before.png /tmp/after.png
A job with a proof embeds its demo video: --video <the path tour-save gave> (Guides/Proofs/...).`,
  kind: "write",
  params: {
    title: { type: "string", required: true, description: "what was done, in a few words, in sentence case (after the work and state: Feature done · <title>)" },
    work: { type: "string", enum: Object.keys(WORK), required: true, description: "what kind of work: feature, fix, change (a refactor, a setting, a cleanup), research, plan (a proposal to approve), answer" },
    state: { type: "string", enum: Object.keys(STATE), description: "where it stands: done, waiting (you stop on its decisions), stuck (couldn't finish); waiting when a decision is blocking, else done" },
    tldr: { type: "string", required: true, description: "one line on top: what happened, in plain words (at most about 60 words)" },
    summary: { type: "string", required: true, description: "the details, folded: what you did and where to look, as Markdown" },
    decision: { type: "array", items: { description: "\"Question? | Option: what it causes* | Option: what it causes | why: <context>\" (* the default), or {question, options, default, why, blocking?}" }, commas: false,
      description: "each question for the user, its options (each saying what it causes), the default you take and a why: one decision each" },
    settles: { type: "array", items: { type: "string" }, commas: false, description: "decisions this work settled (Inbox/<Title>.md): closed, saying so" },
    public: { type: "boolean", description: "it went out where others see it (a release, a post, a message): the report stays in the inbox, told" },
    digest: { type: "boolean", description: "this report is the user's daily digest itself (the morning brief): it stays in the inbox, told" },
    images: { type: "array", items: { type: "string" }, description: "screenshots: files on this machine (absolute paths) or in the vault (png, jpg, gif, webp)" },
    video: { type: "string", description: "a demo video, embedded above the screenshots: a job's proof (its vault path, Guides/Proofs/...) or a file on this machine (mp4, mov, webm)" },
    terminal: { type: "string", env: "VAULTITE_TERMINAL", description: "the app terminal you run in (filled in from VAULTITE_TERMINAL)" },
    session: { type: "string", env: "CLAUDE_CODE_SESSION_ID", description: "your session's id, to resume it (filled in from CLAUDE_CODE_SESSION_ID)" },
    agent: { type: "string", env: "VAULTITE_AGENT", description: "who you are (claude, codex): from VAULTITE_AGENT (a chat session's), else the terminal's id" },
  },
  args: ["title"],
  run: async (p, ctx) => {
    const summary = str(p.summary).trim(), tldr = clip(p.tldr)
    if (!summary) throw new OpError("`summary`: what you did and where to look")
    if (!tldr) throw new OpError("`tldr`: what happened, one line in plain words")
    if (tldr.length > 400) throw new OpError(`\`tldr\`: one line, at most about 60 words (it's ${tldr.split(" ").length}): the rest goes in summary`)
    // (the daily digest is the one long read: three times as long)
    if (summary.length > SUMMARY_MAX * (p.digest === true ? 3 : 1)) throw new OpError(`\`summary\`: at most about 1,500 words (it's ${summary.split(/\s+/).length}): keep what a new session needs, link files for the rest`)
    const specs = specsOf(p.decision, p.state === "waiting")
    const settles = ((p.settles ?? []) as string[]).map((x) => str(x).trim()).filter(Boolean)
    const missing = settles.filter((x) => !decisionAt(x))
    if (missing.length) throw new OpError(`settles: no decision ${missing.join(", ")} (vau inbox decisions lists them)`, 404)
    const state = str(p.state) || (specs.some((d) => d.blocking) ? "waiting" : "done")
    const title = reportTitle(str(p.work), state, str(p.title).trim())
    // What reaches the inbox: a failure, what went out publicly, the daily digest; the rest is a record, archived.
    const told = state === "stuck" || p.public === true || p.digest === true
    const images: string[] = []
    for (const given of (p.images ?? []) as string[]) {
      const f = given.trim()
      if (!IMAGE.test(f)) throw new OpError(`${f}: a screenshot is a png, jpg, gif or webp`)
      if (!path.isAbsolute(f)) {
        if (!fs.existsSync(plugin.vault.abs(f))) throw new OpError(`no ${f} in the vault (a file on this machine: its absolute path)`)
        images.push(f)
        continue
      }
      let data: Buffer
      try { data = fs.readFileSync(f) } catch { throw new OpError(`can't read ${f}`) }
      // (named for the day and the report: agents' "after.png" from different tasks never take each other's place)
      const name = `${localDate(Date.now())} ${safeName(str(p.title).trim()).slice(0, 50).trim()} - ${path.basename(f)}`
      const up = await ctx.op("file.upload", { data: data.toString("base64"), name }) as { path: string }
      images.push(up.path)
    }
    // (a demo video: one in the vault by its path, as its name may be any proof's; one on this machine uploaded)
    let video = str(p.video).trim()
    if (video) {
      if (!VIDEO.test(video)) throw new OpError(`${video}: a video is an mp4, mov or webm`)
      if (!path.isAbsolute(video)) { if (!fs.existsSync(plugin.vault.abs(video))) throw new OpError(`no ${video} in the vault (a file on this machine: its absolute path)`) }
      else {
        let data: Buffer
        try { data = fs.readFileSync(video) } catch { throw new OpError(`can't read ${video}`) }
        video = (await ctx.op("file.upload", { data: data.toString("base64"), name: `${localDate(Date.now())} ${safeName(str(p.title).trim()).slice(0, 50).trim()} - ${path.basename(video)}` }) as { path: string }).path
      }
    }
    const terminal = TERMINAL.test(str(p.terminal).trim()) ? str(p.terminal).trim() : ""
    const session = clip(p.session, 120)
    const agent = clip(p.agent, 40).toLowerCase() || agentOfTerminal(terminal)
    const machine = terminal || session ? await selfMachine() : null
    if (terminal && handed().includes(terminal)) ending.set(terminal, Date.now())
    const who = { ...(agent ? { agent } : {}), ...(session ? { session } : {}), ...(terminal ? { terminal } : {}), ...(machine ? { machine } : {}) }
    // The same session's report before (the one the user replied to): this one goes on in it, so an exchange is one file.
    await plugin.vault.sync()
    const prior = sortBy(plugin.vault.items("inbox").filter((x) => !truthy(x.question) && ((terminal && str(x.terminal) === terminal) || (session && str(x.session) === session))),
      latest, true)[0]
    const decisions = specs.length && !(prior && str(prior.body).includes(DECISIONS_BLOCK)) ? DECISIONS_BLOCK : ""
    const round = (head: string) => [withTldr(tldr, ""), head, decisions, video ? `![[${video}]]` : "",
      images.length ? images.map((i) => `![[${path.posix.basename(i)}]]`).join("\n") : "", folded("Details", summary)].filter(Boolean).join("\n\n")
    let r: Item
    if (prior) {
      await editBody(prior.id, (body) => {
        const next = `## ${title}\n\n${round("")}\n\n`
        const at = body.lastIndexOf(REPLY_BLOCK)
        return at < 0 ? `${body.replace(/\n*$/, "")}\n\n${next}${REPLY_BLOCK}\n` : body.slice(0, at) + next + body.slice(at)
      })
      r = await ctx.api("PUT", `inbox/${encodeURIComponent(prior.id)}`, { status: told ? "new" : "done", updated: nowStamp(), snoozed: null, title: reportTitle(str(p.work), state, subjectOf(str(prior.title))), ...who }) as Item
    } else {
      r = await ctx.api("POST", "inbox", { title, work: str(p.work), body: [round(""), terminal || session ? REPLY_BLOCK : ""].filter(Boolean).join("\n\n"), from: agent ? agentLabel(agent) : ctx.who.label, ...who }) as Item
      if (!told) r = await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { status: "done" }) as Item
    }
    const file = `${r.id}.md`
    const w: Asker = { agent, session, terminal, machine, from: agent ? agentLabel(agent) : ctx.who.label }
    const asked = specs.length ? await askAll(ctx, specs, w, baseOf(str(r.id)), tldr) : []
    const closed: string[] = []
    for (const x of settles) {
      const d = decisionAt(x)
      if (!d || str(d.status) !== "new" || isArchived(d)) continue
      await ctx.api("PUT", `inbox/${encodeURIComponent(d.id)}`, { status: "done", closed: clip(`Settled by [[${baseOf(str(r.id))}]]`, 300) })
      closed.push(`${d.id}.md`)
    }
    // Its session's thread is the report: needing the user when it's told, else done with it, quietly (the record is the
    // report, its questions the decisions).
    const report = told
      ? { state: "open" as const, ask: "report", title: str(r.title), body: tldr, link: file, read: false, questions: undefined }
      : { state: "done" as const, ask: "report", title: str(r.title), body: tldr, link: file, read: true, questions: undefined, progress: undefined }
    if (terminal || session) await sessionRow({ agent: agent || "vau", terminal, session }, report, told)
    else if (told) addEvent({ source: agent || "vau", kind: "waiting", ...report })
    // (later work settles what was asked before it: the rest are read against this report)
    track(closeSettled(ctx, `${tldr}\n\n${summary}`, `[[${baseOf(str(r.id))}]]`, new Set(asked.map((x) => x.path.replace(/\.md$/, "")))))
    const warn = specs.map((d) => d.warn).filter(Boolean)
    return { path: file, title: r.title, inbox: told, decisions: asked, closed, ...(warn.length ? { warn } : {}), images, ...(video ? { video } : {}), terminal: terminal || null, session: session || null, ...(prior ? { thread: true } : {}) }
  },
  text: (r) => [`Reported: ${r.path}${r.thread ? " (added to this session's report before)" : ""}, ${r.inbox ? "in the user's inbox" : "archived (the morning brief lists it)"}.`,
    ...r.decisions.map((d: Item) => `  ${d.merged ? "Same as one open already" : d.blocking ? "Asked, waiting on it" : "Asked"}: ${d.question} (${d.path})`),
    ...((r.warn ?? []) as string[]).map((w) => `Warning: ${w}`),
    ...r.closed.map((c: string) => `  Closed: ${c}`),
    r.terminal || r.session ? `Their answers come back to this session${r.terminal && ending.has(r.terminal) ? "; this terminal ends when this turn does." : "."}` : ""].filter(Boolean).join("\n"),
}

export function register() {
  plugin.op(reportsOp)
  plugin.op(progressOp)
  plugin.op(reportOp)
}
