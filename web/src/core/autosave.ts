import { useEffect, useLayoutEffect, useState } from "react"
import { get, post, put as putJson, request } from "@/core/http"
import { deletedHere, gone, moveMark, readFile, splitFm, stem, whereNow, type FileText } from "@/core/files"
import { onReconnect, useVaultChange } from "@/core/live"
import { differences, merge3, mergeClashes, type Clash } from "@/core/merge"
import { errorReason, notify } from "@/core/notify"
import { dropDraft, keepDraft } from "@/core/drafts"
import { trackUnsaved } from "@/core/unsaved"
import type { SaveBody } from "../../../core/contracts/save.ts"
import { applyEdit, editOf, LEAN_PAST, textHash } from "../../../core/texthash.ts"
import { keptLive, onHandBack, typedLive } from "@/core/cosync"
import { trace } from "@/core/trace"
import { errorIn } from "../../../core/plainerror.ts"

export type Conflict = { kind: "conflict"; base: string; theirs: FileText; lines: number[]; who?: string; inline?: boolean; version?: boolean; note?: string }
export type SaveStatus = { kind: "ok" } | { kind: "error"; message: string } | Conflict

type Options = {
  text: () => string
  apply: (text: string) => void
  onStatus: (s: SaveStatus) => void
  onDisk?: (f: FileText) => void
  conflict?: (text: string, clashes: Clash[], who: string | undefined, left: (n: number, rest?: Clash[]) => void, note?: string) => boolean
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

async function whoWrote(path: string, mtime: number): Promise<string | undefined> {
  type Ev = { t: number; last?: number; actor: { kind: string; name: string }; action: string; paths?: string[]; wrote?: string[] }
  const ask = get<{ events: Ev[] }>(`activity?path=${encodeURIComponent(path)}&action=changes,request&limit=10&settled=1&since=${mtime - 15 * 60_000}`)
  const r = await Promise.race([ask.catch(() => null), new Promise<null>((ok) => setTimeout(() => ok(null), 3000))])
  const e = r?.events.find((x) => (x.actor.kind === "agent" || x.actor.kind === "cli") && x.t - 1000 <= mtime && mtime <= (x.last ?? x.t) + 5000
    && (x.action !== "request" || (x.wrote ?? x.paths)?.includes(path)))
  return e?.actor.name
}

export const theirName = (who?: string) => (who ? `${who}'s` : "the other")

export function conflictText(c: Conflict, above = 0) {
  const ns = [...new Set(c.lines.map((n) => n - above).filter((n) => n > 0))]
  const lines = !ns.length ? "" : ns.length === 1 ? `line ${ns[0]}` : `lines ${ns.slice(0, -1).join(", ")} and ${ns.at(-1)}`
  const where = c.lines.some((n) => n <= above) ? (lines ? `the properties and ${lines}` : "the properties") : lines
  if (c.version) return `${where ? `${where[0].toUpperCase()}${where.slice(1)} ${where.startsWith("line ") ? "differs" : "differ"}` : "It differs"} in the version iCloud kept from ${c.who ?? "another device"}.`
  if (!where) return c.who ? `${c.who} edited it while you typed.` : "It changed elsewhere while you typed."
  return c.who ? `${c.who} edited ${where} while you typed.` : `${where[0].toUpperCase()}${where.slice(1)} changed elsewhere while you typed.`
}

class NotSaved extends Error {
  why: "conflict" | "gone" | "refused"
  constructor(message: string, why: NotSaved["why"]) { super(message); this.why = why }
}
const lower = (s: string) => s.replace(/^(Lines?|The) /, (w) => w.toLowerCase())

function withTheirs(text: string, clashes: Clash[]) {
  const lines = text.split("\n")
  for (const k of [...clashes].reverse()) lines.splice(k.at, k.mine.length, ...k.theirs)
  return lines.join("\n")
}

export type Phase =
  | { kind: "idle" }
  | { kind: "pending"; recheck: boolean }
  | { kind: "checking"; again: boolean }
  | { kind: "saving"; typed: boolean; again: boolean; recheck: boolean; tries: number }
  | { kind: "conflict"; recheck: boolean }
  | { kind: "error"; tries: number; retry: boolean }
  | { kind: "closing"; was: Extract<Phase, { kind: "saving" }> }
  | { kind: "gone" }

export type SaveEvent =
  | { type: "typed" } | { type: "due" } | { type: "save"; force?: boolean } | { type: "check"; known?: FileText }
  | { type: "read" }
  | { type: "saved"; again?: boolean } | { type: "failed"; retry: boolean }
  | { type: "clash" } | { type: "resolve" } | { type: "retry" } | { type: "close" } | { type: "mount" }
  | { type: "rebase" }

type Effect = "arm" | "send" | "read" | "flush" | "tell" | "drop" | "calm"

export function step(p: Phase, e: SaveEvent, nothing: () => boolean): { to: Phase; do: Effect[] } {
  const go = (to: Phase, ...d: Effect[]) => ({ to, do: d })
  const rest = (recheck: boolean, ...d: Effect[]) => (recheck ? go({ kind: "checking", again: false }, "read", ...d)
    : nothing() ? go({ kind: "idle" }, "calm", ...d) : go({ kind: "pending", recheck: false }, "arm", ...d))
  const send = (recheck: boolean, tries = 0) => go({ kind: "saving", typed: false, again: false, recheck, tries }, "send")
  switch (e.type) {
    case "typed":
      if (p.kind === "idle" || p.kind === "error") return go({ kind: "pending", recheck: false }, "arm")
      if (p.kind === "pending") return go(p, "arm")
      if (p.kind === "checking") return go({ kind: "pending", recheck: true }, "arm")
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
      if (p.recheck) return go({ kind: "checking", again: false }, "read")
      return go({ kind: "error", tries: p.tries + 1, retry: e.retry })
    case "clash":
      if (p.kind === "closing") return go({ kind: "gone" }, "flush")
      if (p.kind === "saving" || p.kind === "pending") return go({ kind: "conflict", recheck: p.recheck })
      if (p.kind === "checking") return go({ kind: "conflict", recheck: true })
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
      // React's strict mode unmounts and mounts a view again at once.
      if (p.kind === "closing") return go(p.was)
      return p.kind === "gone" ? rest(false) : go(p)
    case "rebase":
      if (p.kind === "checking") return go({ kind: "checking", again: false }, "read")
      if (p.kind === "saving") return go({ ...p, again: true })
      if (p.kind !== "idle" && p.kind !== "pending" && p.kind !== "error") return go(p)
      return nothing() ? rest(p.kind === "pending" && p.recheck) : send(p.kind === "pending" && p.recheck)
  }
}

const holding = new Set<() => string>()
export const heldByConflict = (path: string) => [...holding].some((w) => w() === path)

const backoff = (tries: number) => Math.min(30_000, 1000 * 2 ** tries)
const SAVE_WAIT = 60_000
// fetch's keepalive takes a body of 64 KB at most.
const KEEPALIVE_MAX = 60_000

export function makeAutosave(path: string, initial: string, options: Options) {
  const o = { current: options }
  const opened = moveMark()
  const where = () => whereNow(path, opened)
  let phase: Phase = { kind: "idle" }
  let timer: ReturnType<typeof setTimeout> | null = null, drafting: ReturnType<typeof setTimeout> | null = null
  let retrying: ReturnType<typeof setTimeout> | null = null
  let status: SaveStatus = { kind: "ok" }
  let mtime = 0
  let inflight: { text: string; done: Promise<void> } | null = null
  let reading = 0
  let ghost: string | null = null
  const now = () => ghost ?? o.current.text()
  const show = (text: string) => { if (ghost === null) o.current.apply(text); else ghost = text }
  let last: Conflict | null = null
  let parked: { text: string; clashes: Clash[] } | null = null
  let calmed: (() => void)[] = []
  let unconfirmed: string[] = []
  const sentMaybe = (text: string) => { unconfirmed = [...unconfirmed.filter((t) => t !== text), text].slice(-5) }
  const ownSave = (disk: string, base: string) => {
    const body = splitFm(disk).body
    return unconfirmed.find((t) => t === disk || (splitFm(t).body === body && body !== splitFm(base).body))
  }
  const adopt = (own: string, disk: string) => {
    const typed = now(), merged = own === disk ? typed : merge3(own, typed, disk) ?? typed
    if (merged !== typed) show(merged)
  }
  const tell = (st: SaveStatus) => { status = st; o.current.onStatus(st) }
  const put = async (text: string, base: string | null, init?: RequestInit) => {
    const fits = (n: number) => (init?.keepalive && n > KEEPALIVE_MAX ? { ...init, keepalive: false } : init)
    if (base === null) return request("PUT", "file", { path: where(), text, base } satisfies SaveBody, fits(text.length))
    const edit = editOf(base, text)
    const r = await request("PUT", "file", { path: where(), edit, baseHash: textHash(base), lean: true } satisfies SaveBody, fits(edit.add.length + 200))
    return r.status === 412 ? request("PUT", "file", { path: where(), text, base, lean: true } satisfies SaveBody, fits(text.length + base.length)) : r
  }
  const answer = async (r: Response, sent: string): Promise<FileText & { error?: string }> => {
    const j = await r.json()
    return j.same ? { ...j, text: sent } : j.edit ? { ...j, text: applyEdit(sent, j.edit) ?? sent } : j
  }

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

  const arm = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; go({ type: "due" }) }, 600)
    // What a closing window writes at pagehide doesn't reach IndexedDB, so the draft is kept as typing pauses.
    if (drafting) clearTimeout(drafting)
    drafting = setTimeout(() => { drafting = null; const text = now(); if (text !== s.disk) keepDraft(path, text, s.disk) }, 100)
  }

  const send = async () => {
    if (drafting) { clearTimeout(drafting); drafting = null }
    const sent = now(), base = s.disk, retried = phase.kind === "saving" && phase.tries > 0
    keepDraft(path, sent, base)
    let finish = () => {}
    inflight = { text: sent, done: new Promise<void>((r) => { finish = r }) }
    const ours = () => phase.kind === "saving" || phase.kind === "closing"
    let r: Response | null = null, next: SaveEvent
    try {
      r = await put(sent, base, { signal: AbortSignal.timeout?.(SAVE_WAIT) })
      const j = await answer(r, sent)
      if (r.status === 409) {
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
          if (j.text !== sent) show(j.text)
        } else {
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
      if (ours() && !(retried && status.kind === "error" && status.message === message)) tell({ kind: "error", message })
      next = { type: "failed", retry: !r || r.status >= 500 || r.status === 408 || r.status === 429 }
    }
    inflight = null
    finish()
    go(next)
  }

  const read = async (known?: FileText) => {
    const id = ++reading, before = s.disk
    const mine = () => id === reading && phase.kind === "checking"
    try {
      if (keptLive(where())) return void go({ type: "read" })
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

  const clash = (base: string, theirs: FileText): boolean => {
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
      const { text, clashes } = mergeClashes(base, now(), theirs.text)
      if (!clashes.length) { go({ type: "resolve" }); return take(text) }
      const inline = !!o.current.conflict?.(text, clashes, who, s.left)
      if (inline) { s.disk = theirs.text; mtime = theirs.mtime; o.current.onDisk?.(theirs) }
      last = { kind: "conflict", base, theirs, lines: lines(clashes), who, inline }
      tell(last)
    })
    return true
  }

  const flush = (base: string, say: boolean) => {
    const text = now()
    if (text === base || o.current.readOnly || typedLive(where())) return
    // A save too big for keepalive is a plain one, which a closing window may cut short.
    keepDraft(path, text, base)
    const send = async (base: string | null) => {
      sentMaybe(text)
      const r = await put(text, base, { keepalive: true })
      if (r.status === 409) throw new NotSaved(changedText(), "conflict")
      if (!r.ok) throw new NotSaved(errorIn(await r.json().catch(() => ({}))) ?? r.statusText, r.status === 404 ? "gone" : "refused")
      dropDraft(path)
    }
    const changedText = () => (status.kind === "conflict" ? conflictText(status).replace(/\.$/, "") : "it changed elsewhere in the same lines")
    const id = `unsaved:${path}`, saved = () => notify(`Saved ${stem(path)}`, { id })
    const unsaved = (e: unknown) => {
      const mine = e instanceof NotSaved && e.why === "conflict", why = mine ? null : errorReason(e)
      notify(mine ? `Your edits to ${stem(path)} aren't saved: ${lower(e.message)}` : `Couldn't save ${stem(path)}${why ? `: ${why}` : ""}`, { kind: "error", duration: 15_000, id,
        action: { label: mine ? "Keep yours" : "Try again", run: async () => {
          if (mine) await post("history/keep", { path: where() }).catch(() => {})
          await send(mine ? null : base)
          notify(mine ? `Saved yours; ${theirName(status.kind === "conflict" ? status.who : undefined)} version is in the note's history` : `Saved ${stem(path)}`, { id })
        } } })
    }
    if (status.kind === "conflict") { if (say) unsaved(new NotSaved(changedText(), "conflict")); return }
    send(base).catch((e) => {
      if (!say) return
      if (!(e instanceof NotSaved && e.why === "gone")) unsaved(e)
      else if (deletedHere(path)) dropDraft(path)
      else notify(`${stem(path)} was moved or deleted before your last edits were saved`, {
        kind: "error", duration: 15_000, id, action: { label: "Save them", run: async () => { await send(null); saved() } },
      })
    })
  }

  const s = {
    disk: initial,
    use(options: Options) { o.current = options },
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

    changed() {
      if (keptLive(where())) return
      go({ type: "typed" })
    },

    save(force = false): Promise<void> {
      go({ type: "save", force })
      return inflight?.done ?? Promise.resolve()
    },

    async settle() {
      if (phase.kind === "pending") await s.save()
      while (inflight) await inflight.done
      if (now() !== s.disk && phase.kind !== "conflict") await s.save()
    },
    async calm() {
      while (phase.kind === "conflict") await new Promise<void>((r) => calmed.push(r))
      await s.settle()
    },

    check(known?: FileText) {
      if (keptLive(where())) return
      if (known && known.mtime < mtime) return
      go({ type: "check", known })
    },

    left(n: number, rest?: Clash[]) {
      if (rest) {
        if (s.conflict && status.kind === "conflict") { parked = { text: now(), clashes: rest }; tell({ ...status, inline: false }) }
        return
      }
      if (!n && s.conflict) { tell({ kind: "ok" }); go({ type: "resolve" }); void s.save() }
      else if (n && !s.conflict && last) { tell(last); go({ type: "clash" }) }
    },
    reshow() {
      const c = status, p = parked
      if (c.kind !== "conflict" || !p || now() !== p.text || !o.current.conflict?.(p.text, p.clashes, c.who, s.left, c.note)) return
      parked = null
      tell({ ...c, inline: true })
    },
    keep(side: "mine" | "theirs") {
      if (status.kind !== "conflict") return
      const c = status, typed = now(), p = parked, was = s.disk
      const disk = c.version ? was : c.theirs.text
      const { text: merged, clashes } = p ? mergeClashes(p.text, typed, withTheirs(p.text, p.clashes)) : mergeClashes(c.base, typed, c.theirs.text)
      const text = side === "mine" ? (p ? typed : merged) : withTheirs(merged, clashes)
      s.disk = disk
      if (!c.version) mtime = c.theirs.mtime
      show(text)
      tell({ kind: "ok" })
      go({ type: "resolve" })
      const saved = text === disk ? Promise.resolve() : s.save(true)
      if (text === disk) dropDraft(path)
      const kept = saved.then(() => s.disk)
      const undo = async () => {
        const disk = await kept
        if (s.disk !== disk || now() !== disk) throw new Error("Couldn't undo: the text changed since. Both versions are in the note's history.")
        if ((side === "mine" || c.version) && s.disk !== disk) await putJson("file", { path: where(), text: disk, base: s.disk } satisfies SaveBody)
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

    async mergeIn(base: string | null, other: string, who: string): Promise<"same" | "merged" | "settled" | "unsaved"> {
      await s.calm()
      const mine = now()
      const { text, clashes } = base === null ? differences(mine, other) : mergeClashes(base, mine, other)
      if (!clashes.length && text === mine) return "same"
      await post("history/keep", { path: where(), text: other }).catch(() => {})
      if (!clashes.length) {
        show(text)
        s.changed()
        await s.save()
        return now() === s.disk ? "merged" : "unsaved"
      }
      const note = `iCloud kept another version of this from ${who}`
      if (!o.current.conflict?.(text, clashes, who, s.left, note)) return "unsaved"
      const c: Conflict = { kind: "conflict", base: base ?? mine, theirs: { path: where(), text: other, mtime, kind: null, problems: [] }, lines: clashes.map((k) => k.at + 1), who, inline: true, version: true, note }
      last = c
      tell(c)
      go({ type: "clash" })
      await s.calm()
      return now() === s.disk ? "settled" : "unsaved"
    },
  }
  return s
}
