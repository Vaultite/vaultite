import type { IncomingMessage } from "node:http"
import { byUser, type OpCtx, OpError } from "../../../core/plugins.ts"
import { requestWriter, type Writer } from "../../../core/vault.ts"
import { BIG_EDIT, changesOf, linesIn, tally } from "./proposals.ts"
import { type Change, changeAt, nearest } from "./text.ts"
import "./innotes.ts"
import { plugin } from "./self.ts"
import type { Note } from "./types.ts"
import { EMOJI, HIGHLIGHT_MS, str } from "./settings.ts"
import { notes, did, broadcast, key, focus, agentOf, setAgent, writingAt, wroteAt, putNote, dropNote } from "./state.ts"
import { addMoment } from "./intake.ts"
import { save } from "./comments.ts"
import { resolve } from "./windowpanes.ts"
import { applyEdit, editText, streams, toolUse, finishStream, cut } from "./edits.ts"
import { apiCtx } from "./chat.ts"
import { AS, PATH, LINE, FIND, PANE, UI, ROW, EL, target, notOnDrawing, who, type Given } from "./args.ts"

const changeId = () => `c${Math.random().toString(36).slice(2, 6)}`
const firstLine = (s: string) => s.split("\n")[0] || undefined
export const textOf = async (ctx: OpCtx, p: string) => String((await ctx.api("GET", `file?path=${encodeURIComponent(p)}`)).text ?? "")

function placeAt(n: Note) {
  const c = n.changes?.find((x) => !x.stale && !x.intent) ?? n.changes?.[0]
  if (!c || (n.line === c.line && n.find === firstLine(c.find))) return false
  n.line = c.line
  if (firstLine(c.find)) n.find = firstLine(c.find); else delete n.find
  return true
}
export function refind(n: Note, text: string) {
  let moved = false
  for (const c of n.changes ?? []) {
    const at = changeAt(text, c), line = at < 0 ? c.line : text.slice(0, at).split("\n").length
    if (line === c.line && !c.stale === at >= 0) continue
    c.line = line
    if (at < 0) c.stale = true; else delete c.stale
    moved = true
  }
  if (placeAt(n)) moved = true
  if (moved) broadcast({ t: "note", note: n })
  return moved
}

function proposeText(ctx: OpCtx, name: string, p: string, next: string, cur: string, why = "", into?: Note) {
  const fm = /^---\n[\s\S]*?\n---\n\n*/.exec(cur)?.[0]
  if (fm && !next.startsWith("---\n")) next = fm + next.replace(/^\n+/, "")
  const changes = changesOf(cur, next, changeId)
  if (!changes.length) throw new OpError("it's the note as it is: nothing to propose")
  did(name, "propose")
  setAgent(name, { path: p, line: changes[0].line })
  const writer = { client: ctx.who.client, agent: ctx.who.agent }
  if (!into) return putNote({ kind: "proposal", agent: name, path: p, line: changes[0].line, ...(firstLine(changes[0].find) ? { find: firstLine(changes[0].find) } : {}), changes, writer, ...(why ? { text: why } : {}) })
  Object.assign(into, { changes, writer, t: Date.now() }, why ? { text: why } : {})
  placeAt(into)
  broadcast({ t: "note", note: into })
  save(p)
  return into
}

async function take(n: Note, c: Change) {
  const writer: Writer = n.writer ?? { client: "cli", agent: n.agent }
  await requestWriter.run(writer, () => applyEdit(apiCtx, agentOf(n.agent), { path: n.path!, find: c.find, line: c.line, text: c.text }, false))
}

