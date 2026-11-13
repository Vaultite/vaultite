import { z } from "zod"
import { type Machine, MACHINE_CLIENT, type OpCtx, OpError, type Plugin } from "../../../core/plugins.ts"
import { ROLES } from "./gateway.ts"

export type Other = { m: Machine; same: boolean; folders: string[]; links: string | null; relayed: { id: string; hash: string }[] }
export type Where = { here: string } | { host: Machine; url: string } | { via: Machine; url: string }

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [])
const Relayed = z.object({ id: z.string(), hash: z.string() })
const PeerFolders = z.object({ folders: z.unknown().optional().transform(strings),
  links: z.unknown().optional().transform((v) => (typeof v === "string" && /^https?:\/\//.test(v) ? v : null)),
  relayed: z.array(z.unknown()).catch([]).transform((xs) => xs.flatMap((x) => { const r = Relayed.safeParse(x); return r.success ? [r.data] : [] })) })
export const ShareListed = z.object({ id: z.string(), folder: z.string(), guest: z.string(), role: z.enum(ROLES), created: z.string(), expires: z.string(),
  expired: z.boolean(), used: z.string().nullable(), here: z.boolean() })
export const ShareWithLink = ShareListed.extend({ link: z.string() })
const Answer = z.object({ result: z.unknown().optional(), error: z.string().optional().catch(undefined) }).catch({})

export function machines(plugin: Plugin, guestUrl: () => string) {
  let at = 0, others: Promise<Other[]> = Promise.resolve([])

  async function ask(): Promise<Other[]> {
    const vault = await plugin.ask<string>("machines:vault", "")
    const ms = (await plugin.ask<Machine[]>("machines", [])).filter((m) => !m.self && m.online && m.url && m.plugins?.includes("share"))
    const got = await Promise.all(ms.map(async (m): Promise<Other | null> => {
      try {
        const r = await fetch(`${m.url}/api/share/folders`, { headers: MACHINE_CLIENT, signal: AbortSignal.timeout(5000) })
        const b = r.ok ? PeerFolders.safeParse(await r.json()) : null
        if (!b?.success) return null
        return { m, same: !!vault && m.vault === vault, ...b.data }
      } catch { return null }
    }))
    return got.filter((o) => !!o)
  }

  const othersNow = (fresh = false) => {
    if (Date.now() - at > (fresh ? 1_000 : 10_000)) { at = Date.now(); others = ask().catch(() => []) }
    return others
  }

  async function where(ctx?: OpCtx): Promise<Where | null> {
    const url = guestUrl()
    if (url) return { here: url }
    if (ctx?.who.client?.startsWith("machine/")) return null
    const os = await othersNow(true)
    const host = os.find((o) => o.same && o.links)
    if (host) return { host: host.m, url: host.links! }
    const via = os.find((o) => o.links)
    return via ? { via: via.m, url: via.links! } : null
  }

  async function passOn<T>(m: Machine, id: string, params: object, answer: z.ZodType<T>): Promise<T> {
    const r = await fetch(`${m.url}/api/ops/${id}?as=both`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" },
      body: JSON.stringify(params), signal: AbortSignal.timeout(60_000) }).catch(() => null)
    if (!r) throw new OpError(`${m.label} keeps this vault's shares and doesn't answer`, 502)
    const out = Answer.parse(await r.json().catch(() => ({})))
    if (!r.ok) throw new OpError(`${m.label}: ${out.error || `answered ${r.status}`}`, r.status)
    const result = answer.safeParse(out.result)
    if (!result.success) throw new OpError(`${m.label} answered ${id} with something this machine doesn't read: ${z.prettifyError(result.error)}`, 502)
    return result.data
  }

  async function keeper(test: (r: { id: string; hash: string }) => boolean) {
    const find = (os: Other[]) => os.find((o) => o.relayed.some(test))?.m ?? null
    const hit = find(await othersNow())
    if (hit) return hit
    const since = Date.now() - at
    if (since < 1000) await new Promise((ok) => setTimeout(ok, 1000 - since))
    return find(await othersNow(true))
  }

  return { othersNow, where, passOn, keeper }
}
