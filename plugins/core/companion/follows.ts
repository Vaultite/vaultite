// What the companion follows this session (dropped on, or asked): a terminal at a command's end or its agent's state, a
// page at a navigation, a selection or a settled change, a tab group's panes. In memory; a watch is the kept kind.
import type { Plugin } from "../../../core/plugins.ts"
import { type Pane, paneSource } from "./places.ts"

/** A follow: of a pane (today's tab), a tab group, or the app's UI (`ui`, the window watches it); who follows. */
export type Follow = { id: string; agent: string; pane?: string; group?: string; ui?: string; title: string; since: number }
/** A source read (watches:read's). */
type Read = { text: string; title: string; state?: string; url?: string; selection?: string; kind: string; missing?: boolean }
/** A followed pane's change, as its moment says it. */
export type Change = { follow: Follow; pane: string; title: string; what: string; changes: string[]; url?: string }

const TICK = 2000, SETTLED = 2, SITE_EVERY = 3, TEXT_GAP = 30_000
/** A shell's prompt at its screen's end: its command ended ($, %, #, >, ❯ or ➜ last, as most prompts). */
const PROMPT = /(?:^|\s)(?:[$%#>❯➜λ»]|\S+[$%#>])\s*$/u

type Seen = { sent: Read | null; last: Read | null; same: number; n: number; textAt: number }

export function follows(plugin: Plugin, o: { change: (c: Change) => void; panes: () => (Pane & { kind?: string })[]; told: () => void }) {
  const list: Follow[] = []
  const seen = new Map<string, Seen>()
  let nid = 0
  let timer: ReturnType<typeof setInterval> | null = null
  const readOf = (source: string, pane: string) => plugin.ask<Read | null>("watches:read", null, source, pane)
  const diff = (a: Read | null, b: Read, most = 24) => plugin.ask<string[]>("watches:changes", [], a, b, most)

  /** The panes a follow covers now: its pane, or its group's, as the windows last said. */
  const panesOf = (f: Follow) => (f.pane ? o.panes().filter((p) => p.id === f.pane) : f.group ? o.panes().filter((p) => p.group === f.group) : [])

  async function look(f: Follow, p: Pane) {
    const src = paneSource(p.to), key = `${f.id}/${p.id}`
    const source = src.kind === "terminal" ? `terminal:${src.terminal}` : src.kind === "site" ? `site:${src.url}` : null
    if (!source) return
    const s = seen.get(key) ?? { sent: null, last: null, same: 0, n: 0, textAt: 0 }
    seen.set(key, s)
    // (a page is read every few rounds: a read is three calls to the browser)
    if (src.kind === "site" && s.n++ % SITE_EVERY) return
    const r = await readOf(source, p.id)
    if (!r || r.missing) return
    const tell = async (what: string, lines?: string[]) => {
      const changes = lines ?? await diff(s.sent, r)
      s.sent = r
      if (changes.length) o.change({ follow: f, pane: p.id, title: p.title || r.title, what, changes, ...(r.url ? { url: r.url } : {}) })
    }
    if (!s.sent) { s.sent = s.last = r; return }
    const moved = s.last?.text !== r.text
    s.same = moved ? 0 : s.same + 1
    s.last = r
    if (src.kind === "terminal") {
      // (its agent's word, at once; a shell's command once its output settled at a prompt; never every byte)
      if ((r.state ?? "") !== (s.sent.state ?? "")) return void await tell(r.state ? `its agent is ${r.state.split(":")[0]}` : "its agent stopped")
      if (r.state || s.same !== SETTLED || r.text === s.sent.text) return
      // (its shell runs nothing in front: at its prompt again; a prompt's look only where the list can't say)
      const info = await plugin.ask<{ busy?: unknown } | null>("terminal:info", null, src.terminal)
      const end = r.text.split("\n").map((l) => l.trimEnd()).filter(Boolean).at(-1) ?? ""
      if (!(info ? !info.busy : PROMPT.test(end))) return
      // (a line typed at the prompt and left there isn't a command: one ran, then its prompt came back)
      const lines = await diff(s.sent, r)
      if (lines.length >= 2) await tell("a command ended", lines)
      return
    }
    if (r.url !== s.sent.url) return void await tell("they went to another page", [`went to ${r.url} (${r.title})`, ...r.text.split("\n").filter((l) => l.trim()).slice(0, 12).map((l) => `  ${l.slice(0, 200)}`)])
    if ((r.selection ?? "") !== (s.sent.selection ?? "") && r.selection) return void await tell("they selected text", [`selected: ${JSON.stringify(r.selection.slice(0, 600))}`])
    // (the page's text once it settled, at most every half minute: a ticking clock isn't news)
    if (r.text !== s.sent.text && s.same >= 1 && Date.now() - s.textAt > TEXT_GAP) { s.textAt = Date.now(); await tell("the page changed", await diff(s.sent, r, 12)) }
  }

  let busy = false
  async function round() {
    if (busy) return
    busy = true
    try { for (const f of [...list]) for (const p of panesOf(f)) await look(f, p).catch(() => {}) } finally { busy = false }
  }
  const run = () => { if (!timer && list.some((f) => !f.ui)) { timer = setInterval(() => void round(), TICK); timer.unref?.() } }
  const halt = () => { if (timer && !list.some((f) => !f.ui)) { clearInterval(timer); timer = null } }

  return {
    list: () => list as readonly Follow[],
    /** Follow a pane, a group or a UI element (again: the same one, no second). */
    add(f: Omit<Follow, "id" | "since">) {
      const was = list.find((x) => x.agent === f.agent && x.pane === f.pane && x.group === f.group && x.ui === f.ui)
      if (was) return was
      const n: Follow = { ...f, id: `f${++nid}`, since: Date.now() }
      list.push(n)
      // (what it shows now is where it starts from, read at once: a command run right after is news)
      run(); o.told(); void round()
      return n
    },
    /** Stop following: one by id, pane, group or ui, or all of `agent`'s. */
    remove(ref: string | null, agent?: string) {
      const gone = list.filter((f) => (ref ? [f.id, f.pane, f.group, f.ui].includes(ref) : f.agent === agent))
      for (const f of gone) { list.splice(list.indexOf(f), 1); for (const k of [...seen.keys()]) if (k.startsWith(`${f.id}/`)) seen.delete(k) }
      halt(); if (gone.length) o.told()
      return gone
    },
    stop() { if (timer) clearInterval(timer); timer = null },
  }
}
