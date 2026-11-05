/** The screen helper (screen.swift), run while the menu-bar helper is: fn, the app in front, fields and other apps'
 *  text; and window screenshots (macOS's screencapture). Its events go to `onScreenEvent`'s listener. */
import { app } from "electron"
import { execFile, spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { buildScreen, screenHelperName } from "./screen-build.ts"

export type Rect = { x: number; y: number; width: number; height: number }
/** An app's window as the helper tells it: its app (bundle id, name), number and title; `vaultite`: one of this app's. */
export type AppWindowInfo = { bundle: string; name: string; pid: number; window: number; title: string; frame?: Rect | null; vaultite?: boolean }
/** The field with the keyboard: whether words can go in (`field`), a password's (`secure`), the text before its caret. */
export type Focus = AppWindowInfo & { field: boolean; secure?: boolean; role?: string; before?: string }

const SHIPPED = path.join(import.meta.dirname, "bin")
let helper: ChildProcess | null = null
let starting: Promise<ChildProcess> | null = null
let next = 1
const waiting = new Map<number, (res: Record<string, unknown>) => void>()
let listener: (m: Record<string, unknown>) => void = () => {}
export const onScreenEvent = (fn: typeof listener) => { listener = fn }

async function binary() {
  const shipped = path.join(SHIPPED, screenHelperName())
  return fs.existsSync(shipped) ? shipped : buildScreen(path.join(app.getPath("userData"), "bin"))
}

export function startScreen(): Promise<ChildProcess> {
  if (helper && helper.exitCode === null && !helper.killed) return Promise.resolve(helper)
  starting ??= binary().then((bin) => {
    const child = spawn(bin, [], { stdio: ["pipe", "pipe", "ignore"] })
    let buf = ""
    child.stdout!.on("data", (b: Buffer) => {
      buf += b.toString()
      for (let i; (i = buf.indexOf("\n")) >= 0;) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        let msg: Record<string, unknown>
        try { msg = JSON.parse(line) } catch { continue }
        if (typeof msg.id === "number") { waiting.get(msg.id)?.(msg); waiting.delete(msg.id) }
        else if (typeof msg.event === "string") listener(msg)
      }
    })
    child.on("error", () => { if (child.exitCode === null && !child.killed) child.kill(); child.emit("exit") })
    child.stdin!.on("error", () => {})
    child.once("exit", () => {
      if (helper !== child) return
      helper = null
      for (const done of waiting.values()) done({ ok: false, why: "helper" })
      waiting.clear()
      listener({ event: "exit" })
    })
    helper = child
    return child
  }).finally(() => { starting = null })
  return starting
}

/** Ask the helper (a hung app's AX calls time out in it: 1 s each). */
export async function screenAsk<T = Record<string, unknown>>(op: string, req: Record<string, unknown> = {}, ms = 10_000): Promise<T> {
  const child = await startScreen()
  const id = next++
  return new Promise((done) => {
    const timer = setTimeout(() => { if (waiting.delete(id)) done({ ok: false, why: "timeout" } as T) }, ms)
    waiting.set(id, (m) => { clearTimeout(timer); done(m as T) })
    child.stdin!.write(JSON.stringify({ ...req, op, id }) + "\n")
  })
}

export function stopScreen() {
  const h = helper
  helper = null
  h?.stdin?.end()
  if (h) setTimeout(() => { if (h.exitCode === null) h.kill() }, 2000)
}

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
/** A part of the screen's picture (screen points, top-left origin), as a PNG file in `dir`: what's around the pointer
 *  where there's no window (the desktop); null when macOS gave none. */
export async function regionShot(r: { x: number; y: number; width: number; height: number }, dir: string): Promise<string | null> {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `region-${Date.now()}.png`), R = [r.x, r.y, r.width, r.height].map(Math.round).join(",")
  const ok = await new Promise<boolean>((done) => execFile("/usr/sbin/screencapture", ["-x", `-R${R}`, "-t", "png", file], { timeout: 10_000 }, (e) => done(!e)))
  prune(dir)
  return ok && fs.existsSync(file) && fs.statSync(file).size > 0 ? file : null
}

/** "Press 🌐 key to", as macOS has it (null: never set). */
const reading = (program: string, args: string[]) => new Promise<string | null>((done) =>
  execFile(program, args, { timeout: 5000 }, (e, out) => done(e ? null : String(out).trim())))
export const fnUsage = () => reading("/usr/bin/defaults", ["read", "com.apple.HIToolbox", "AppleFnUsageType"])
/** macOS's dictation shortcut and whether dictation's on: core/fnkey.ts controlActsToo reads them. */
export const dictationAuto = () => reading("/usr/bin/defaults", ["read", "com.apple.HIToolbox", "AppleDictationAutoEnable"])
export const dictationHotKey = () => reading("/usr/bin/plutil", ["-extract", "AppleSymbolicHotKeys.164", "json", "-o", "-", path.join(os.homedir(), "Library/Preferences/com.apple.symbolichotkeys.plist")])
