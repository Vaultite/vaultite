// The server's calls (screen.text, screen.shot: plugins/core/screen) and its voice's (companion.voice-sample).
import { nativeImage } from "electron"
import fs from "node:fs"
import path from "node:path"
import { changedBoxes } from "../core/desktop/framediff.ts"
import { queryTimeline } from "./timeline.ts"
import { walkCall } from "./walk.ts"
import { screenAsk, SHOTS, windowShot } from "./helperask.ts"
import { RECT, TEXT, WINDOW } from "./screenwire.ts"
import { z } from "zod"
import { KINDS } from "../core/desktop/screentimeline.ts"
import { objectOr, opt, yes } from "./ipcwire.ts"
import { hidden } from "./helperbase.ts"
import { talkNow } from "./helpertalk.ts"
import { speaker, stopVoice } from "./helpervoice.ts"

const WINDOW_NUMBER = z.number().int().catch(0)
const VOICE_CALL = objectOr(z.object({ text: opt(z.string()), provider: opt(z.enum(["elevenlabs", "soniox"])), after: yes }))
const TIMELINE_CALL = objectOr(z.object({ last: opt(z.number()), from: opt(z.number()), to: opt(z.number()), said: opt(z.string()), clip: yes, box: opt(RECT),
  kinds: opt(z.array(z.unknown()).transform((ks) => ks.flatMap((k) => z.enum(KINDS).safeParse(String(k)).data ?? []))) }))
const CHANGED_CALL = objectOr(z.object({ before: opt(z.string()), window: WINDOW_NUMBER, settle: z.unknown().optional() }))
const SCREEN_CALL = objectOr(z.object({ app: z.string().catch(""), window: WINDOW_NUMBER, max: z.unknown().optional(), do: z.unknown().optional() }))

/** Whether its voice and the Talk key's exchange went quiet within `ms`: nothing said, listened for or worked on. */
async function quiet(ms: number) {
  const busy = () => { const t = talkNow(); return t.speaking || t.pressing || t.answering }
  for (const end = Date.now() + ms; busy(); await new Promise((r) => setTimeout(r, 250))) if (Date.now() > end) return false
  return true
}
/** The server's calls to its voice (companion.voice-sample): a sample said aloud now, for the user to hear. */
export async function voiceCall(name: string, args: unknown[]) {
  const o = VOICE_CALL.parse(args[0])
  if (name !== "voice:sample" || !o.text?.trim()) throw new Error(`no voice call ${name}`)
  // (news, a job's: said once its answer is, never over it; a sample asked for is said now)
  if (o.after && !await quiet(60_000)) return { said: false, why: "it was still speaking" }
  stopVoice()
  return speaker.sample(o.text.slice(0, 2000), o.provider)
}
/** The timeline asked (screen.timeline): a stretch of what happened, its clip saved only when asked. */
async function timelineCall(a: unknown) {
  const { box, ...q } = TIMELINE_CALL.parse(a)
  return queryTimeline({ ...q, ...(box ? { box } : {}) })
}
/** What changed in a window since its picture `before` (companion.live: an ask's change once its page reloads): pictures
 *  taken till two agree (its reload and animations done, `settle` ms at most), the boxes that differ in screen points. */
async function changedCall(a: unknown) {
  const o = CHANGED_CALL.parse(a), window = o.window
  const before = o.before !== undefined ? path.resolve(o.before) : ""
  // (only its own pictures are read)
  if (!before.startsWith(SHOTS() + path.sep) || !fs.existsSync(before) || !window) return { ok: false, why: "no-window" }
  const w = await screenAsk("window", { window, bundle: "" }, WINDOW)
  if (!w.window || !w.frame) return { ok: false, why: "no-window" }
  if (hidden(w)) return { ok: false, why: "private" }
  const bitmap = (f: string) => { const i = nativeImage.createFromPath(f), z = i.getSize(); return { px: new Uint8Array(i.toBitmap()), ...z } }
  // (read first: the pictures taken meanwhile go in the same folder, which keeps only the last 20)
  const was = bitmap(before), end = Date.now() + Math.min(Number(o.settle) || 4000, 10_000)
  let last: ReturnType<typeof bitmap> | null = null
  for (;;) {
    const f = await windowShot(w.window, SHOTS())
    if (!f) return { ok: false, why: "no picture: Vaultite needs screen recording (System Settings, Privacy & Security)" }
    const now = bitmap(f)
    // (read: the folder keeps others' pictures, not these)
    fs.rmSync(f, { force: true })
    const still = !!last && last.width === now.width && last.height === now.height && !changedBoxes(last.px, now.px, now.width, now.height).boxes.length
    last = now
    if (still || Date.now() > end) break
    await new Promise((r) => setTimeout(r, 350))
  }
  const scale = last.width / w.frame.width
  if (was.width !== last.width || was.height !== last.height) return { ok: true, boxes: [], whole: true }
  const c = changedBoxes(was.px, last.px, last.width, last.height)
  return { ok: true, whole: c.whole, boxes: c.boxes.map((b) => ({ x: Math.round(w.frame!.x + b.x / scale), y: Math.round(w.frame!.y + b.y / scale), w: Math.round(b.w / scale), h: Math.round(b.h / scale) })) }
}
export async function screenCall(name: string, args: unknown[]) {
  if (name === "screen:timeline") return timelineCall(args[0])
  if (name === "screen:changed") return changedCall(args[0])
  const o = SCREEN_CALL.parse(args[0])
  if (name === "screen:walk") return walkCall(String(o.do ?? "status"))
  const { window, app: bundle } = o
  // (whose window it is first: a private app's is never read)
  const w = await screenAsk("window", { window, bundle }, WINDOW)
  if (!w.window) return { ok: false, why: "no-window" }
  if (hidden(w)) return { ok: false, why: "private" }
  if (name === "screen:text") return screenAsk("text", { window: w.window, max: Number(o.max) || 20_000 }, TEXT)
  if (name === "screen:shot") {
    const file = await windowShot(w.window, SHOTS())
    return file ? { ok: true, file, bundle: w.bundle, name: w.name, title: w.title, window: w.window } : { ok: false, why: "no picture: Vaultite needs screen recording (System Settings, Privacy & Security)" }
  }
  throw new Error(`no screen call ${name}`)
}
