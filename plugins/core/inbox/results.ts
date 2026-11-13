import fs from "node:fs"
import { inArchive, isArchived, type Item, Kind, type MoveHook, nowStamp, sortBy, str, truthy, writeAtomic } from "../../../core/vault.ts"
import { byMachine, isOne, onMachine } from "./live.ts"
import { doneAs } from "./model.ts"
import { FOLDER, plugin } from "./server.ts"
import { snoozed } from "./snooze.ts"
import { changed, fileOf, list, remotes } from "./store.ts"

const STATUSES = ["new", "done"]

function decisionOf(fm: Item): Item {
  if (!truthy(fm.question)) return {}
  const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : truthy(v) ? [str(v)] : [])
  return { question: str(fm.question), options: list(fm.options), effects: Array.isArray(fm.effects) ? fm.effects.map(str) : [], default: str(fm.default), blocking: fm.blocking === true, answer: truthy(fm.answer) ? str(fm.answer) : "",
    answered: truthy(fm.answered) ? str(fm.answered) : null, closed: truthy(fm.closed) ? str(fm.closed) : "", report: truthy(fm.report) ? str(fm.report) : "", also: list(fm.also),
    gist: truthy(fm.gist) ? str(fm.gist) : "", where: truthy(fm.where) ? str(fm.where) : "" }
}

export function tldrOf(body: string, last = false) {
  const ms = [...body.matchAll(/^> \[!tldr\][^\n]*\n((?:>.*(?:\n|$))+)/gm)]
  const m = last ? ms.at(-1) : ms[0]
  return m ? m[1].split("\n").map((l) => l.replace(/^>\s?/, "").trim()).filter(Boolean).join(" ").slice(0, 400) : ""
}

const slim = new WeakMap<Item, Item>()
let stated: { rs: readonly Item[]; out: Item } | null = null

export const latest = (r: Item) => {
  const at = str(r.updated || r.created || ""), back = str(r.snoozed || "")
  return back > at && !snoozed(back) ? back : at
}

type Listed = Item & { id: string; status: string; archived: boolean; snoozed: string | null; created: string | null; updated: string | null; pinned: boolean }
export const asResults = (items: Item[]) => items.map((r): Listed => ({ ...r, id: str(r.id), status: str(r.status), archived: isArchived(r),
  snoozed: truthy(r.snoozed) ? str(r.snoozed) : null, created: truthy(r.created) ? str(r.created) : null, updated: truthy(r.updated) ? str(r.updated) : null, pinned: r.pinned === true }))

export function withTldr(tldr: string, body: string) {
  const t = tldr.trim()
  if (!t) return body
  return [`> [!tldr] In short\n${t.split(/\r?\n/).map((l) => `> ${l}`.trimEnd()).join("\n")}`, body].filter(Boolean).join("\n\n")
}

export function resultAt(p: string): Item | undefined {
  const id = p.replace(/\.md$/i, "")
  return plugin.vault.items("inbox").find((r) => r.id === id || `${r.id}.md` === p)
}

export async function editBody(id: string, edit: (body: string) => string) {
  const vault = plugin.vault
  await vault.lock(async () => {
    await vault.sync()
    const abs = vault.abs(`${id}.md`)
    if (!fs.existsSync(abs)) return
    const text = fs.readFileSync(abs, "utf8")
    const fm = /^---\n[\s\S]*?\n---\n/.exec(text)?.[0] ?? ""
    const next = fm + edit(text.slice(fm.length))
    if (next !== text) writeAtomic(abs, next)
    await vault.sync()
  })
}

