// A file's autosave (the file view, a canvas's note cards): saved 600 ms after typing stops, on top of a save on its
// way, a failed one sent again; changes on disk merged in (3-way); what's left sent when the view goes, kept on the device.
import { useEffect, useLayoutEffect, useState } from "react"
import { get, post, put as putJson, request } from "@/core/http"
import { deletedHere, gone, moveMark, readFile, splitFm, stem, whereNow, type FileText } from "@/core/files"
import { onReconnect, useVaultChange } from "@/core/live"
import { merge3, mergeClashes, type Clash } from "@/core/merge"
import { errorReason, notify } from "@/core/notify"
import { dropDraft, keepDraft } from "@/core/drafts"
import { trackUnsaved } from "@/core/unsaved"
import { applyEdit, editOf, LEAN_PAST, textHash } from "../../../core/texthash.ts"
import { keptLive, onHandBack, typedLive } from "@/core/cosync"
import { trace } from "@/core/trace"

/** A conflict: `base` the text both sides started from, `lines` where they clash (the file's, 1-based), `who` the agent
 *  that wrote theirs when known, `inline` when the editor shows it in place (undefined while that's found out). */
export type Conflict = { kind: "conflict"; base: string; theirs: FileText; lines: number[]; who?: string; inline?: boolean }
export type SaveStatus = { kind: "ok" } | { kind: "error"; message: string } | Conflict

type Options = {
  /** The whole file as typed now. */
  text: () => string
  /** Show text from the server (merged or filled in), keeping the cursor. */
  apply: (text: string) => void
  /** Where saving is; a conflict holds every save until it's settled (in the editor, or `keep`). */
  onStatus: (s: SaveStatus) => void
  /** The server's copy, after a save or a read. */
  onDisk?: (f: FileText) => void
  /** Show the merged `text` with its clashes in place to settle there (editor/conflicts.ts); false if it can't. `left`
   *  hears how many are left. */
  conflict?: (text: string, clashes: Clash[], who: string | undefined, left: (n: number, rest?: Clash[]) => void) => boolean
  /** Deleted or moved on disk (a move through the API is followed by its tab instead). */
  onGone: () => void
  readOnly?: boolean
}

export type Autosave = ReturnType<typeof makeAutosave>

export function useAutosave(path: string, initial: string, options: Options): Autosave {
  const [saver] = useState(() => makeAutosave(path, initial, options))
  useLayoutEffect(() => saver.use(options))
  useEffect(() => saver.mount(), [saver])
  useVaultChange(() => { saver.check() }, [path])
  return saver
}

/** The agent that wrote `path` at `mtime` (Activity's), for "Claude Code edited line 6"; undefined if not known. */
async function whoWrote(path: string, mtime: number): Promise<string | undefined> {
  type Ev = { t: number; last?: number; actor: { kind: string; name: string }; action: string; paths?: string[]; wrote?: string[] }
  const ask = get<{ events: Ev[] }>(`activity?path=${encodeURIComponent(path)}&action=changes,request&limit=10&settled=1&since=${mtime - 15 * 60_000}`)
  const r = await Promise.race([ask.catch(() => null), new Promise<null>((ok) => setTimeout(() => ok(null), 3000))])
  // (a write's file time falls in its request, or just after a run of them: as File history matches them)
  // (the user's own saves run around it too: an agent's or the CLI's)
  const e = r?.events.find((x) => (x.actor.kind === "agent" || x.actor.kind === "cli") && x.t - 1000 <= mtime && mtime <= (x.last ?? x.t) + 5000
    && (x.action !== "request" || (x.wrote ?? x.paths)?.includes(path)))
  return e?.actor.name
}

/** "Claude Code's", or "the other". */
export const theirName = (who?: string) => (who ? `${who}'s` : "the other")

