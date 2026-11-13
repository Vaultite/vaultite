import type { WebContents } from "electron"
import type { z } from "zod"
import type { Json } from "./engine.ts"
import { messageOf } from "./messageof.ts"

export type CdpParams = { [k: string]: Json }
const attached = new WeakSet<WebContents>()
function attach(wc: WebContents) {
  if (attached.has(wc)) return
  try { wc.debugger.attach("1.3") } catch (e) {
    if (!wc.debugger.isAttached()) throw new Error(`couldn't attach to the page (${messageOf(e)}): is its DevTools open?`)
  }
  attached.add(wc)
  wc.debugger.on("detach", () => attached.delete(wc))
}
export async function cdp(wc: WebContents, method: string, params: CdpParams = {}) {
  attach(wc)
  await wc.debugger.sendCommand(method, params)
}
export async function cdpAnswer<S extends z.ZodType>(wc: WebContents, answer: S, method: string, params: CdpParams = {}): Promise<z.output<S>> {
  attach(wc)
  return answer.parse(await wc.debugger.sendCommand(method, params))
}
