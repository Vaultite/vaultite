/** The screen's video (capture.swift): one display, kept in memory as one-second segments, a ring of the last seconds or
 *  everything from a recording's start (`hold`); a stretch of it saved as a clip only when asked, cropped to a box. */
import { app } from "electron"
import fs from "node:fs"
import path from "node:path"
import { buildCapture, captureHelperName } from "./capture-build.ts"
import { lineHelper } from "./linehelper.ts"
import type { BoxAt, Point, Rect } from "../plugins/core/companion/clips.ts"

/** A scripted copy records nothing, unless its QA asks for the real screen (web/qa/capture.mjs). */
export const REAL = !process.env.VAULTITE_QUIET || !!process.env.VAULTITE_CAPTURE
export type Clip = { file: string; ms: number; width: number; height: number; frames: { t: number; file: string }[] }

let on = false
let stopped: (() => void) | null = null
async function binary() {
  const shipped = path.join(import.meta.dirname, "bin", captureHelperName())
  return fs.existsSync(shipped) ? shipped : buildCapture(path.join(app.getPath("userData"), "bin"))
}
// (macOS stopped it (screen recording taken away, the display gone), or it died: a recording's lost)
const lost = () => { on = false; stopped?.() }
const helper = lineHelper({ binary, exited: lost, event: (m) => { if (m.event === "stopped") lost() } })
const ask = <T = Record<string, unknown>>(call: Record<string, unknown>, ms = 15_000): Promise<T> =>
  REAL ? helper.ask<T>(call, ms) : Promise.resolve({ ok: false, why: "quiet" } as T)

/** Video of the display at `p` (that display's already: what's left out looked at again), keeping `ring` ms. */
export async function videoAt(p: Point, exclude: number[], bundles: string[], ring: number) {
  const r = await ask<{ ok?: boolean; why?: string }>({ op: "start", x: p.x, y: p.y, exclude, bundles, ring })
  on = !!r.ok
  return r
}
/** Keep everything from `from` on (a recording), or let it go again (null). */
export const holdVideo = (from: number | null) => ask({ op: "hold", from })
/** Stopped, and its helper quit unless a clip is still being saved: an idle one would only hold memory. */
export async function stopVideo() {
  if (!on && !helper.running()) return
  on = false
  await ask({ op: "stop" })
  if (!on && !helper.pending()) helper.quit()
}
export const videoOn = () => on
export const onVideoStopped = (fn: () => void) => { stopped = fn }

/** `from` to `to` (ms since 1970) as a clip in a folder of its own under userData/captures, cropped to the box as it
 *  moved, its frames at each change beside it. */
export async function saveClip(from: number, to: number, boxes: BoxAt[]): Promise<Clip | { why: string }> {
  const dir = path.join(app.getPath("userData"), "captures", new Date(from).toISOString().replace(/[:.]/g, "-"))
  fs.mkdirSync(dir, { recursive: true })
  const r = await ask<{ ok?: boolean; why?: string } & Partial<Clip>>({ op: "save", from, to, boxes, file: path.join(dir, "clip.mp4"), frames: path.join(dir, "frames") }, 120_000)
  prune()
  return r.ok && r.file ? { file: r.file, ms: r.ms ?? to - from, width: r.width ?? 0, height: r.height ?? 0, frames: r.frames ?? [] } : { why: r.why ?? "no video" }
}
/** Clips made on this Mac stay a day (the vault keeps what was sent). */
function prune() {
  const dir = path.join(app.getPath("userData"), "captures")
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const p = path.join(dir, f)
    if (Date.now() - fs.statSync(p).mtimeMs > 86_400_000) fs.rmSync(p, { recursive: true, force: true })
  }
}
export function quitRecorder() {
  on = false
  helper.quit()
}
export type { Rect }