/** "Claude Code edited line 6 while you typed." (`above`: lines not shown, a hidden frontmatter's). */
export function conflictText(c: Conflict, above = 0) {
  const ns = [...new Set(c.lines.map((n) => n - above).filter((n) => n > 0))]
  const lines = !ns.length ? "" : ns.length === 1 ? `line ${ns[0]}` : `lines ${ns.slice(0, -1).join(", ")} and ${ns.at(-1)}`
  const where = c.lines.some((n) => n <= above) ? (lines ? `the properties and ${lines}` : "the properties") : lines
  if (!where) return c.who ? `${c.who} edited it while you typed.` : "It changed elsewhere while you typed."
  return c.who ? `${c.who} edited ${where} while you typed.` : `${where[0].toUpperCase()}${where.slice(1)} changed elsewhere while you typed.`
}

const lower = (s: string) => s.replace(/^(Lines?|The) /, (w) => w.toLowerCase())

/** The text with theirs in each clash instead of mine. */
function withTheirs(text: string, clashes: Clash[]) {
  const lines = text.split("\n")
  for (const k of [...clashes].reverse()) lines.splice(k.at, k.mine.length, ...k.theirs)
  return lines.join("\n")
}

/** Where saving is; every change of it is a `step`. */
export type Phase =
  | { kind: "idle" }
  /** Typed: saved once typing pauses (the timer). `recheck`: a change on disk was heard meanwhile, read after. */
  | { kind: "pending"; recheck: boolean }
  /** Reading the file to merge a change on disk; `again`, another was heard meanwhile. */
  | { kind: "checking"; again: boolean }
  /** A save on its way: typed since (`typed`, the timer runs), asked again (`again`), the tries a failure counts on. */
  | { kind: "saving"; typed: boolean; again: boolean; recheck: boolean; tries: number }
  /** Every save held until it's settled (in the editor, or `keep`). */
  | { kind: "conflict"; recheck: boolean }
  /** The last save failed: sent again with backoff, on reconnecting and when shown (`retry`: worth trying again). */
  | { kind: "error"; tries: number; retry: boolean }
  /** The view went while a save was on its way: the answer is merged into what was typed, then what's left is sent. */
  | { kind: "closing"; was: Extract<Phase, { kind: "saving" }> }
  /** The view went and what it had was sent: nothing more. */
  | { kind: "gone" }

export type SaveEvent =
  | { type: "typed" } | { type: "due" } | { type: "save"; force?: boolean } | { type: "check"; known?: FileText }
  /** The read the check made is done (merged or not). */
  | { type: "read" }
  /** The save's answer is in (`again`: what's on disk was a save of ours whose answer was lost: save on top of it). */
  | { type: "saved"; again?: boolean } | { type: "failed"; retry: boolean }
  | { type: "clash" } | { type: "resolve" } | { type: "retry" } | { type: "close" } | { type: "mount" }
  /** Saving's back from a live session (core/cosync.ts), on the text the server has after it. */
  | { type: "rebase" }

/** What a step starts: the typing timer, a save, a read, the last send without the view, the status said again, the
 *  device's draft dropped, an error said no more (all saved). */
type Effect = "arm" | "send" | "read" | "flush" | "tell" | "drop" | "calm"

/** The next phase on `e`, and what it starts. `nothing`: nothing to send now (the text is the server's, or a live
 *  session keeps the file), asked only when it matters (it compares the whole text). */
