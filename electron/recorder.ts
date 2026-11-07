/** The screen's video (capture.swift): one display, kept in memory as one-second segments, a ring of the last seconds or
 *  everything from a recording's start (`hold`); a stretch of it saved as a clip only when asked, cropped to a box. */
import { app } from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { buildCapture, captureHelperName } from "./capture-build.ts"
import type { BoxAt, Point, Rect } from "../plugins/core/companion/clips.ts"

/** A scripted copy records nothing, unless its QA asks for the real screen (web/qa/capture.mjs). */
export const REAL = !process.env.VAULTITE_QUIET || !!process.env.VAULTITE_CAPTURE
export type Clip = { file: string; ms: number; width: number; height: number; frames: { t: number; file: string }[] }

let child: ChildProcess | null = null
let starting: Promise<ChildProcess> | null = null
let next = 1
let on = false
let stopped: (() => void) | null = null
const waiting = new Map<number, (r: Record<string, unknown>) => void>()
async function binary() {
  const shipped = path.join(import.meta.dirname, "bin", captureHelperName())
  return fs.existsSync(shipped) ? shipped : buildCapture(path.join(app.getPath("userData"), "bin"))
}
function started(): Promise<ChildProcess> {
  if (child && child.exitCode === null && !child.killed) return Promise.resolve(child)
  starting ??= binary().then((bin) => {
    const c = spawn(bin, [], { stdio: ["pipe", "pipe", "ignore"] })
    let buf = ""
    c.stdout!.on("data", (b: Buffer) => {
      buf += b.toString()
      for (let i; (i = buf.indexOf("\n")) >= 0;) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        let m: Record<string, unknown>
        try { m = JSON.parse(line) } catch { continue }
        if (typeof m.id === "number") { waiting.get(m.id)?.(m); waiting.delete(m.id) }
        // (macOS stopped it: screen recording taken away, the display gone)
        else if (m.event === "stopped") { on = false; stopped?.() }
      }
    })
    c.stdin!.on("error", () => {})
    c.once("exit", () => {
      if (child !== c) return
      child = null; on = false
      for (const done of waiting.values()) done({ ok: false, why: "helper" })
      waiting.clear()
    })
    child = c
    return c
  }).finally(() => { starting = null })
  return starting
}
async function ask<T = Record<string, unknown>>(call: Record<string, unknown>, ms = 15_000): Promise<T> {
  if (!REAL) return { ok: false, why: "quiet" } as T
  const c = await started()
  const id = next++
  return new Promise((done) => {
    const timer = setTimeout(() => { if (waiting.delete(id)) done({ ok: false, why: "timeout" } as T) }, ms)
    waiting.set(id, (m) => { clearTimeout(timer); done(m as T) })
    c.stdin!.write(JSON.stringify({ ...call, id }) + "\n")
  })
}

/** Video of the display at `p` (that display's already: what's left out looked at again), keeping `ring` ms. */
export async function videoAt(p: Point, exclude: number[], bundles: string[], ring: number) {
  const r = await ask<{ ok?: boolean; why?: string }>({ op: "start", x: p.x, y: p.y, exclude, bundles, ring })
  on = !!r.ok
  return r
}
/** Keep everything from `from` on (a recording), or let it go again (null). */
export const holdVideo = (from: number | null) => ask({ op: "hold", from })
export async function stopVideo() { if (on || child) await ask({ op: "stop" }); on = false }
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
  const c = child
  child = null
  c?.stdin?.end()
  if (c) setTimeout(() => { if (c.exitCode === null) c.kill() }, 2000)
}
export type { Rect }
