import type { WebContents } from "electron"
import { z } from "zod"
import { agentWorld, type Now, pageAX } from "./axdom.ts"
import { axLines, INTERACTIVE } from "./axlines.ts"
import { cdp, cdpAnswer } from "./cdp.ts"
import { DESCRIBED, EVALUATED, FRAME_TREE, RESOLVED, WORLD } from "./cdpwire.ts"
import { shortUrl } from "./linktext.ts"
import { messageOf } from "./messageof.ts"
import { docOf } from "./pagesecrets.ts"

const AGENT = `(globalThis.__vaultiteAgent ??= (${agentWorld})((${pageAX})(), ${axLines}, { short: ${shortUrl}, interactive: ${JSON.stringify([...INTERACTIVE])} }))`
const NOW = z.union([z.null(), z.object({ gone: z.literal(true) }),
  z.object({ gone: z.literal(false), role: z.string(), name: z.string(), was: z.object({ role: z.string(), name: z.string() }).optional() })])

const worlds = new WeakMap<WebContents, { doc: number; id: Promise<number> }>()
function worldOf(wc: WebContents) {
  const had = worlds.get(wc), doc = docOf(wc)
  if (had && had.doc === doc) return had.id
  const id = (async () => {
    const { frameTree } = await cdpAnswer(wc, FRAME_TREE, "Page.getFrameTree")
    return (await cdpAnswer(wc, WORLD, "Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: "vaultite-agent" })).executionContextId
  })()
  worlds.set(wc, { doc, id })
  id.catch(() => { if (worlds.get(wc)?.id === id) worlds.delete(wc) })
  return id
}

async function inPage(wc: WebContents, call: string, byValue = true, again = true): Promise<{ value?: unknown; objectId?: string }> {
  const contextId = await worldOf(wc)
  const r = await cdpAnswer(wc, EVALUATED, "Runtime.evaluate", { contextId, expression: `${AGENT}.${call}`, returnByValue: byValue, silent: true }).catch((e: Error) => {
    if (again && /context|frame/i.test(messageOf(e))) { worlds.delete(wc); return null }
    throw e
  })
  if (!r) return inPage(wc, call, byValue, false)
  if (r.exceptionDetails) throw new Error(`the page's snapshot failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
  return r.result
}

export async function linesIn(wc: WebContents, base: string, filled: number[]): Promise<string> {
  if (filled.length) await markFilled(wc, filled)
  return z.string().catch("").parse((await inPage(wc, `lines(${JSON.stringify(base)})`)).value)
}
async function markFilled(wc: WebContents, filled: number[]) {
  await inPage(wc, "secret.length")
  const executionContextId = await worldOf(wc)
  for (const backendNodeId of filled) {
    const object = await cdpAnswer(wc, RESOLVED, "DOM.resolveNode", { backendNodeId, executionContextId }).then((x) => x.object, () => null)
    if (!object) continue
    await cdp(wc, "Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function () { globalThis.__vaultiteAgent.secret(this) }", silent: true })
    await cdp(wc, "Runtime.releaseObject", { objectId: object.objectId }).catch(() => {})
  }
}

export async function nodeIdOf(wc: WebContents, ref: string): Promise<number | null> {
  const { objectId } = await inPage(wc, `el(${JSON.stringify(ref)})`, false)
  if (!objectId) return null
  try { return (await cdpAnswer(wc, DESCRIBED, "DOM.describeNode", { objectId })).node.backendNodeId }
  finally { void cdp(wc, "Runtime.releaseObject", { objectId }).catch(() => {}) }
}

export const refNow = async (wc: WebContents, ref: string): Promise<Now> => NOW.parse((await inPage(wc, `now(${JSON.stringify(ref)})`)).value ?? null)