export function step(p: Phase, e: SaveEvent, nothing: () => boolean): { to: Phase; do: Effect[] } {
  const go = (to: Phase, ...d: Effect[]) => ({ to, do: d })
  // Quiet again: a change heard meanwhile is read now, else anything still unsent saved after the pause.
  const rest = (recheck: boolean, ...d: Effect[]) => (recheck ? go({ kind: "checking", again: false }, "read", ...d)
    : nothing() ? go({ kind: "idle" }, "calm", ...d) : go({ kind: "pending", recheck: false }, "arm", ...d))
  const send = (recheck: boolean, tries = 0) => go({ kind: "saving", typed: false, again: false, recheck, tries }, "send")
  switch (e.type) {
    case "typed":
      if (p.kind === "idle" || p.kind === "error") return go({ kind: "pending", recheck: false }, "arm")
      if (p.kind === "pending") return go(p, "arm")
      if (p.kind === "checking") return go({ kind: "pending", recheck: true }, "arm") // (its read is old when it lands)
      if (p.kind === "saving") return go({ ...p, typed: true }, "arm")
      if (p.kind === "conflict") return go(p, "tell")
      return go(p)
    case "due":
      if (p.kind === "pending") return nothing() ? rest(p.recheck, "drop") : send(p.recheck)
      if (p.kind === "saving" && p.typed) return go({ ...p, typed: false, again: true })
      return go(p)
    case "save":
      if (p.kind === "idle" || p.kind === "pending" || p.kind === "error" || p.kind === "checking") {
        const recheck = p.kind === "checking" || (p.kind === "pending" && p.recheck)
        if (nothing()) return p.kind === "checking" ? go(p) : rest(recheck, "drop")
        return send(recheck, p.kind === "error" ? p.tries : 0)
      }
      if (p.kind === "saving") return go({ ...p, typed: false, again: true })
      if (p.kind === "conflict" && e.force) return nothing() ? rest(p.recheck) : send(p.recheck)
      return go(p)
    case "check":
      if (p.kind === "idle") return go({ kind: "checking", again: false }, "read")
      if (p.kind === "pending" || p.kind === "saving" || p.kind === "conflict") return go({ ...p, recheck: true })
      if (p.kind === "checking") return go({ ...p, again: true })
      // (heard from the server: it's there again, and a save merges the change)
      if (p.kind === "error") return p.retry && !nothing() ? send(false, p.tries) : go({ kind: "checking", again: false }, "read")
      return go(p)
    case "read":
      if (p.kind !== "checking") return go(p)
      return p.again ? go({ kind: "checking", again: false }, "read") : rest(false)
    case "saved":
      if (p.kind === "closing") return go({ kind: "gone" }, "flush")
      if (p.kind !== "saving") return go(p)
      if ((p.again || e.again) && !nothing()) return go({ ...p, again: false, tries: 0 }, "send")
      return p.typed ? go({ kind: "pending", recheck: p.recheck }) : rest(p.recheck)
    case "failed":
      if (p.kind === "closing") return go({ kind: "gone" }, "flush")
      if (p.kind !== "saving") return go(p)
      if (p.typed) return go({ kind: "pending", recheck: p.recheck })
      // (a change heard meanwhile is read now: it may be why it failed, the file moved or deleted)
      if (p.recheck) return go({ kind: "checking", again: false }, "read")
      return go({ kind: "error", tries: p.tries + 1, retry: e.retry })
    case "clash":
      if (p.kind === "closing") return go({ kind: "gone" }, "flush")
      if (p.kind === "saving" || p.kind === "pending") return go({ kind: "conflict", recheck: p.recheck })
      if (p.kind === "checking") return go({ kind: "conflict", recheck: true }) // (a read on its way, dropped)
      if (p.kind === "idle" || p.kind === "error") return go({ kind: "conflict", recheck: false })
      return go(p)
    case "resolve":
      return p.kind === "conflict" ? rest(p.recheck) : go(p)
    case "retry":
      if (p.kind !== "error") return go(p)
      return nothing() ? rest(false) : p.retry ? send(false, p.tries) : go(p)
    case "close":
      if (p.kind === "saving") return go({ kind: "closing", was: p })
      return p.kind === "closing" || p.kind === "gone" ? go(p) : go({ kind: "gone" }, "flush")
    case "mount":
      // (React's strict mode closes and draws a view again at once)
      if (p.kind === "closing") return go(p.was)
      return p.kind === "gone" ? rest(false) : go(p)
    case "rebase":
      // (what the server lacks is sent at once: the session may have gone with the socket; a read on its way was made on
      // the old base)
      if (p.kind === "checking") return go({ kind: "checking", again: false }, "read")
      if (p.kind === "saving") return go({ ...p, again: true })
      if (p.kind !== "idle" && p.kind !== "pending" && p.kind !== "error") return go(p)
      return nothing() ? rest(p.kind === "pending" && p.recheck) : send(p.kind === "pending" && p.recheck)
  }
}

