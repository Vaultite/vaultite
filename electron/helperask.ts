import { app, screen } from "electron"
import path from "node:path"
import { liveInput, type Point, shotCrop } from "./helperlogic.ts"
import { displayShot as shootDisplay, type Req, screenAsk as askHelper, windowShot as shoot } from "./screen.ts"
import { OK } from "./screenwire.ts"
import type { z } from "zod"

export const QUIET = !!process.env.VAULTITE_QUIET
export const LIVE = liveInput(process.env, app.isPackaged)
/** A scripted copy's stand-ins for the screen helper's answers (web/qa/helper.mjs): it never reads or types into the
 *  user's apps. */
export const stubs = new Map<string, Req>()
export const screenAsked: Req[] = []
/** The screen helper's switches as last set (its taps, the windows watched): set again on the one started after it died. */
export const SWITCHES = new Set(["fn", "clicks", "keys", "inputs", "ink", "exchange", "watch"]), switched = new Map<string, Req>()
export const screenAsk = async <S extends z.ZodType>(op: string, req: Req, answer: S): Promise<z.output<S>> => {
  if (SWITCHES.has(op)) switched.set(op, req)
  // (web/qa/dictation-apps.mjs, by hand: a scripted copy on real windows of its own)
  if (!QUIET || process.env.VAULTITE_QA_SCREEN) return askHelper(op, req, answer)
  screenAsked.push({ op, ...req })
  return answer.parse(stubs.get(op) ?? { ok: false, why: "quiet", window: 0 })
}
export const screenDo = (op: string, req: Req = {}) => screenAsk(op, req, OK).then(() => {})
export const windowShot = (window: number, dir: string) => (QUIET ? Promise.resolve(null) : shoot(window, dir))
export const displayShot = (p: Point, exclude: number[]) => (QUIET ? Promise.resolve(null) : shootDisplay(p, exclude, SHOTS(), shotCrop(screen.getDisplayNearestPoint(p).bounds, p)))
export const SHOTS = () => path.join(app.getPath("userData"), "screens")
/** What a scripted copy said and drew last (web/qa/helper.mjs). */
export const asked: object[] = []