export async function review(id: string, verdict: "accept" | "reject", change?: string, from?: IncomingMessage) {
  const n = notes.get(id)
  if (!n || n.kind !== "proposal") throw new OpError(`there's no proposal ${id}`, 404)
  const picked = (n.changes ?? []).filter((c) => (change ? c.id === change : verdict === "reject" || (!c.intent && !c.stale)))
  if (change && !picked.length) throw new OpError(`proposal ${id} has no change ${change}`, 404)
  let took = 0, left = 0, failed = 0
  for (const c of picked) {
    if (verdict === "accept") {
      if (c.intent || c.stale) { failed++; continue }
      try { await take(n, c); took++ } catch { c.stale = true; failed++; continue }
    } else if (!c.intent) left++
    n.changes = (n.changes ?? []).filter((x) => x !== c)
  }
  n.took = (n.took ?? 0) + took; n.left = (n.left ?? 0) + left
  const open = n.changes?.length ?? 0
  if (open) {
    placeAt(n)
    broadcast({ t: "note", note: n })
    save(n.path!)
  } else {
    dropNote(id)
    const all = n.took + n.left
    addMoment({ kind: n.took ? "accept" : "reject", for: n.agent, item: id, path: n.path, line: n.line,
      text: `${n.took === all ? "took all" : n.took ? `took ${n.took} of` : "left all"} ${all === 1 ? "the change" : `${all} changes`} of your proposal${n.text ? ` (${cut(n.text, 80)})` : ""}` }, from)
  }
  return { id, took, left, failed, open }
}

plugin.op({
  id: "companion.propose",
  cli: "companion propose",
  summary: "Propose a large change to a note: shown as tracked changes in your colour that the user takes or leaves one by one. None of it is in the file until they take it.",
  help: `For a change too big to type in before their eyes: a rewrite, a section, several places at once. Give the note as
you'd have it (text: a shadow copy, which is cut into changes; its frontmatter may be left out), or one stretch (find and
replace). While you work it out, you may first plant a placeholder where it will land (pending: what's coming; find: the
text of the line it comes after), then propose with its id to fill it. A companion edit replacing more than ${BIG_EDIT} lines
becomes a proposal by itself. An accept or reject moment says what they took ("took 3 of 4 changes").

  vau companion propose --path Notes/Plan.md --pending "Risks: checking last week's notes" --find "## Risks"
  vau companion propose --id n4k2 --path Notes/Plan.md --text "$(cat /tmp/plan.md)" --why "Tighter, risks updated"
  vau companion propose --find "We could maybe try" --replace "We'll try" --why "Firmer"`,
  kind: "write",
  lock: false,
  params: { text: { type: "string", description: "the whole note as you'd have it (its frontmatter may be left out)" },
    find: { ...FIND, description: "with replace: the text to change, exactly as in the file; with pending: text of the line it comes after" },
    replace: { type: "string", description: "what find becomes (empty: removed)" },
    pending: { type: "string", description: "a placeholder: what you're writing, shown where it will land until you propose" },
    why: { type: "string", description: "a few words on why, on its card" },
    id: { type: "string", description: "your proposal to fill (its placeholders), or to add a placeholder to" }, path: PATH, line: LINE, as: AS },
  run: async (p, ctx) => {
    const name = who(p), into = p.id ? notes.get(str(p.id)) : undefined
    if (p.id && (!into || into.kind !== "proposal")) throw new OpError(`there's no proposal ${str(p.id)}`, 404)
    if (into && key(into.agent) !== key(name)) throw new OpError(`proposal ${into.id} is ${into.agent}'s`, 403)
    const t = into ? { ...target({ ...p, path: into.path }) } : target(p), path = t.path!
    notOnDrawing(t, "change it with companion draw")
    const cur = await textOf(ctx, path)
    if (str(p.pending)) {
      if (!t.find && t.line === undefined) throw new OpError("with pending, give find (the text of the line it comes after) or line")
      const at = t.find ? nearest(cur, t.find, t.line) : -1
      if (t.find && at < 0) throw new OpError(`"${cut(t.find, 60)}" isn't in the file: read it again and copy the text exactly`)
      const line = at >= 0 ? cur.slice(0, at).split("\n").length : Math.max(1, Math.min(t.line!, cur.split("\n").length))
      const c: Change = { id: changeId(), find: at >= 0 ? t.find! : cur.split("\n")[line - 1] ?? "", text: "", line, intent: cut(str(p.pending), 200) }
      did(name, "propose")
      wroteAt(name, { path, line, find: firstLine(c.find) })
      if (!into) return putNote({ kind: "proposal", agent: name, path, line, ...(firstLine(c.find) ? { find: firstLine(c.find) } : {}), changes: [c], writer: { client: ctx.who.client, agent: ctx.who.agent } })
      into.changes = [...(into.changes ?? []), c]
      placeAt(into)
      broadcast({ t: "note", note: into })
      save(path)
      return into
    }
    let next: string
    if (str(p.text)) next = str(p.text)
    else if (t.find && p.replace !== undefined) next = editText(cur, { find: t.find, line: t.line, text: str(p.replace) })
    else throw new OpError("give text (the note as you'd have it), find and replace, or pending")
    return proposeText(ctx, name, path, next, cur, str(p.why), into)
  },
  text: (r: Note) => {
    const ready = (r.changes ?? []).filter((c) => !c.intent), waits = (r.changes?.length ?? 0) - ready.length
    if (!ready.length) return `Placeholder planted (proposal ${r.id}): propose with --id ${r.id} and the text to fill it.`
    const sum = ready.reduce((a, c) => { const x = tally(c); return { come: a.come + x.come, gone: a.gone + x.gone } }, { come: 0, gone: 0 })
    return `Proposed ${ready.length === 1 ? "1 change" : `${ready.length} changes`} (+${sum.come} −${sum.gone} lines) in ${r.path} (${r.id})${waits ? `, ${waits} placeholder${waits === 1 ? "" : "s"} still waiting` : ""}: the user takes or leaves each.`
  },
  did: (p) => ({ action: "ui", text: `Proposed a change to ${str(p.path) || focus()?.path || "a note"}`, paths: [], by: who(p) }),
})