/** The files a conflict holds now (each saver's `where`): what's typed in them isn't saved till it's settled. */
const holding = new Set<() => string>()
export const heldByConflict = (path: string) => [...holding].some((w) => w() === path)

/** How long a failed save waits before it's sent again (tries: 1 and up). */
const backoff = (tries: number) => Math.min(30_000, 1000 * 2 ** tries)
/** How long a save may take: one left hanging (a phone's stuck tunnel) holds every save after it. */
const SAVE_WAIT = 60_000

export function makeAutosave(path: string, initial: string, options: Options) {
  const o = { current: options }
  const opened = moveMark()
  const where = () => whereNow(path, opened)
  let phase: Phase = { kind: "idle" }
  let timer: ReturnType<typeof setTimeout> | null = null, drafting: ReturnType<typeof setTimeout> | null = null
  let retrying: ReturnType<typeof setTimeout> | null = null
  let status: SaveStatus = { kind: "ok" }
  /** When what's on disk was written, once known (a save's or a read's). */
  let mtime = 0
  /** The save on its way, so a later save or the last flush builds on it. */
  let inflight: { text: string; done: Promise<void> } | null = null
  /** The read whose answer counts: a later one makes it old. */
  let reading = 0
  /** What was typed when the view went: the text from then on, the server's answers merged into it. */
  let ghost: string | null = null
  const now = () => ghost ?? o.current.text()
  const show = (text: string) => { if (ghost === null) o.current.apply(text); else ghost = text }
  /** The last conflict, to go back to (Undo); and what's left of it when its editor went (a switch to source mode, a
   *  plugin's page): its clashes in the text as it was then, settled with `keep` or shown again by the next editor. */
  let last: Conflict | null = null
  let parked: { text: string; clashes: Clash[] } | null = null
  /** Waiting for the conflict to be settled (`calm`). */
  let calmed: (() => void)[] = []
  /** Texts sent whose answer never came (the network dropped, the page went): the server may have them, so finding
   *  one on disk is this editor's own save, not a change elsewhere. */
  let unconfirmed: string[] = []
  const sentMaybe = (text: string) => { unconfirmed = [...unconfirmed.filter((t) => t !== text), text].slice(-5) }
  /** The unconfirmed save that `disk` is, if one is: the same text, or its new body with properties the server set as it
   *  saved (Note dates' updated). `base`: what that save was made on. */
  const ownSave = (disk: string, base: string) => {
    const body = splitFm(disk).body
    return unconfirmed.find((t) => t === disk || (splitFm(t).body === body && body !== splitFm(base).body))
  }
  /** Take `disk`, our own save (`own`) as the server wrote it: what it set merged into the text as typed now. */
  const adopt = (own: string, disk: string) => {
    const typed = now(), merged = own === disk ? typed : merge3(own, typed, disk) ?? typed
    if (merged !== typed) show(merged)
  }
  const tell = (st: SaveStatus) => { status = st; o.current.onStatus(st) }
  /** A save: its edit of the base and the base's fingerprint, the whole text and base only if the server asks (it
   *  changed on disk); it gets back how the file differs from what it sent. (keepalive takes 64 KB at most) */
  const put = async (text: string, base: string | null, init?: RequestInit) => {
    const fits = (n: number) => (init?.keepalive && n > 60_000 ? { ...init, keepalive: false } : init)
    if (base === null) return request("PUT", "file", { path: where(), text, base }, fits(text.length))
    const edit = editOf(base, text)
    const r = await request("PUT", "file", { path: where(), edit, baseHash: textHash(base), lean: true }, fits(edit.add.length + 200))
    return r.status === 412 ? request("PUT", "file", { path: where(), text, base, lean: true }, fits(text.length + base.length)) : r
  }
  /** The server's answer, with its text made from what was sent. */
  const answer = async (r: Response, sent: string): Promise<FileText & { error?: string }> => {
    const j = await r.json()
    return j.same ? { ...j, text: sent } : j.edit ? { ...j, text: applyEdit(sent, j.edit) ?? sent } : j
  }

  /** The one way the phase changes: `step`, then what it starts; the timers run only in the phases they belong to. */
  const go = (e: SaveEvent) => {
    const was = phase
    const { to, do: effects } = step(phase, e, () => keptLive(where()) || (!(e.type === "save" && e.force) && now() === s.disk))
    phase = to
    if (to.kind !== was.kind) trace("autosave", { path, from: was.kind, to: to.kind, on: e.type })
    if (to.kind === "conflict") holding.add(where)
    else if (was.kind === "conflict") { holding.delete(where); parked = null; for (const f of calmed.splice(0)) f() }
    if (timer && to.kind !== "pending" && !(to.kind === "saving" && to.typed)) { clearTimeout(timer); timer = null }
    if (retrying && to.kind !== "error") { clearTimeout(retrying); retrying = null }
    if (to.kind === "error" && was.kind !== "error" && to.retry) retrying = setTimeout(() => { retrying = null; go({ type: "retry" }) }, backoff(to.tries))
    for (const d of effects) {
      if (d === "arm") arm()
      else if (d === "send") void send()
      else if (d === "read") void read(e.type === "check" ? e.known : undefined)
      else if (d === "flush") flush(s.disk, true)
      else if (d === "tell") tell(status)
      else if (d === "drop") dropDraft(path)
      else if (d === "calm" && status.kind === "error") tell({ kind: "ok" })
    }
  }

  /** Saved 600 ms after the last change; kept on the device as typing pauses. */
  const arm = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; go({ type: "due" }) }, 600)
    // (not only as it saves: what a window closed before then wrote at pagehide doesn't get to IndexedDB)
    if (drafting) clearTimeout(drafting)
    drafting = setTimeout(() => { drafting = null; const text = now(); if (text !== s.disk) keepDraft(path, text, s.disk) }, 100)
  }

  /** The text as typed now, on top of what the server has; its answer merged in, then one settled exit. */
  const send = async () => {
    if (drafting) { clearTimeout(drafting); drafting = null }
    const sent = now(), base = s.disk, retried = phase.kind === "saving" && phase.tries > 0
    keepDraft(path, sent, base)
    let finish = () => {}
    inflight = { text: sent, done: new Promise<void>((r) => { finish = r }) }
    // (an answer that comes once the phase moved on, a conflict brought back meanwhile, says nothing)
    const ours = () => phase.kind === "saving" || phase.kind === "closing"
    let r: Response | null = null, next: SaveEvent
    try {
      r = await put(sent, base, { signal: AbortSignal.timeout?.(SAVE_WAIT) })
      const j = await answer(r, sent)
      if (r.status === 409) {
        // On disk is a save of ours whose answer was lost: that's the base, and saving again merges onto it.
        const own = ownSave(j.text, base)
        if (own !== undefined) { s.disk = j.text; mtime = j.mtime; unconfirmed = []; adopt(own, j.text); next = { type: "saved", again: true } }
        else next = clash(base, j) ? { type: "clash" } : { type: "saved" }
      } else {
        if (!r.ok) throw new Error(j.error || r.statusText)
        o.current.onDisk?.(j)
        mtime = j.mtime
        const typed = now()
        if (j.text === sent || typed === sent) {
          s.disk = j.text
          if (j.text !== sent) show(j.text) // the server filled something in, or merged a change from disk
        } else {
          // Typed more while it saved, and the server's differs: keep both, or the next save gets the 409.
          const merged = merge3(sent, typed, j.text)
          if (merged !== null) { s.disk = j.text; show(merged) } else s.disk = sent
          s.changed()
        }
        if (now() === s.disk) dropDraft(path)
        unconfirmed = []
        if (ours()) tell({ kind: "ok" })
        next = { type: "saved" }
      }
    } catch (e) {
      if (!r) sentMaybe(sent)
      const err = e instanceof DOMException && e.name === "TimeoutError" ? new Error("The server didn't answer") : e
      const message = errorReason(err) ?? ""
      // (a retry failing as the last one did isn't said again: the phone's toast would come back every time)
      if (ours() && !(retried && status.kind === "error" && status.message === message)) tell({ kind: "error", message })
      next = { type: "failed", retry: !r || r.status >= 500 || r.status === 408 || r.status === 429 }
    }
    inflight = null
    finish()
    go(next)
  }

  /** What's on disk read (`known`: just read) and merged into the text. */
  const read = async (known?: FileText) => {
    const id = ++reading, before = s.disk
    // (only the last read counts, and only while it's what the phase waits on: a save since brought newer text)
    const mine = () => id === reading && phase.kind === "checking"
    try {
      // (typed in together, core/cosync.ts: the session brings in what changes)
      if (keptLive(where())) return void go({ type: "read" })
      // (a long text is read again only when its file changed since: the change is often this view's own save)
      if (!known && mtime && before.length > LEAN_PAST) {
        const info = await get<{ mtime: number; size: number }>(`file/info?path=${encodeURIComponent(where())}`)
        if (info.mtime === mtime && info.size === new TextEncoder().encode(before).length) return void (mine() && go({ type: "read" }))
      }
      const r = known ?? await readFile(where())
      if (!mine()) return
      if (keptLive(where())) return void go({ type: "read" })
      if (r.text === before) return void go({ type: "read" })
      const typed = now(), own = ownSave(r.text, before)
      if (own !== undefined) unconfirmed = []
      const merged = own !== undefined ? (own === r.text ? typed : merge3(own, typed, r.text) ?? typed) : typed === before ? r.text : merge3(before, typed, r.text)
      go({ type: "read" })
      if (merged === null) { if (clash(before, r)) go({ type: "clash" }); return }
      s.disk = r.text
      mtime = r.mtime
      o.current.onDisk?.(r)
      show(merged)
      if (merged !== r.text) s.changed()
    } catch (e) {
      if (!mine()) return
      go({ type: "read" })
      if (ghost === null && gone(e) && where() === path) o.current.onGone()
    }
  }

  /** The file changed elsewhere in lines typed here: both sides kept as versions in File history, the rest merged,
   *  and the clashing lines shown to settle (in the editor when it can, else `keep`). False: no clash after all. */
  const clash = (base: string, theirs: FileText): boolean => {
    // (both sides made the same edit, which merge3 refuses: the merge taken, as a check takes one)
    const take = (text: string) => {
      s.disk = theirs.text
      mtime = theirs.mtime
      o.current.onDisk?.(theirs)
      tell({ kind: "ok" })
      show(text)
      if (text !== theirs.text) s.changed()
      else dropDraft(path)
    }
    const first = mergeClashes(base, now(), theirs.text)
    if (!first.clashes.length) { take(first.text); return false }
    const lines = (cs: Clash[]) => cs.map((k) => k.at + 1)
    tell({ kind: "conflict", base, theirs, lines: lines(first.clashes) })
    void post("history/keep", { path: where() }).catch(() => {})
    void post("history/keep", { path: where(), text: now() }).catch(() => {})
    void whoWrote(where(), theirs.mtime).then((who) => {
      if (ghost !== null || status.kind !== "conflict" || status.theirs !== theirs) return
      // (typed on meanwhile: merged again)
      const { text, clashes } = mergeClashes(base, now(), theirs.text)
      if (!clashes.length) { go({ type: "resolve" }); return take(text) } // typed away meanwhile
      const inline = !!o.current.conflict?.(text, clashes, who, s.left)
      if (inline) { s.disk = theirs.text; mtime = theirs.mtime; o.current.onDisk?.(theirs) }
      last = { kind: "conflict", base, theirs, lines: lines(clashes), who, inline }
      tell(last)
    })
    return true
  }

  /** Send what's pending without the view (it's going); a failure is a toast holding the edits. */
  const flush = (base: string, say: boolean) => {
    const text = now()
    if (text === base || o.current.readOnly || typedLive(where())) return
    // (kept here first: a save too big for keepalive is a plain one, which a closed window may cut short)
    keepDraft(path, text, base)
    const send = async (base: string | null) => {
      sentMaybe(text)
      const r = await put(text, base, { keepalive: true })
      if (r.status === 409) throw Object.assign(new Error(changedText()), { conflict: true })
      if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).error ?? r.statusText), { gone: r.status === 404 })
      dropDraft(path)
    }
    const changedText = () => (status.kind === "conflict" ? conflictText(status).replace(/\.$/, "") : "it changed elsewhere in the same lines")
    const id = `unsaved:${path}`, saved = () => notify(`Saved ${stem(path)}`, { id })
    const unsaved = (e: unknown) => {
      const mine = !!(e as { conflict?: boolean }).conflict, why = mine ? null : errorReason(e)
      notify(mine ? `Your edits to ${stem(path)} aren't saved: ${lower((e as Error).message)}` : `Couldn't save ${stem(path)}${why ? `: ${why}` : ""}`, { kind: "error", duration: 15_000, id,
        action: { label: mine ? "Keep yours" : "Try again", run: async () => {
          // (theirs is kept in File history first: nothing is lost)
          if (mine) await post("history/keep", { path: where() }).catch(() => {})
          await send(mine ? null : base)
          notify(mine ? `Saved yours; ${theirName(status.kind === "conflict" ? status.who : undefined)} version is in the note's history` : `Saved ${stem(path)}`, { id })
        } } })
    }
    if (status.kind === "conflict") { if (say) unsaved({ message: changedText(), conflict: true }); return }
    send(base).catch((e) => {
      if (!say) return
      if (!(e as { gone?: boolean }).gone) unsaved(e)
      // (deleted in the app meanwhile: that's what the user did; elsewhere: the edits are offered back)
      else if (deletedHere(path)) dropDraft(path)
      else notify(`${stem(path)} was moved or deleted before your last edits were saved`, {
        kind: "error", duration: 15_000, id, action: { label: "Save them", run: async () => { await send(null); saved() } },
      })
    })
  }

  const s = {
    /** What the server has: the base for merges. */
    disk: initial,
    use(options: Options) { o.current = options },
    /** Drawn: going, what's pending is sent at once, after a save on its way and merged with its answer (on the save's
     *  text if the page itself goes). A failed save is sent again on reconnecting and when the page is shown. */
    mount() {
      ghost = null
      go({ type: "mount" })
      const leave = () => flush(inflight?.text ?? s.disk, false)
      const back = () => go({ type: "retry" })
      const shown = () => { if (document.visibilityState === "visible") back() }
      addEventListener("pagehide", leave)
      addEventListener("online", back)
      document.addEventListener("visibilitychange", shown)
      const unback = onReconnect(back)
      const unhand = onHandBack((p, base) => {
        if (p !== where()) return
        if (base !== null && base !== s.disk) { s.disk = base; mtime = 0; unconfirmed = [] }
        go({ type: "rebase" })
      })
      const untrack = trackUnsaved(() => !o.current.readOnly && !typedLive(where()) && (phase.kind === "pending" || phase.kind === "saving" || status.kind !== "ok" || now() !== s.disk), where)
      return () => {
        ghost = o.current.text()
        untrack()
        unback()
        unhand()
        removeEventListener("pagehide", leave)
        removeEventListener("online", back)
        document.removeEventListener("visibilitychange", shown)
        if (drafting) { clearTimeout(drafting); drafting = null }
        go({ type: "close" })
      }
    },
    get conflict() { return phase.kind === "conflict" },

    /** Typed: saved 600 ms after the last change (during a conflict, only said again). */
    changed() {
      // (typed in together, core/cosync.ts: the server saves it; this one only once it's alone again)
      if (keptLive(where())) return
      go({ type: "typed" })
    },

    /** Saved now (`force`: even as it is on disk, or during a conflict, to settle it); after a save on its way. */
    save(force = false): Promise<void> {
      go({ type: "save", force })
      return inflight?.done ?? Promise.resolve()
    },

    /** Everything saved, waited for (before a rename). */
    async settle() {
      if (phase.kind === "pending") await s.save()
      while (inflight) await inflight.done
      if (now() !== s.disk && phase.kind !== "conflict") await s.save()
    },
    /** `settle` once a conflict is settled (before typing in together: a doc shared then would take the clashing text
     *  as typed, and the conflict's lines would cover the whole note). */
    async calm() {
      while (phase.kind === "conflict") await new Promise<void>((r) => calmed.push(r))
      await s.settle()
    },

    /** Merge in what's on disk (`known`: just read). While a save is pending or on its way, it runs after it. */
    check(known?: FileText) {
      if (keptLive(where())) return
      // (a read older than the last save, the one made as the view opened: the save brought newer text)
      if (known && known.mtime < mtime) return
      go({ type: "check", known })
    },

    /** Conflicts left in the editor: none, saved; one back (undone), held again; `rest`, its editor went with them (no
     *  longer in place: settled with `keep` till another editor shows them). */
    left(n: number, rest?: Clash[]) {
      if (rest) {
        if (s.conflict && status.kind === "conflict") { parked = { text: now(), clashes: rest }; tell({ ...status, inline: false }) }
        return
      }
      if (!n && s.conflict) { tell({ kind: "ok" }); go({ type: "resolve" }); void s.save() }
      else if (n && !s.conflict && last) { tell(last); go({ type: "clash" }) }
    },
    /** A new editor drawn: the conflicts its last one left, shown again (if the text is as they left it). */
    reshow() {
      const c = status, p = parked
      if (c.kind !== "conflict" || !p || now() !== p.text || !o.current.conflict?.(p.text, p.clashes, c.who, s.left)) return
      parked = null
      tell({ ...c, inline: true })
    },
    /** Settle a conflict not shown in place: the clashing lines as typed here (`mine`) or as on disk, the rest merged;
     *  a toast says where the other side is, and Undo brings the choice back. */
    keep(side: "mine" | "theirs") {
      if (status.kind !== "conflict") return
      const c = status, typed = now(), p = parked, was = s.disk
      // (left by its editor: theirs is merged in already, mine in the clashes, perhaps typed over since)
      const { text: merged, clashes } = p ? mergeClashes(p.text, typed, withTheirs(p.text, p.clashes)) : mergeClashes(c.base, typed, c.theirs.text)
      const text = side === "mine" ? (p ? typed : merged) : withTheirs(merged, clashes)
      s.disk = c.theirs.text
      mtime = c.theirs.mtime
      show(text)
      tell({ kind: "ok" })
      go({ type: "resolve" })
      const saved = text === c.theirs.text ? Promise.resolve() : s.save(true)
      if (text === c.theirs.text) dropDraft(path)
      // (the file as this choice saved it: anything typed after it, saved or not, would be lost to an undo)
      const kept = saved.then(() => s.disk)
      const undo = async () => {
        const disk = await kept
        if (s.disk !== disk || now() !== disk) throw new Error("Couldn't undo: the text changed since. Both versions are in the note's history.")
        // (the file back as it was, the text as typed, and the choice again)
        if (side === "mine" && s.disk !== c.theirs.text) await putJson("file", { path: where(), text: c.theirs.text, base: s.disk })
        s.disk = was
        show(typed)
        tell(c)
        go({ type: "clash" })
        parked = p
        s.reshow()
      }
      notify(side === "mine" ? `Kept yours; ${theirName(c.who)} version is in the note's history` : `Kept ${theirName(c.who)} version; yours is in the note's history`,
        { id: `unsaved:${path}`, action: { label: "Undo", run: undo } })
    },
  }
  return s
}
