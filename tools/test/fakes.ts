import fs from "node:fs"
import { IncomingMessage, type IncomingHttpHeaders } from "node:http"
import { Socket } from "node:net"
import path from "node:path"
import type { Plugin } from "../../core/plugins.ts"
import type { Vault } from "../../core/vault.ts"
import type { Job, Where } from "../../plugins/core/companion/jobs.ts"
import type { Moment } from "../../plugins/core/companion/types.ts"

export function request(headers: IncomingHttpHeaders = {}, o: { remote?: string; body?: Buffer[] } = {}): IncomingMessage {
  const socket = new Socket()
  if (o.remote) Object.defineProperty(socket, "remoteAddress", { value: o.remote })
  const req = new IncomingMessage(socket)
  req.headers = headers
  if (o.body) { for (const b of o.body) req.push(b); req.push(null) }
  return req
}

export const moment = (o: Partial<Moment> = {}): Moment => ({ seq: 1, t: 0, kind: "ask", ...o })

export const where = (o: Partial<Where> = {}): Where =>
  ({ machine: "", label: "", cwd: "", repo: "", agent: "claude", account: "", harness: "", model: "", effort: "", why: "", ...o })

export const job = (o: Partial<Job> = {}): Job =>
  ({ id: "j1", title: "", state: "working", where: where(), terminal: "", now: "", started: 0, turn: 0, at: 0, seen: false, log: [], ...o })

export async function plugin(dir: string, id: string, vault: Vault): Promise<Plugin> {
  const { Plugin } = await import("../../core/plugins.ts")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ id, name: id, description: "A test's own" }))
  const p = new Plugin(path.join(dir, "manifest.json"))
  p.vault = vault
  return p
}