plugin.op({
  id: "companion.review",
  cli: "companion review",
  summary: "Take or leave an agent's proposal: all its changes, or one (the user's call: agents propose, people decide).",
  help: `  vau companion review n4k2 accept
  vau companion review n4k2 reject --change c8f1`,
  kind: "write",
  lock: false,
  params: { id: { type: "string", required: true, description: "the proposal (n4k2)" },
    verdict: { type: "string", required: true, enum: ["accept", "reject"], description: "accept: take them (written as its agent's); reject: leave them" },
    change: { type: "string", description: "one of its changes (c8f1); default: all those that still fit" } },
  args: ["id", "verdict"],
  run: async (p, ctx) => {
    if (!byUser(ctx.who)) throw new OpError("only the user takes or leaves a proposal (in the app, or vau typed by hand)", 403)
    return review(str(p.id), p.verdict === "accept" ? "accept" : "reject", str(p.change) || undefined)
  },
  text: (r) => `Took ${r.took}, left ${r.left}${r.failed ? `; ${r.failed} no longer fit${r.failed === 1 ? "s" : ""} the note` : ""}${r.open ? `; ${r.open} still open` : "; it's closed"}.`,
})

plugin.op({
  id: "companion.edit",
  cli: "companion edit",
  summary: "Write in a note: typed in before the user's eyes when it's open (they can undo it), else saved to the file.",
  help: `Only in pair mode or when they asked you to. find and text: find replaced by text. after and text: new lines after
the line with that text. Else new lines after line (0: at the top), or at the end. Prefer find or after: a line number
goes stale as they type. Edits of a note go one at a time; each returns once it's in. In the app's chat your words are
typed in as you write them, its place first; your cursor stays at their end.

  vau companion edit --path Notes/Idea.md --find "- [ ] Call Alice" --text "- [x] Call Alice"
  vau companion edit --after "## Budget" --text "- Ask Ben about the budget"`,
  kind: "write",
  lock: false,
  params: { path: PATH, find: { type: "string", description: "the text it replaces, exactly as in the file" },
    after: { type: "string", description: "new lines go after the line with this text (exactly as in the file)" },
    line: LINE, append: { type: "boolean", description: "at the end of the file" }, text: { type: "string", required: true, description: "what to write" }, as: AS },
  args: ["text"],
  run: async (p, ctx) => {
    const name = who(p), t = target(p), after = str(p.after) || undefined
    notOnDrawing(t, "change it with companion draw")
    if (t.find && linesIn(t.find) > BIG_EDIT) {
      const cur = await textOf(ctx, t.path!)
      const n = proposeText(ctx, name, t.path!, editText(cur, { find: t.find, line: t.line, text: str(p.text) }), cur)
      return { path: t.path, how: "proposed", id: n.id }
    }
    did(name, "edit")
    const use = toolUse.getStore(), s = use ? streams.get(use) : undefined
    if (s?.edit) {
      const x = s.edit
      x.text = x.e.text = str(p.text)
      finishStream(s)
      try {
        const how = await x.job
        if (how === "stopped") throw new OpError("the user stopped you (Esc) as you wrote it: what you had typed by then stays", 409)
        return { path: x.e.path, how: how === "typed" ? how : await applyEdit(ctx, agentOf(name), x.e) }
      } finally { setAgent(name, {}) }
    }
    const done = writingAt(name, { ...t, ...(after ? { find: after } : {}) })
    try {
      const how = await applyEdit(ctx, agentOf(name), { path: t.path!, find: t.find, after, line: t.line, text: str(p.text), append: !!p.append })
      return { path: t.path, how }
    } finally { done() }
  },
  text: (r) => (r.how === "proposed" ? `Proposed it in ${r.path} instead (${r.id}): it replaces more than ${BIG_EDIT} lines, so the user takes it or not.`
    : `${r.how === "typed" ? "Typed into" : "Wrote"} ${r.path}.`),
  did: (p) => edited(p),
})

