import { bullets, fmtAgo, stampMs } from "../../../core/plugins.ts"
import { str } from "../../../core/vault.ts"
import { decisionLine, decisionsIn } from "./asked.ts"
import { asResults, latest, resultAt } from "./results.ts"
import { clip, plugin } from "./server.ts"
import { shown } from "./store.ts"
import { lists, waitsOnYou } from "./threads.ts"

const stampAt = (s: unknown) => stampMs(str(s)) || 0

export function register() {
  plugin.block("inbox", (ctx) => {
    const o = ctx.options
    const nr = Number(o.results ?? 10), ne = Number(o.events ?? 5)
    const l = lists(plugin.isOff() ? [] : shown(), asResults(plugin.vault.items("inbox")))
    const results = [...l.pinned.results, ...l.review].slice(0, nr)
    // (what's pinned and what needs the user first, then messages: what agents work on is the Agents panel's)
    const es = [...l.pinned.events, ...l.needs, ...l.messages].slice(0, ne)
    ctx.source([...l.decisions, ...(nr > 0 ? results : [])])
    const parts: string[] = []
    if (l.decisions.length) parts.push(`Decisions:\n${bullets(l.decisions.map(decisionLine))}`)
    if (ne > 0 && es.length) {
      parts.push(`From your agents:\n${bullets(es.map((e) => [fmtAgo(e.t), `${e.title}${e.preview || e.body ? `: ${clip(e.preview || e.body, 200)}` : ""}`,
      e.pinned && "pinned", waitsOnYou(e) ? "needs you" : e.state === "working" ? "working on it" : !e.read && "unread", e.machineLabel && `on ${e.machineLabel}`].filter(Boolean).join(" · ")))}`)
    }
    if (nr > 0 && results.length) {
      parts.push(`To review:\n${bullets(results.map((r) => [`[[${r.id}|${r.title}]]`, r.from && `from ${r.from}`, latest(r) && fmtAgo(stampAt(latest(r)))].filter(Boolean).join(" · ")))}`)
    }
    return [`## ${str(o.title) || "Inbox"}`, parts.length ? parts.join("\n\n") : "_Nothing needs you. When an agent asks you something or leaves you a report, it shows here._"].join("\n\n")
  })

  plugin.block("decisions", (ctx) => {
    const ds = decisionsIn(ctx.path)
    ctx.source(ds)
    if (!ds.length) return "_The decisions a report asks the user, each with its options (inbox.report writes them)._"
    return `${bullets(ds.map(decisionLine))}\n\n_Answer one: \`vau inbox decide "<its path>" "<option>"\`._`
  })

  plugin.block("reply", (ctx) => {
    const r = resultAt(ctx.path)
    if (!r || !(r.terminal || r.session)) return "_A reply box, for an agent's report (inbox.report writes one)._"
    ctx.source([r])
    return `_Reply to ${str(r.from) || "the agent"}: \`vau inbox reply "${ctx.path}" "<text>"\` types it into its session${r.terminal ? ` (${r.terminal})` : ""}._`
  })
}
