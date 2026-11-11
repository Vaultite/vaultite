// Words dictated into another app's field, followed a minute for the user's fixes (screen.swift `follow`), learned as in
// Vaultite (core/desktop/dictationlearn.ts). Its text is held only while followed; only a fix's word is kept. No Electron.
import { type Teach, watchWith } from "../core/desktop/dictationlearn.ts"

/** Where words said went in a field's text: what's before and after them; null when they aren't there as said. */
export function placeOf(value: string, said: string, caret = -1): { before: string; after: string } | null {
  if (!said.trim()) return null
  // (where the caret says the field put them, else where they are nearest it: an app may move its caret after)
  let at = caret >= said.length && value.slice(caret - said.length, caret) === said ? caret - said.length : -1
  if (at < 0) {
    const all: number[] = []
    for (let i = value.indexOf(said); i >= 0; i = value.indexOf(said, i + 1)) all.push(i)
    at = caret < 0 ? all.at(-1) ?? -1 : all.reduce((best, i) => (best < 0 || Math.abs(i + said.length - caret) < Math.abs(best + said.length - caret) ? i : best), -1)
  }
  return at < 0 ? null : { before: value.slice(0, at), after: value.slice(at + said.length) }
}

export type Followed = {
  /** The field's text now (screen.swift tells it as it changes). */
  changed(value: string): void
  /** Done with it (its window left, another dictation, the field gone): a fix still settling is read now. */
  done(): void
}

/** Follow `said` in a field whose text was `value` (its caret at `caret`) as they went in; null when they can't be found
 *  there (an app that changed them as they went in). `over` once it's done, to stop following the field. */
export function followField(said: string, value: string, caret: number, teach: Teach, over: () => void): Followed | null {
  const place = placeOf(value, said, caret)
  if (!place) return null
  const { before, after } = place
  /** The words as they read the last time the field's text still held them where they were. */
  let now = said
  const within = (v: string) => (v.length >= before.length + after.length && v.startsWith(before) && v.endsWith(after) ? v.slice(before.length, v.length - after.length) : null)
  const watch = watchWith(said, () => now, teach, over)
  return {
    changed(v) {
      const w = within(v)
      // (no longer where they were, or all gone (a message sent, the field cleared, an edit before them): what was fixed
      // till then counts)
      if (w === null || !w.trim()) return watch.done()
      if (w === now) return
      now = w
      watch.edited()
    },
    done: () => watch.done(),
  }
}
