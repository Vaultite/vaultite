// A file's autosave (the file view, a canvas's note cards): saved 600 ms after typing stops, on top of a save on its
// way; changes on disk merged in (3-way); what's pending sent when the view goes, and kept on the device until saved.
import { useEffect, useLayoutEffect, useState } from "react"
import { get, post, put as putJson, request } from "@/core/http"
import { deletedHere, gone, moveMark, readFile, splitFm, stem, whereNow, type FileText } from "@/core/files"
import { useVaultChange } from "@/core/live"
import { merge3, mergeClashes, type Clash } from "@/core/merge"
import { notify } from "@/core/notify"
import { dropDraft, keepDraft } from "@/core/drafts"
import { trackUnsaved } from "@/core/unsaved"
import { LEAN_PAST, textHash } from "../../../core/texthash.ts"

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

function makeAutosave(path: string, initial: string, options: Options) {
  const o = { current: options }
  const opened = moveMark()
  const where = () => whereNow(path, opened)
  let timer: ReturnType<typeof setTimeout> | null = null
  let saving = false, again = false, recheck = false
  let status: SaveStatus = { kind: "ok" }
  /** The last conflict, to go back to (Undo); and what's left of it when its editor went (a switch to source mode). */
  let last: Conflict | null = null
  let parked: Clash[] | null = null
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
    const now = o.current.text(), merged = own === disk ? now : merge3(own, now, disk) ?? now
    if (merged !== now && s.alive) o.current.apply(merged)
  }
  const tell = (s: SaveStatus) => { status = s; o.current.onStatus(s) }
  /** A save: a big file's sends its base's fingerprint, the base only if the server asks (it changed on disk), and gets
   *  back no copy of its own text. */
  const put = async (text: string, base: string | null, init?: RequestInit) => {
    const lean = base !== null && (text.length > LEAN_PAST || base.length > LEAN_PAST)
    let r = await request("PUT", "file", lean ? { path: where(), text, baseHash: textHash(base), lean } : { path: where(), text, base }, init)
    if (r.status === 412) r = await request("PUT", "file", { path: where(), text, base, lean }, init)
    return r
  }
  /** The server's answer, with the text it left out (the same as sent). */
  const answer = async (r: Response, sent: string): Promise<FileText & { error?: string }> => {
    const j = await r.json()
    return j.same ? { ...j, text: sent } : j
  }

  const s = {
    /** What the server has: the base for merges; and when it was written, once known. */
    disk: initial,
    mtime: 0,
    /** The save on its way, so a later save or the last flush builds on it. */
    inflight: null as { text: string; done: Promise<void> } | null,
    alive: true,
    use(options: Options) { o.current = options },
    /** Drawn: going, what's pending is saved at once, after a save on its way (on its text if the page itself goes). */
    mount() {
      s.alive = true
      const leave = () => s.flush(s.inflight?.text ?? s.disk, false)
      addEventListener("pagehide", leave)
      const untrack = trackUnsaved(() => !o.current.readOnly && (!!timer || saving || status.kind !== "ok" || o.current.text() !== s.disk))
      return () => {
        s.alive = false
        untrack()
        removeEventListener("pagehide", leave)
        s.stopTimer()
        if (s.inflight) s.inflight.done.then(() => s.flush(s.disk, true))
        else s.flush(s.disk, true)
      }
    },
    get conflict() { return status.kind === "conflict" },
    stopTimer() { if (timer) { clearTimeout(timer); timer = null } },

    /** Typed: saved 600 ms after the last change (during a conflict, only said again). */
    changed() {
      if (s.conflict) return tell(status)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => s.save(), 600)
    },

    async save(force = false): Promise<void> {
      s.stopTimer()
      if (s.conflict && !force) return
      if (saving) { again = true; return s.inflight?.done }
      const sent = o.current.text(), base = s.disk
      if (sent === base && !force) { dropDraft(path); return }
      keepDraft(path, sent, base)
      saving = true
      let finish = () => {}
      s.inflight = { text: sent, done: new Promise<void>((r) => { finish = r }) }
      let r: Response | null = null
      try {
        r = await put(sent, base)
        const j = await answer(r, sent)
        if (r.status === 409) {
          // On disk is a save of ours whose answer was lost: that's the base, and saving again merges onto it.
          const own = ownSave(j.text, base)
          if (own !== undefined) { s.disk = j.text; s.mtime = j.mtime; unconfirmed = []; adopt(own, j.text); again = true; return }
          return void s.clash(base, j)
        }
        if (!r.ok) throw new Error(j.error || r.statusText)
        o.current.onDisk?.(j)
        s.mtime = j.mtime
        const now = o.current.text()
        if (j.text === sent || now === sent) {
          s.disk = j.text
          if (j.text !== sent && s.alive) o.current.apply(j.text) // the server filled something in, or merged a change from disk
        } else {
          // Typed more while it saved, and the server's differs: keep both, or the next save gets the 409.
          const merged = merge3(sent, now, j.text)
          if (merged !== null) { s.disk = j.text; if (s.alive) o.current.apply(merged) } else s.disk = sent
          s.changed()
        }
        if (o.current.text() === s.disk) dropDraft(path)
        unconfirmed = []
        tell({ kind: "ok" })
      } catch (e) {
        if (!r) sentMaybe(sent)
        tell({ kind: "error", message: String((e as Error).message ?? e) })
      } finally {
        saving = false
        s.inflight = null
        finish()
        if (again) { again = false; void s.save() }
        else if (recheck && !timer) void s.check()
      }
    },

    /** Everything saved, waited for (before a rename). */
    async settle() {
      if (timer) await s.save()
      while (s.inflight) await s.inflight.done
      if (o.current.text() !== s.disk && !s.conflict) await s.save()
    },

    /** Merge in what's on disk (`known`: just read). While a save is pending or on its way, it runs after it. */
    async check(known?: FileText) {
      if (saving || timer || s.conflict) { recheck = !s.conflict; return }
      recheck = false
      const before = s.disk
      try {
        // (a big file is read again only when it changed since: the change is often this view's own save)
        if (!known && s.mtime && before.length > LEAN_PAST && (await get<{ mtime: number }>(`file/info?path=${encodeURIComponent(where())}`)).mtime === s.mtime) return
        const r = known ?? await readFile(where())
        // Anything saved meanwhile makes this answer old: the save brought the new text.
        if (!s.alive || s.disk !== before || saving || timer || s.conflict || r.text === before) return
        const now = o.current.text()
        const own = ownSave(r.text, before)
        if (own !== undefined) unconfirmed = []
        const merged = own !== undefined ? (own === r.text ? now : merge3(own, now, r.text) ?? now) : now === before ? r.text : merge3(before, now, r.text)
        if (merged === null) return void s.clash(before, r)
        s.disk = r.text
        s.mtime = r.mtime
        o.current.onDisk?.(r)
        o.current.apply(merged)
        if (merged !== r.text) s.changed()
      } catch (e) {
        if (s.alive && gone(e) && where() === path) o.current.onGone()
      }
    },

    /** The file changed elsewhere in lines typed here: both sides kept as versions in File history, the rest merged,
     *  and the clashing lines shown to settle (in the editor when it can, else `keep`). Saving waits till then. */
    async clash(base: string, theirs: FileText) {
      // No clash after all (both sides made the same edit, which merge3 refuses): the merge taken, as a check takes one.
      const merged = (text: string) => {
        s.disk = theirs.text
        s.mtime = theirs.mtime
        o.current.onDisk?.(theirs)
        tell({ kind: "ok" })
        if (s.alive) o.current.apply(text)
        if (text !== theirs.text) s.changed()
        else dropDraft(path)
      }
      const first = mergeClashes(base, o.current.text(), theirs.text)
      if (!first.clashes.length) return merged(first.text)
      const lines = (cs: Clash[]) => cs.map((k) => k.at + 1)
      tell({ kind: "conflict", base, theirs, lines: lines(first.clashes) })
      void post("history/keep", { path: where() }).catch(() => {})
      void post("history/keep", { path: where(), text: o.current.text() }).catch(() => {})
      const who = await whoWrote(where(), theirs.mtime)
      if (!s.alive || status.kind !== "conflict" || status.theirs !== theirs) return
      // (typed on meanwhile: merged again)
      const { text, clashes } = mergeClashes(base, o.current.text(), theirs.text)
      if (!clashes.length) return merged(text) // typed away meanwhile
      const inline = !!o.current.conflict?.(text, clashes, who, s.left)
      if (inline) { s.disk = theirs.text; s.mtime = theirs.mtime; o.current.onDisk?.(theirs) }
      last = { kind: "conflict", base, theirs, lines: lines(clashes), who, inline }
      tell(last)
    },
    /** Conflicts left in the editor: none, saved; one back (undone), held again; `rest`, its editor went with them. */
    left(n: number, rest?: Clash[]) {
      if (rest) { if (s.conflict) parked = rest; return }
      if (!n && s.conflict) { parked = null; tell({ kind: "ok" }); void s.save() }
      else if (n && !s.conflict && last) tell(last)
    },
    /** A new editor drawn: the conflicts its last one left, shown again (else settled with `keep`). */
    reshow() {
      const c = status, rest = parked
      if (c.kind !== "conflict" || !c.inline || !rest) return
      parked = null
      if (!o.current.conflict?.(o.current.text(), rest, c.who, s.left)) tell({ ...c, inline: false })
    },
    /** Settle a conflict not shown in place: the clashing lines as typed here (`mine`) or as on disk, the rest merged;
     *  a toast says where the other side is, and Undo brings the choice back. */
    keep(side: "mine" | "theirs") {
      if (status.kind !== "conflict") return
      const c = status, typed = o.current.text()
      const { text: merged, clashes } = mergeClashes(c.base, typed, c.theirs.text)
      const text = side === "mine" ? merged : withTheirs(merged, clashes)
      s.disk = c.theirs.text
      s.mtime = c.theirs.mtime
      o.current.apply(text)
      tell({ kind: "ok" })
      const saved = text === c.theirs.text ? Promise.resolve() : s.save(true)
      if (text === c.theirs.text) dropDraft(path)
      // (the file as this choice saved it: anything typed after it, saved or not, would be lost to an undo)
      const kept = saved.then(() => s.disk)
      const undo = async () => {
        const disk = await kept
        if (s.disk !== disk || o.current.text() !== disk) throw new Error("Couldn't undo: the text changed since. Both versions are in the note's history.")
        // (the file back as it was, the text as typed, and the choice again)
        if (side === "mine" && s.disk !== c.theirs.text) await putJson("file", { path: where(), text: c.theirs.text, base: s.disk })
        s.disk = c.base
        o.current.apply(typed)
        tell(c)
      }
      notify(side === "mine" ? `Kept yours; ${theirName(c.who)} version is in the note's history` : `Kept ${theirName(c.who)} version; yours is in the note's history`,
        { id: `unsaved:${path}`, action: { label: "Undo", run: undo } })
    },

    /** Send what's pending without the view (it's going); a failure is a toast holding the edits. */
    flush(base: string, say: boolean) {
      const text = o.current.text()
      if (text === base || o.current.readOnly) return
      // (kept here first: keepalive takes 64 KB at most, so a bigger save is a plain one, which a closed window may cut short)
      keepDraft(path, text, base)
      const send = async (base: string | null) => {
        sentMaybe(text)
        const r = await put(text, base, { keepalive: text.length < 60_000 })
        if (r.status === 409) throw Object.assign(new Error(changedText()), { conflict: true })
        if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).error ?? r.statusText), { gone: r.status === 404 })
        dropDraft(path)
      }
      const changedText = () => (status.kind === "conflict" ? conflictText(status).replace(/\.$/, "") : "it changed elsewhere in the same lines")
      const id = `unsaved:${path}`, saved = () => notify(`Saved ${stem(path)}`, { id })
      const unsaved = (e: unknown) => {
        const mine = !!(e as { conflict?: boolean }).conflict
        notify(mine ? `Your edits to ${stem(path)} aren't saved: ${lower((e as Error).message)}` : `Couldn't save ${stem(path)}: ${(e as Error).message ?? e}`, { kind: "error", duration: 15_000, id,
          action: { label: mine ? "Keep yours" : "Try again", run: async () => {
            // (theirs is kept in File history first: nothing is lost)
            if (mine) await post("history/keep", { path: where() }).catch(() => {})
            await send(mine ? null : base)
            notify(mine ? `Saved yours; ${theirName(status.kind === "conflict" ? status.who : undefined)} version is in the note's history` : `Saved ${stem(path)}`, { id })
          } } })
      }
      if (s.conflict) { if (say) unsaved({ message: changedText(), conflict: true }); return }
      send(base).catch((e) => {
        if (!say) return
        if (!(e as { gone?: boolean }).gone) unsaved(e)
        // (deleted in the app meanwhile: that's what the user did; elsewhere: the edits are offered back)
        else if (deletedHere(path)) dropDraft(path)
        else notify(`${stem(path)} was moved or deleted before your last edits were saved`, {
          kind: "error", duration: 15_000, id, action: { label: "Save them", run: async () => { await send(null); saved() } },
        })
      })
    },
  }
  return s
}
