import { localTime, type Op, quoted } from "../../../core/plugins.ts"
import { type Item, str } from "../../../core/vault.ts"
import { decisionRow } from "./asked.ts"
import { type InboxEvent } from "./model.ts"
import { asResults, withTldr } from "./results.ts"
import { clip, plugin } from "./server.ts"
import { NEEDS } from "./sessions.ts"
import { stampOf } from "./snooze.ts"
import { lists } from "./threads.ts"

const listOp: Op = {
  id: "inbox.list",
  cli: "inbox",
  mcp: "inbox",
  summary: "What's in the inbox: what needs the user (agents' sessions asking, answering or reporting; requests), results to review (Inbox/), what agents are working on since the user answered, and messages to read, newest first.",
  help: `A coding agent's session is one thread, its report (a file in Inbox/) its record: open (needs you) while it asks
something, its last answer or report is for the user, or it failed; working once they answer; done once a turn after
ends with nothing for them, or they mark it done. Reading never settles a thread (* is unread); a message (vau notify)
is done once read. Results are files in Inbox/ to review. Events are kept on the machine they happened on (another
machine's id ends in @<machine>), done ones for keep_days, each with its id (inbox.settle, inbox.answer, inbox.reply,
inbox.snooze take it). done: the latest done ones too.

  vau inbox
  vau inbox --done`,
  kind: "read",
  params: {
    limit: { type: "integer", minimum: 1, default: 20, description: "at most this many in each list" },
    done: { type: "boolean", description: "the latest done events too" },
  },
  run: async ({ limit, done }, ctx) => {
    const [ev, items] = await Promise.all([ctx.api("GET", "inbox/events?all=1"), ctx.api("GET", "inbox")]) as [Item, Item[]]
    // (a report whose thread is listed is that thread's: one row a session)
    const l = lists(ev.events as InboxEvent[], asResults(items ?? []))
    const row = (r: Item) => ({ path: `${r.id}.md`, title: r.title, from: r.from ?? null, created: r.created ?? null, updated: r.updated ?? null })
    const cut = <T>(xs: T[]) => xs.slice(0, limit)
    return { decisions: cut(l.decisions.map(decisionRow)), pinned: [...l.pinned.events, ...l.pinned.results.map(row)], needs: cut(l.needs), results: cut(l.review.map(row)), working: cut(l.working), messages: cut(l.messages),
      snoozed: [...l.snoozed.results.map((r) => ({ ...row(r), until: str(r.snoozed) })),
        ...l.snoozed.events.map((e) => ({ id: e.id, title: e.title, until: stampOf(new Date(e.snoozed!)) }))],
      done: done ? cut(l.done.events) : l.done.events.length }
  },
  text: (r) => {
    const out: string[] = []
    const line = (e: InboxEvent) => `  ${localTime(e.t)}  ${e.read ? " " : "*"} ${e.title}${e.state === "open" && e.ask ? ` [${NEEDS[e.ask] ?? e.ask}]` : ""}` +
      `${e.preview || e.body ? `: ${clip(e.preview || e.body, 160)}` : ""}${e.machineLabel ? ` (on ${e.machineLabel})` : ""}  (${e.id})`
    const list = (title: string, xs: string[]) => { if (xs.length) out.push(`${out.length ? "\n" : ""}${title}:`, ...xs) }
    list("Decisions", r.decisions.map((d: Item) => `  ${d.blocking ? "[waits on you]" : `[went with ${d.default}]`} ${d.question}  (${d.path})`))
    list("Pinned", r.pinned.map((x: Item) => (x.path ? `  ${x.path}${x.from ? `  (from ${x.from})` : ""}` : line(x as InboxEvent))))
    list("Needs you", r.needs.map(line))
    list("To review", r.results.map((x: Item) => `  ${x.path}${x.from ? `  (from ${x.from})` : ""}`))
    list("Working on it", r.working.map((e: InboxEvent) => (e.progress ? line({ ...e, preview: e.progress }) : line(e))))
    list("Messages", r.messages.map(line))
    list("Snoozed", r.snoozed.map((x: Item) => `  until ${x.until}  ${x.path ?? `${x.title}  (${x.id})`}`))
    if (Array.isArray(r.done)) list("Settled", r.done.map(line))
    else if (r.done) out.push(`${out.length ? "\n" : ""}Settled: ${r.done} (vau inbox --done lists them).`)
    if (r.decisions.length) out.push(`\nAnswer one: vau inbox decide <path> <answer> (vau inbox decisions has their options).`)
    return out.length ? out.join("\n") : "Nothing new."
  },
}

const addOp: Op = {
  id: "inbox.add",
  home: true,
  cli: "inbox add",
  mcp: "inbox_add",
  summary: "Leave something in the user's inbox to review later: research you did, a summary, a draft, links worth reading.",
  help: `A Markdown file in Inbox/, marked new: the user gets a toast and a badge, then marks it done (into Inbox/.archive/) or
files it into a folder. For what they should look at, not facts to remember (people.remember) or notes they asked for
(note.create). For a web page, clipper.save with inbox keeps its content. From a terminal the body may come on stdin.
tldr goes on top, so the user knows what it says before reading it: two or three plain sentences, no jargon.

  vau inbox add "Plant care apps compared" --tldr "Planta is the best fit: ..." --body "## Findings ..."
  echo "## Findings" | vau inbox add "Plant care apps compared"`,
  kind: "write",
  params: {
    title: { type: "string", required: true, description: "its title (the file's name), in sentence case" },
    body: { type: "string", stdin: true, description: "what it says, as Markdown (## headings, bullets, links)" },
    tldr: { type: "string", description: "what it says in short, on top: two or three plain sentences the user reads first" },
    source: { type: "string", description: "where it came from, when it's about one page: its address" },
    from: { type: "string", description: "who it's from (default: you, as the server knows the caller)" },
    do: { type: "string", description: "a task a worker could do alone, standing alone: the item gets a Do it that hands it over (a suggestion)" },
  },
  args: ["title"],
  run: async (p, ctx) => {
    const r = await ctx.api("POST", "inbox", { title: p.title.trim(), body: withTldr(str(p.tldr), str(p.body).trim()), from: str(p.from).trim() || ctx.who.label,
      ...(str(p.source).trim() ? { source: str(p.source).trim() } : {}), ...(str(p.do).trim() ? { do: str(p.do).trim() } : {}) })
    return { path: `${r.id}.md`, title: r.title }
  },
  text: (r) => `In the user's inbox: ${r.path} (they'll see it marked new).`,
  did: (p) => ({ action: "create", text: `Left ${quoted(p.title)} in the inbox` }),
}

export function register() {
  plugin.op(listOp)
  plugin.op(addOp)
}
