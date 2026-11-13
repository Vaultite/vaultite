import fs from "node:fs"
import path from "node:path"
import type { WebSocket } from "ws"
import { z } from "zod"
import type { SampleAnswer, SampleAsk } from "../../../core/agents.ts"
import { HTTPError, type Plugin, reply } from "../../../core/plugins.ts"
import { type Item, readText, type Vault, writeAtomic } from "../../../core/vault.ts"

const ARTIFACT = /\.html?$/i

const FAILURE = z.object({ code: z.string().optional().catch(undefined), text: z.string().optional().catch(undefined) }).catch({})

export const dataPath = (rel: string) => `.vaultite/artifacts/${rel}.data.json`

export type ArtifactData = { db: Record<string, Item>; storage: { shared: Record<string, string>; personal: Record<string, string> } }

export function dataOf(vault: Vault, rel: string): ArtifactData {
  let d: Item = {}
  try { d = JSON.parse(readText(vault.abs(dataPath(rel)))) } catch {}
  const obj = (v: unknown): Item => (v && typeof v === "object" && !Array.isArray(v) ? v : {})
  const st = obj(d.storage)
  return { db: obj(d.db), storage: { shared: obj(st.shared), personal: obj(st.personal) } }
}

export function artifactIn(vault: Vault, rel: unknown) {
  const p = String(rel ?? "")
  if (!ARTIFACT.test(p) || p.split("/").some((s) => s.startsWith(".") || s === "..") || !fs.existsSync(vault.abs(p))) {
    throw new HTTPError(400, `not an artifact in the vault: '${p}'`)
  }
  return p
}

export const versionOf = (vault: Vault, rel: string) => Number(fs.statSync(vault.abs(rel), { bigint: true }).mtimeNs / 1000000n)

const DOC_PATH = /^[A-Za-z0-9_\-.~:@+]+$/
const docPath = (p: unknown) => {
  const s = String(p ?? "").split("/")
  if (s.length % 2 || s.length > 16 || s.some((x) => !DOC_PATH.test(x) || x === "." || x === "..")) throw new HTTPError(400, `not a document path: '${p}'`)
  return s.join("/")
}

export function saveData(vault: Vault, body: Item) {
  const rel = artifactIn(vault, body.path)
  const d = dataOf(vault, rel)
  for (const w of Array.isArray(body.db) ? body.db : []) {
    const p = docPath(w?.path)
    if (w.data === null) delete d.db[p]
    else if (w.data && typeof w.data === "object" && !Array.isArray(w.data)) {
      if (JSON.stringify(w.data).length > 262144) throw new HTTPError(400, `${p} is over 256 KiB`)
      d.db[p] = w.data
    } else throw new HTTPError(400, "a document is an object")
  }
  for (const s of Array.isArray(body.storage) ? body.storage : []) {
    const where = s?.shared ? d.storage.shared : d.storage.personal, key = String(s?.key ?? "")
    if (!key) throw new HTTPError(400, "a storage key is text")
    if (s.value === null || s.value === undefined) delete where[key]
    else where[key] = String(s.value)
  }
  writeAtomic(vault.abs(dataPath(rel)), JSON.stringify(d, null, 1) + "\n")
  return { ok: true }
}

export async function publish(vault: Vault, body: Item) {
  const rel = artifactIn(vault, body.path)
  const html = body.html
  if (typeof html !== "string" || !/^\s*<!doctype html/i.test(html)) throw new HTTPError(400, "a page starts with <!doctype html>")
  if (html.length > 16 << 20) throw new HTTPError(413, "the page is over 16 MB")
  const live = versionOf(vault, rel)
  if (body.version !== undefined && Number(body.version) !== live) return reply(409, { error: "the page changed since it loaded", live: String(live) })
  writeAtomic(vault.abs(rel), html)
  await vault.sync()
  return { version: String(versionOf(vault, rel)) }
}

export const sampleGrant = (rel: string) => `sample ${rel}`

export function sampleSocket(plugin: Plugin, ws: WebSocket) {
  const ctl = new AbortController()
  const send = (m: Item) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)) }
  ws.on("close", () => ctl.abort())
  ws.once("message", async (raw) => {
    let a: Item
    try { a = JSON.parse(String(raw)) } catch { return send({ t: "error", code: "invalid_request", message: "not JSON" }) }
    try {
      const rel = artifactIn(plugin.vault, a.path)
      if (!plugin.allows(sampleGrant(rel))) return send({ t: "error", code: "not_granted", message: "this page may not ask Claude" })
      const fn = plugin.service("sample") as ((x: SampleAsk) => Promise<SampleAnswer>) | null
      if (typeof fn !== "function") return send({ t: "error", code: "sampling_disabled", message: "no plugin that's on can ask Claude" })
      if (typeof a.prompt !== "string" || !a.prompt) return send({ t: "error", code: "invalid_request", message: "no prompt" })
      const out = await fn({ prompt: a.prompt, system: String(a.system ?? ""), tier: a.tier, model: a.model, effort: a.effort,
        signal: ctl.signal, onText: (delta) => send({ t: "text", delta }) })
      send({ t: "done", ...out })
    } catch (e) {
      const f = FAILURE.parse(e)
      send({ t: "error", code: f.code ?? "upstream_error", message: e instanceof Error ? e.message : String(e), text: f.text })
    } finally {
      ws.close()
    }
  })
}

export function movedData(vault: Vault, from: string, to: string | null) {
  const src = vault.abs(dataPath(from))
  if (!to || !fs.existsSync(src)) return
  const dst = vault.abs(dataPath(to))
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.renameSync(src, dst)
}
