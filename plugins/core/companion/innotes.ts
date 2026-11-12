import fs from "node:fs"
import { byUser, OpError } from "../../../core/plugins.ts"
import "./wiring.ts"
import { plugin } from "./self.ts"
import { str } from "./settings.ts"
import { asking, notes, did, MAX_TEXT, broadcast, key, focus, setAgent, putNote, dropNote } from "./state.ts"
import { past, save, place, fold, reopen } from "./comments.ts"
import { streams, toolUse, cut, lineText } from "./edits.ts"
import { AS, PATH, LINE, FIND, target, notOnDrawing, who } from "./args.ts"

/** The open task line `line` (1-based) of `src`, or the only one with `text`: its index, or -1. */
export function openTaskLine(src: string, line: number, text: string) {
  const lines = src.split("\n"), open = (l: string | undefined) => !!l && /^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s/.test(l) && (!text || l.includes(text))
  if (open(lines[line - 1])) return line - 1
  const all = lines.flatMap((l, i) => (open(l) ? [i] : []))
  return all.length === 1 ? all[0] : -1
}

const queues = new Map<string, Promise<unknown>>()
/** `fn` once the last one under `key` has ended, however it ended. */
function oneAtATime<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(fn, fn), tail = run.catch(() => {})
  queues.set(key, tail)
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key) })
  return run
}

plugin.op({
  id: "companion.do",
  cli: "companion do",
  summary: "Do it: hand a task to a worker, as the Do it on a task line does: a line of a note goes in progress ([/]), and the worker ticks it when it's done.",
  help: `What a user's tap on Do it runs: a line of a note (path, line; text, its words, finds it if it moved), or only words. The worker
starts at once through companion handoff.

  vau companion do --path Notes/Trip.md --line 12
  vau companion do --text "Compare the two flights in Notes/Trip.md"`,
  kind: "write",
  lock: false,
  params: { path: { type: "string", format: "path", description: "the note the task is in (Notes/Trip.md)" }, line: { type: "integer", minimum: 1, description: "its line, from 1" },
    text: { type: "string", description: "the task's words; without a path, all there is to go on" } },
  run: async (p, ctx) => {
    const rel = str(p.path), words = str(p.text).trim()
    if (!rel && !words) throw new OpError("say what: a note's path and line, or the task's text")
    // (set inside the queue: typed so it isn't read as always null after it)
    let line = "", at = 0, mark = null as { old: string; new: string } | null
    // (one tap at a time per note: two edits alike both merge, so two that read it open would both start a worker)
    if (rel) await oneAtATime(`do:${rel}`, async () => {
      const src = fs.readFileSync(plugin.vault.abs(rel), "utf8"), i = openTaskLine(src, Number(p.line) || 0, words), lines = src.split("\n")
      if (i < 0) throw new OpError(`no open task ${words ? `"${cut(words, 60)}" ` : ""}at line ${p.line} of ${rel}`, 404)
      line = lines[i]
      at = i + 1
      // In progress first: a second tap (another device's) finds it taken, and two workers never start.
      let before = ""
      // (the lines above it tell twins apart)
      for (let k = i - 1; k >= 0 && src.indexOf(before + line) !== src.lastIndexOf(before + line); k--) before = `${lines[k]}\n${before}`
      mark = { old: before + line, new: before + line.replace("[ ]", "[/]") }
      await ctx.op("file.edit", { path: rel, ...mark }).catch(() => { throw new OpError(`that task was just handed over, or changed: ${cut(line.trim(), 60)}`, 409) })
    })
    const said = rel ? line.replace(/^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s+/, "") : words
    const task = rel
      ? [`Do this task from the note ${rel} (line ${at}): ${said}`, "Read the note first: it's the context. When it's fully done, mark the line done (tasks_complete, or `[x]` with vau edit). If it needs the user (a decision, a sign-in, anything outward like a post or a message), leave it open and say what you need."].join("\n\n")
      : [`Do this: ${said}`, "If it needs the user (a decision, a sign-in, anything outward like a post or a message), stop and say what you need."].join("\n\n")
    try {
      return await ctx.op("companion.handoff", { task, say: `On it: ${cut(said, 60)}`, title: cut(said, 80) })
    } catch (e) {
      // (nobody's on it: the line's open again)
      if (mark) await ctx.op("file.edit", { path: rel, old: mark.new, new: mark.old }).catch(() => {})
      throw e
    }
  },
  text: (r) => `Handed off (${r.id}): "${r.title}", ${r.state}.`,
  did: (p) => ({ action: "run", text: `Do it: ${JSON.stringify(cut(str(p.text) || `${str(p.path)}:${p.line}`, 60))}` }),
})

