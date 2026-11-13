import type { WebContents } from "electron"
import { joinText } from "../core/dictationtext.ts"
import { type Entry, learnedList, type Teach } from "../core/desktop/dictationlearn.ts"
import { followField, type Followed } from "./dictationfix.ts"
import { screenAsk } from "./helperask.ts"
import { hidden, hint, op, type Session } from "./helperbase.ts"

/** Dictation that learns, in other apps: the field its words went into followed a minute for the user's fixes. */
let up: { readonly session: Session | null }
export const learnHost = (h: typeof up) => { up = h }

/** The field followed now (screen.swift `follow` tells its text as it changes). */
export let following: Followed | null = null
let follows = 0
/** What's learned goes in the dictionary, said in the dictation box's place (the user is in another app). */
const teachHere: Teach = {
  add: async (e) => ((await op("dictation.add", { ...e, fixed: true })).added as Entry | null) ?? null,
  remove: (e) => op("dictation.remove", { ...e }),
  told: (added) => hint(`Added ${learnedList(added)} to your dictionary`, 4000),
}
/** Follow the words `said` just put in the field (`from`: the focused one, or the kept one they went back to); a
 *  paste lands a moment later, so it's looked for a few times. A field that doesn't say its text, or a private app's: not. */
export async function followFix(said: string, from: "front" | "kept", pasted: boolean) {
  const id = ++follows
  for (let i = 0; i < (pasted ? 6 : 2); i++) {
    await new Promise((r) => setTimeout(r, pasted ? 250 : 50))
    if (id !== follows || up.session) return
    const r = await screenAsk<{ ok?: boolean; value?: unknown; caret?: unknown; bundle?: string; name?: string }>("follow", { do: "start", from }).catch(() => null)
    if (!r?.ok || typeof r.value !== "string") return
    if (hidden(r)) return void screenAsk("follow", { do: "stop" }).catch(() => {})
    const f = followField(said, r.value, typeof r.caret === "number" ? r.caret : -1, teachHere, () => {
      if (following !== f) return
      following = null
      void screenAsk("follow", { do: "stop" }).catch(() => {})
    })
    if (f) { following = f; return }
  }
  void screenAsk("follow", { do: "stop" }).catch(() => {})
}
/** screen.swift on the field followed: its text changed, or it's over (its window left, the field gone). */
export function followHeard(m: Record<string, unknown>) {
  const f = following
  if (!f) return
  if (typeof m.value === "string") return f.changed(m.value)
  f.done()
}
export const dropOrigin = (s: Session) => { if (s.origin) void askPage(s.origin, "drop") }
export const landAsks = new Map<number, (r: { ok?: boolean; elsewhere?: boolean }) => void>()
let landIds = 0
/** A window's page, on dictated words: `here` where its keyboard is, `origin` where its session began, `drop` it's over. */
export function askPage(to: WebContents, where: "here" | "origin" | "drop", text?: string): Promise<{ ok: boolean; elsewhere?: boolean } | null> {
  if (to.isDestroyed()) return Promise.resolve(null)
  const id = ++landIds
  return new Promise((done) => {
    const late = setTimeout(() => { landAsks.delete(id); done(null) }, 1500)
    landAsks.set(id, (r) => { clearTimeout(late); landAsks.delete(id); done({ ok: r.ok === true, elsewhere: r.elsewhere === true }) })
    to.send("vaultite:dictation-land", { id, where, text })
  })
}
/** Into the field it began in: where it is if that field lets it (in the background); else brought to the front and pasted. */
export async function backWhereItBegan(s: Session, text: string): Promise<{ ok: boolean; name?: string; text?: string; how?: string }> {
  if (s.origin) return { ok: (await askPage(s.origin, "origin", text))?.ok === true }
  if (!s.focus.field) return { ok: false }
  const f = await screenAsk<{ ok?: boolean; before?: string; name?: string }>("kept", { do: "info" })
  if (!f.ok) return { ok: false }
  const words = joinText(f.before ?? "", text)
  if ((await screenAsk<{ ok?: boolean }>("kept", { do: "insert", text: words })).ok) return { ok: true, name: f.name, text: words, how: "ax" }
  if (!(await screenAsk<{ ok?: boolean }>("kept", { do: "front" })).ok) return { ok: false }
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 100))
    if ((await screenAsk<{ ok?: boolean }>("kept", { do: "paste", text: words })).ok) return { ok: true, name: f.name, text: words, how: "paste" }
  }
  return { ok: false }
}