export function edited(p: Given) {
  const path = str(p.path) || focus()?.path || ""
  return { action: "edit" as const, text: path ? `Edited ${path}` : "Edited a note", paths: path ? [path] : [], by: who(p) }
}

plugin.op({
  id: "companion.highlight",
  cli: "companion highlight",
  summary: "Highlight text in your colour: in a note (for a while, or kept as ==🟠text== with keep), on a drawing an element, in a pane a terminal's text or a page's element, or the app's UI.",
  help: `  vau companion highlight --find "the budget is due Friday"
  vau companion highlight --path Notes/Idea.md --find "key insight" --keep`,
  kind: "write",
  lock: false,
  params: { find: { ...FIND, description: "the text to highlight, exactly as in the file (in a terminal, on its screen)" }, keep: { type: "boolean", description: "keep it in the file, as a highlight of your colour" },
    path: PATH, line: LINE, pane: PANE, ui: UI, row: ROW, el: EL, as: AS },
  run: async (p, ctx) => {
    const name = who(p), t = await resolve(target(p, true), name)
    if (!t.find && !t.el && !t.ui && !t.row) throw new OpError("give `find`: the text to highlight (in a page, `el`; in the app, `ui`)")
    if (!t.path && p.keep) throw new OpError("keep is for notes")
    did(name, "highlight")
    if (p.keep) notOnDrawing(t, "keep is for notes; its highlight is your selection there for a while")
    const a = setAgent(name, { ...t, pointed: Date.now() })
    if (!p.keep) return putNote({ kind: "highlight", agent: name, ...t }, HIGHLIGHT_MS)
    await applyEdit(ctx, a, { path: t.path!, find: t.find, line: t.line, text: `==${EMOJI[a.tint] ?? ""}${t.find}==` }, false)
    return { path: t.path, kept: true }
  },
  text: (r) => (r.kept ? `Highlighted in ${r.path}.` : `Highlighted (${r.id}).`),
  did: (p) => (p.keep ? edited(p) : { action: "ui", text: `Highlighted text in ${str(p.path) || focus()?.path || "a note"}`, paths: [] }),
})