plugin.op({
  id: "companion.pass",
  cli: "companion pass",
  summary: "Let what you were handed pass, saying why in a few words: the user sees it by your cursor's seen tick.",
  help: `When you choose not to act on a moment (not for you, they're still writing), rather than ending your turn in silence.

  vau companion pass "not for me"
  vau companion pass "waiting for you to finish"`,
  kind: "read",
  params: { reason: { type: "string", required: true, description: "why, in a few words (lower case, no period)" }, as: AS },
  args: ["reason"],
  run: async (p) => {
    const name = who(p), why = cut(str(p.reason).trim().replace(/[.\s]+$/, ""), 40)
    did(name, "pass")
    asking.delete(key(name))
    setAgent(name, { seen: true, ...(why ? { why } : {}) })
    return { why }
  },
  text: () => "Passed: end your turn.",
})

plugin.op({
  id: "companion.place",
  cli: "companion place",
  summary: "Put an agent's bubble in the note, as its words: after the paragraph it was said by (the user's call, Put in note).",
  kind: "write",
  lock: false,
  params: { id: { type: "string", required: true, description: "the bubble (a say's id)" } },
  args: ["id"],
  run: async (p, ctx) => {
    if (!byUser(ctx.who)) throw new OpError("only the user moves an agent's words (Put in note on its bubble)", 403)
    return await place(str(p.id))
  },
  text: (r) => `Put in ${r.path} at line ${r.line}.`,
})

plugin.op({
  id: "companion.fold",
  cli: "companion fold",
  summary: "Show what an agent wrote in a note as its bubble instead (the app takes its lines out of the note): the user's call.",
  kind: "write",
  lock: false,
  params: { as: { type: "string", required: true, description: "the agent that wrote it" }, path: { type: "string", required: true, format: "path", description: "the note" },
    line: LINE, text: { type: "string", required: true, description: "what it wrote" } },
  run: async (p, ctx) => {
    if (!byUser(ctx.who)) throw new OpError("only the user moves an agent's words (Fold into a bubble)", 403)
    const n = fold(str(p.as), str(p.path), Number(p.line) || 1, str(p.text).slice(0, MAX_TEXT))
    return { id: n.id }
  },
  text: (r) => `Folded into bubble ${r.id}.`,
})

