import type { KdbxFiles } from "./kdbxfile.ts"
import { ANSWER, ASK, OPS, type OpName, type Serve } from "./kdbxwire.ts"
import type { z } from "zod"
import { messageOf } from "./messageof.ts"

export function serving(f: KdbxFiles) {
  const ops: Record<OpName, Serve> = {
    unlock: OPS.unlock.serve((a) => f.unlock(a)),
    lock: OPS.lock.serve(async () => { f.lock(); return null }),
    check: OPS.check.serve((a) => f.check(a)),
    list: OPS.list.serve((a) => f.list(a)),
    get: OPS.get.serve((a) => f.get(a, a.id)),
    secretsOf: OPS.secretsOf.serve((a) => f.secretsOf(a, a.id)),
    entriesForUrl: OPS.entriesForUrl.serve((a) => f.entriesForUrl(a, a.url)),
    samePassword: OPS.samePassword.serve((a) => f.samePassword(a, a.ids, a.given)),
    index: OPS.index.serve((a) => f.index(a, a.salt)),
    save: OPS.save.serve((a) => f.save(a, a.change)),
    saveLogin: OPS.saveLogin.serve((a) => f.saveLogin(a, a)),
    keepSecret: OPS.keepSecret.serve((a) => f.keepSecret(a, a.title, a.value)),
    delete: OPS.delete.serve((a) => f.delete(a, a.id)),
    agentEntries: OPS.agentEntries.serve((a) => f.agents(a, (db) => db.entries)),
    agentSecrets: OPS.agentSecrets.serve((a) => f.agents(a, (db) => db.secrets(a.id))),
  }
  const named = new Map<string, Serve>(Object.entries(ops))
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a message between processes: parsed here
  return async (raw: unknown): Promise<z.input<typeof ANSWER> | null> => {
    const m = ASK.safeParse(raw)
    if (!m.success) return null
    const { id, op, args } = m.data, fn = named.get(op)
    if (!fn) return { id, error: "not a thing the passwords process does" }
    try { return { id, value: await fn(args) } } catch (e) { return { id, error: messageOf(e) } }
  }
}