const KIND = new Kind({
  type: "inbox", collection: "inbox", folder: FOLDER,
  parse(fm, body, stem) {
    const status = truthy(fm.status) ? str(fm.status) : "new"
    return [{
      title: truthy(fm.title) ? str(fm.title) : stem, status, from: truthy(fm.from) ? str(fm.from) : "",
      source: truthy(fm.source) ? str(fm.source) : "", created: fm.created ?? null, updated: fm.updated ?? null, origin: truthy(fm.origin) ? str(fm.origin) : "",
      agent: truthy(fm.agent) ? str(fm.agent) : "", session: truthy(fm.session) ? str(fm.session) : "", terminal: truthy(fm.terminal) ? str(fm.terminal) : "",
      machine: truthy(fm.machine) ? str(fm.machine) : "", snoozed: truthy(fm.snoozed) ? str(fm.snoozed) : null, pinned: fm.pinned === true, do: truthy(fm.do) ? str(fm.do) : "", body,
      work: truthy(fm.work) ? str(fm.work) : "",
      ...decisionOf(fm), ...(tldrOf(body) ? { tldr: tldrOf(body) } : {}),
    }, STATUSES.includes(status) ? [] : [`status \`${status}\` isn't one of \`new\` or \`done\``]]
  },
  render: (r) => [{ status: r.status || "new", from: r.from || null, source: r.source || null, created: r.created, updated: r.updated || null, origin: r.origin || null,
    agent: r.agent || null, session: r.session || null, terminal: r.terminal || null, machine: r.machine || null, snoozed: r.snoozed || null, pinned: r.pinned === true || null, do: r.do || null,
    work: r.work || null, question: r.question || null, options: truthy(r.question) && Array.isArray(r.options) ? r.options : null,
    effects: truthy(r.question) && Array.isArray(r.effects) && r.effects.some(truthy) ? r.effects : null, default: r.question ? r.default || null : null,
    blocking: r.question ? r.blocking === true : null, answer: r.answer || null, answered: r.answered || null, closed: r.closed || null, report: r.report || null,
    also: Array.isArray(r.also) && r.also.length ? r.also : null, gist: r.question ? r.gist || null : null, where: r.question ? r.where || null : null }, r.body || ""],
  blocks: (fm) => (truthy(fm.question) ? ["decisions"] : []),
  prepare(r, old) {
    r.created = r.created || nowStamp()
    r.status = r.status || "new"
    const reopened = old && ((old.status === "done" && r.status === "new") || (isArchived(old) && !isArchived(r)))
    const done = !reopened && (r.status === "done" || isArchived(r))
    if (done) r.status = "done"
    else if (reopened) r.status = "new"
    r.archived = done
    if (done || reopened) r.snoozed = null
    if (done) r.pinned = null
    return r
  },
  order: (rs) => {
    const open = (r: Item) => r.status === "new" && !isArchived(r)
    return [...sortBy(rs.filter(open), latest, true), ...sortBy(rs.filter((r) => !open(r)), (r) => str(r.modified || latest(r)), true)]
  },
  key: (r) => (truthy(r.source) ? str(r.source) : null),
  stamps: ["created", "updated", "snoozed", "answered"],
  dropWhenCleared: ["pinned", "snoozed"],
})

function appState() {
  const rs = plugin.vault.shared("inbox")
  if (stated?.rs === rs) return stated.out
  const out = rs.map((r) => {
    if (!isArchived(r) || !r.body) return r
    let s = slim.get(r)
    if (!s) slim.set(r, s = Object.freeze({ ...r, body: "" }))
    return s
  })
  stated = { rs, out: { inbox: Object.freeze(out) } }
  return stated.out
}

const followMove: MoveHook = (from, to) => {
  if (!to) return
  const at = (link?: string) => { const f = fileOf(link); return f === from ? to : f?.startsWith(`${from}/`) ? to + f.slice(from.length) : null }
  const done = inArchive(to) && !inArchive(from), back = inArchive(from) && !inArchive(to)
  let n = 0
  const next = list().map((e) => {
    const l = at(e.link)
    if (!l) return e
    n++
    return done ? { ...doneAs(e, true), link: l } : back && e.state === "done" ? { ...doneAs(e, false), link: l } : { ...e, link: l }
  })
  if (n) changed(next)
  if (!done) return
  const theirs = [...remotes.values()].flatMap((r) => r.events).filter((e) => e.state !== "done" && at(e.link)).map((e) => e.id)
  for (const [m, some] of byMachine(theirs)) {
    if (m) void onMachine(m, "POST", "inbox/events/done?local=1", { ids: some }, (e) => (isOne(e, some) ? doneAs(e, true) : e)).catch(() => {})
  }
}

export function register() {
  plugin.kind(KIND)
  plugin.state(appState)
  plugin.onMove(followMove)
}