plugin.op({
  id: "companion.comment",
  cli: "companion comment",
  summary: "Leave a comment in the margin by a line, until the user dismisses it; they can reply (a reply moment).",
  help: `For what's worth keeping a moment: an answer to their ask, a thought on what they wrote. Replying to their reply to
it: with id (the comment's), your words join its thread.

  vau companion comment "Alice moved this to Thursday." --path Notes/Plans.md --find "Meet Alice"
  vau companion comment "Yes, both work." --id n12`,
  kind: "write",
  lock: false,
  // (its place before its words: the model writes them in this order, so its card shows them as they come)
  params: { id: { type: "string", description: "a comment to reply in" }, path: PATH, line: LINE, find: FIND,
    text: { type: "string", required: true, description: "the comment (Markdown, short)" }, as: AS },
  args: ["text"],
  run: async (p) => {
    const name = who(p)
    did(name, "comment")
    // (shown as it was written: that card or reply, with its words as the call has them)
    const use = toolUse.getStore(), s = use ? streams.get(use) : undefined
    // (dismissed as it was written: it stays dismissed, with all its words)
    const gone = s?.reply && !notes.has(s.reply.id) ? s.reply.id : s?.note && !notes.has(s.note) ? s.note : undefined
    if (gone) {
      const n = [...past.values()].flat().find((x) => x.id === gone)
      if (!n) return { id: gone }
      const r = s!.reply && n.replies?.[s!.reply.at]
      if (r) r.text = str(p.text); else if (!s!.reply) n.text = str(p.text)
      save(n.path!)
      return n
    }
    if (s?.reply && notes.get(s.reply.id)?.replies?.[s.reply.at]) {
      const n = notes.get(s.reply.id)!
      n.replies![s.reply.at].text = str(p.text)
      broadcast({ t: "note", note: n })
      save(n.path!)
      return n
    }
    const shown = s?.note ? notes.get(s.note) : undefined
    // (a reply after all, its id after its words: the card its words showed in goes)
    if (shown && p.id) { s!.note = undefined; dropNote(shown.id) }
    else if (shown) {
      const t = target(p), anchor = !t.find && t.line ? lineText(t.path!, t.line) : ""
      Object.assign(shown, { text: str(p.text), ...t, ...(anchor ? { anchor } : {}) })
      broadcast({ t: "note", note: shown })
      save(shown.path!)
      return shown
    }
    if (p.id) {
      // (a word in a dismissed thread brings it back to the margin)
      const n = notes.get(p.id) ?? reopen(p.id)
      if (!n || n.kind !== "comment") throw new OpError(`there's no comment ${p.id}`, 404)
      n.replies = [...(n.replies ?? []), { by: "agent", text: str(p.text), t: Date.now(), ...(n.by ? { name } : {}) }]
      broadcast({ t: "note", note: n })
      save(n.path!)
      setAgent(name, { path: n.path, line: n.line, find: n.find })
      return n
    }
    const t = target(p)
    notOnDrawing(t, "say it by an element (companion say --find <id>), or draw a text (companion draw)")
    setAgent(name, t)
    const anchor = !t.find && t.line ? lineText(t.path!, t.line) : ""
    return putNote({ kind: "comment", agent: name, text: str(p.text), ...t, ...(anchor ? { anchor } : {}) })
  },
  text: (r) => `Commented (${r.id}).`,
  did: (p) => ({ action: "ui", text: `Commented in ${str(p.path) || focus()?.path || "a note"}`, paths: [], by: who(p) }),
})

plugin.op({
  id: "companion.suggest",
  cli: "companion suggest",
  summary: "Suggest a change in a note: shown struck through and in your colour; the user takes it (Tab) or not (Esc).",
  help: `find is the text to change, exactly as in the file; replace what it becomes (empty: removed). An accept or reject
moment tells you what they chose.

  vau companion suggest --path Notes/Idea.md --find "recieve" --replace "receive"
  vau companion suggest --find "We could maybe try" --replace "We'll try" --why "Firmer"`,
  kind: "write",
  lock: false,
  params: { find: { ...FIND, description: "the text to change, exactly as in the file" }, replace: { type: "string", required: true, description: "what it becomes" },
    why: { type: "string", description: "a few words on why, by it" }, path: PATH, line: LINE, as: AS },
  run: async (p) => {
    if (!str(p.find)) throw new OpError("give `find`: the text to change")
    const name = who(p), t = target(p)
    notOnDrawing(t, "change it with companion draw")
    did(name, "suggest")
    setAgent(name, t)
    return putNote({ kind: "suggestion", agent: name, ...t, replace: str(p.replace), ...(str(p.why) ? { text: str(p.why) } : {}) })
  },
  text: (r) => `Suggested (${r.id}).`,
  did: (p) => ({ action: "ui", text: `Suggested a change in ${str(p.path) || focus()?.path || "a note"}`, paths: [], by: who(p) }),
})
