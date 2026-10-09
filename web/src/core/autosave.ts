// A file's autosave (the file view, a canvas's note cards): saved 600 ms after typing stops, on top of a save on its
// way; changes on disk merged in (3-way); what's pending sent when the view goes, and kept on the device until saved.
import { useEffect, useLayoutEffect, useState } from "react"
import { get, request } from "@/core/http"
import { deletedHere, gone, moveMark, readFile, stem, whereNow, type FileText } from "@/core/files"
import { useVaultChange } from "@/core/live"
import { merge3 } from "@/core/merge"
import { notify } from "@/core/notify"
import { dropDraft, keepDraft } from "@/core/drafts"
import { trackUnsaved } from "@/core/unsaved"
import { LEAN_PAST, textHash } from "../../../core/texthash.ts"

export type SaveStatus = { kind: "ok" } | { kind: "error"; message: string } | { kind: "conflict"; theirs: FileText }

type Options = {
  /** The whole file as typed now. */
  text: () => string
  /** Show text from the server (merged or filled in), keeping the cursor. */
  apply: (text: string) => void
  /** Where saving is; a conflict holds every save until `keepMine` or `takeTheirs`. */
  onStatus: (s: SaveStatus) => void
  /** The server's copy, after a save or a read. */
  onDisk?: (f: FileText) => void
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

function makeAutosave(path: string, initial: string, options: Options) {
  const o = { current: options }
  const opened = moveMark()
  const where = () => whereNow(path, opened)
  let timer: ReturnType<typeof setTimeout> | null = null
  let saving = false, again = false, recheck = false
  let status: SaveStatus = { kind: "ok" }
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
      if (saving) { again = true; return s.inflight?.done }
      const sent = o.current.text(), base = s.disk
      if (sent === base && !force) { dropDraft(path); return }
      keepDraft(path, sent, base)
      saving = true
      let finish = () => {}
      s.inflight = { text: sent, done: new Promise<void>((r) => { finish = r }) }
      try {
        const r = await put(sent, base)
        const j = await answer(r, sent)
        if (r.status === 409) return tell({ kind: "conflict", theirs: j })
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
        tell({ kind: "ok" })
      } catch (e) {
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
        const merged = now === before ? r.text : merge3(before, now, r.text)
        if (merged === null) return tell({ kind: "conflict", theirs: r })
        s.disk = r.text
        s.mtime = r.mtime
        o.current.onDisk?.(r)
        o.current.apply(merged)
        if (merged !== r.text) s.changed()
      } catch (e) {
        if (s.alive && gone(e) && where() === path) o.current.onGone()
      }
    },

    keepMine() {
      if (status.kind !== "conflict") return
      s.disk = status.theirs.text ?? s.disk
      tell({ kind: "ok" })
      void s.save(true)
    },
    takeTheirs() {
      if (status.kind !== "conflict") return
      s.disk = status.theirs.text
      o.current.apply(s.disk)
      dropDraft(path)
      tell({ kind: "ok" })
    },

    /** Send what's pending without the view (it's going); a failure is a toast holding the edits. */
    flush(base: string, say: boolean) {
      const text = o.current.text()
      if (text === base || o.current.readOnly) return
      // (kept here first: keepalive takes 64 KB at most, so a bigger save is a plain one, which a closed window may cut short)
      keepDraft(path, text, base)
      const send = async (base: string | null) => {
        const r = await put(text, base, { keepalive: text.length < 60_000 })
        if (r.status === 409) throw Object.assign(new Error("it changed elsewhere in the same lines"), { conflict: true })
        if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).error ?? r.statusText), { gone: r.status === 404 })
        dropDraft(path)
      }
      const id = `unsaved:${path}`, saved = () => notify(`Saved ${stem(path)}`, { id })
      const unsaved = (e: unknown) => {
        const mine = !!(e as { conflict?: boolean }).conflict
        notify(`Couldn't save ${stem(path)}: ${(e as Error).message ?? e}`, { kind: "error", duration: 15_000, id,
          action: { label: mine ? "Keep mine" : "Try again", run: async () => { await send(mine ? null : base); saved() } } })
      }
      if (s.conflict) { if (say) unsaved({ message: "it changed elsewhere in the same lines", conflict: true }); return }
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
