// Sharing across the user's machines: who shares what (GET share/folders), where a link comes from (here, the vault's
// machine on the internet, or one that passes its guests on), and ops passed on to the vault's machine keeping shares.
import { type Machine, MACHINE_CLIENT, type OpCtx, OpError, type Plugin } from "../../../core/plugins.ts"

/** Another machine with Sharing: the folders it shares (`same`: of this vault), its public address, and its shares a
 *  machine on the internet passes on (their links' hashes, to find them by). */
export type Other = { m: Machine; same: boolean; folders: string[]; links: string | null; relayed: { id: string; hash: string }[] }
/** Where this machine's links come from: here, the vault's machine on the internet (`host`: it keeps them), or one that
 *  passes them on (`via`, at its address `url`: they're kept here). */
export type Where = { here: string } | { host: Machine } | { via: Machine; url: string }

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [])

export function machines(plugin: Plugin, publicUrl: () => string) {
  let at = 0, others: Promise<Other[]> = Promise.resolve([])

  async function ask(): Promise<Other[]> {
    const vault = await plugin.ask<string>("machines:vault", "")
    const ms = (await plugin.ask<Machine[]>("machines", [])).filter((m) => !m.self && m.online && m.url && m.plugins?.includes("share"))
    const got = await Promise.all(ms.map(async (m): Promise<Other | null> => {
      try {
        const r = await fetch(`${m.url}/api/share/folders`, { headers: MACHINE_CLIENT, signal: AbortSignal.timeout(5000) })
        const b = r.ok ? await r.json() as { folders?: unknown; links?: unknown; relayed?: unknown } : null
        if (!b) return null
        const relayed = (Array.isArray(b.relayed) ? b.relayed : []).filter((x): x is { id: string; hash: string } => typeof x?.id === "string" && typeof x?.hash === "string")
        return { m, same: !!vault && m.vault === vault, folders: strings(b.folders), links: typeof b.links === "string" && /^https?:\/\//.test(b.links) ? b.links : null, relayed }
      } catch { return null }
    }))
    return got.filter((o) => !!o)
  }

  /** The others, asked at most every 10 seconds (`fresh`: every second, for a share none was known to have). */
  const othersNow = (fresh = false) => {
    if (Date.now() - at > (fresh ? 1_000 : 10_000)) { at = Date.now(); others = ask().catch(() => []) }
    return others
  }

  /** Where a link is made; null when nowhere can (no machine of the user's on the internet), or for a call another machine
   *  passed on (it runs here or not at all). */
  async function where(ctx?: OpCtx): Promise<Where | null> {
    const url = publicUrl()
    if (url) return { here: url }
    if (ctx?.who.client?.startsWith("machine/")) return null
    const os = await othersNow(true)
    const host = os.find((o) => o.same && o.links)
    if (host) return { host: host.m }
    const via = os.find((o) => o.links)
    return via ? { via: via.m, url: via.links! } : null
  }

  /** Op `id` run by the vault's machine that keeps its shares: its server checks its owner again. */
  async function passOn<T>(m: Machine, id: string, params: object): Promise<T> {
    const r = await fetch(`${m.url}/api/ops/${id}?as=both`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" },
      body: JSON.stringify(params), signal: AbortSignal.timeout(60_000) }).catch(() => null)
    if (!r) throw new OpError(`${m.label} keeps this vault's shares and doesn't answer`, 502)
    const out = await r.json().catch(() => ({})) as { result?: T; error?: string }
    if (!r.ok) throw new OpError(`${m.label}: ${out.error || `answered ${r.status}`}`, r.status)
    return out.result as T
  }

  /** The machine that keeps the share a guest's address names (its id, or its link's hash), when another one does. */
  async function keeper(test: (r: { id: string; hash: string }) => boolean) {
    const find = (os: Other[]) => os.find((o) => o.relayed.some(test))?.m ?? null
    const hit = find(await othersNow())
    if (hit) return hit
    // (a link made a moment ago: asked again once a second has passed since the last asking)
    const since = Date.now() - at
    if (since < 1000) await new Promise((ok) => setTimeout(ok, 1000 - since))
    return find(await othersNow(true))
  }

  return { othersNow, where, passOn, keeper }
}
