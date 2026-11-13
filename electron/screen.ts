/** The screen helper (screen.swift), run while the menu-bar helper is: the keys and ink, the app in front, fields and other
 *  apps' text; window pictures (macOS's screencapture), a display's (ScreenCaptureKit). Its events go to `onScreenEvent`'s listener. */
import { app } from "electron"
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { screenSwift } from "./swiftbuild.ts"
import { type Json, lineHelper } from "./linehelper.ts"
import { FOCUS, type RECT, SCREEN_EVENT, type ScreenEvent, SHOT, type WINDOW } from "./screenwire.ts"
import type { z } from "zod"

export type Rect = z.infer<typeof RECT>
/** An app's window as the helper tells it: its app (bundle id, name), number and title; `vaultite`: one of this app's. */
export type AppWindowInfo = z.infer<typeof WINDOW>
/** The field with the keyboard: whether words can go in (`field`), a password's (`secure`), the text before its caret. */
export type Focus = z.infer<typeof FOCUS>
export type Req = { [k: string]: Json }

let listener: (m: ScreenEvent) => void = () => {}
export const onScreenEvent = (fn: typeof listener) => { listener = fn }

const helper = lineHelper({ binary: () => screenSwift.binary(path.join(app.getPath("userData"), "bin")), events: SCREEN_EVENT, event: (m) => listener(m), exited: () => listener({ event: "exit" }) })
export const startScreen = helper.started
/** Ask the helper (a hung app's AX calls time out in it: 1 s each). */
export const screenAsk = <S extends z.ZodType>(op: string, req: Req, answer: S, ms = 10_000): Promise<z.output<S>> => helper.ask({ ...req, op }, answer, ms)
export const stopScreen = helper.quit

/** A window's picture, as a PNG file in `dir` (the last few kept); null when macOS gave none (no screen recording). */
export async function windowShot(window: number, dir: string): Promise<string | null> {
  if (!Number.isInteger(window) || window <= 0) return null
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `window-${window}-${Date.now()}.png`)
  const ok = await new Promise<boolean>((done) => execFile("/usr/sbin/screencapture", ["-x", "-o", `-l${window}`, "-t", "png", file], { timeout: 10_000 }, (e) => done(!e)))
  prune(dir)
  return ok && fs.existsSync(file) && fs.statSync(file).size > 0 ? file : null
}

/** The last 20 pictures kept, newest by when they were taken (the number in their name). */
function prune(dir: string) {
  const when = (f: string) => Number(/-(\d+)\.png$/.exec(f)?.[1] ?? 0)
  const old = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort((a, b) => when(b) - when(a))
  for (const f of old.slice(20)) fs.rmSync(path.join(dir, f), { force: true })
}
/** What a closer look shows its spot by, drawn on it (screen points): the rings they drew, else their pointer. */
export type ShotMark = { rings: Rect[] } | { pointer: { x: number; y: number } }
/** The display under `p` (or `crop` of it) as a PNG in `dir` at `scale` pixels a point, `mark` on it, without windows
 *  `exclude` (ours, a private app's), and where it is on screen. Null when macOS gave none (no recording, macOS < 14). */
export async function displayShot(p: { x: number; y: number }, exclude: number[], dir: string, crop?: Rect, scale = 1, mark?: ShotMark): Promise<{ file: string; frame: Rect } | null> {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${scale === 1 ? "display" : "close"}-${Math.round(p.x)}-${Date.now()}.png`)
  const r = await screenAsk("display", { x: p.x, y: p.y, exclude, file, ...(crop ? { crop } : {}), ...(scale === 1 ? {} : { scale }), ...(mark ? { mark } : {}) }, SHOT, 8000)
  prune(dir)
  return r.ok && r.frame && fs.existsSync(file) && fs.statSync(file).size > 0 ? { file, frame: r.frame } : null
}

/** "Press 🌐 key to", as macOS has it (null: never set). */
const reading = (program: string, args: string[]) => new Promise<string | null>((done) =>
  execFile(program, args, { timeout: 5000 }, (e, out) => done(e ? null : String(out).trim())))
export const fnUsage = () => reading("/usr/bin/defaults", ["read", "com.apple.HIToolbox", "AppleFnUsageType"])
