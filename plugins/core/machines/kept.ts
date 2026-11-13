import { HTTPError, keptOf, MACHINE_CLIENT, type Plugin, type SharedKept as Shared } from "../../../core/plugins.ts"
import type { Item } from "../../../core/vault.ts"

type Peer = { id: string; label: string; url: string; online: boolean; self: boolean; via?: string; vault?: string }
const PUSH_MS = 300, PULL_MS = 30_000

export function shareKept(plugin: Plugin, machines: () => Promise<Peer[]>, vaultId: () => string) {
  const kept = () => keptOf(plugin.vault.path)
  async function peers() {
    const own = vaultId()
    if (!own) return []
    return (await machines()).filter((m) => !m.self && !m.via && m.online && m.url && m.vault === own)
  }

  let pending = new Set<string>(), pushing: ReturnType<typeof setTimeout> | null = null
  let watched = "", unwatch = () => {}
  function watch() {
    if (watched === plugin.vault.path) return
    unwatch()
    watched = plugin.vault.path
    unwatch = kept().onChange((names, merged) => {
      if (merged || !plugin.loaded) return
      for (const n of names) pending.add(n)
      pushing ??= setTimeout(() => void push(), PUSH_MS)
    })
  }
  async function push() {
    pushing = null
    const names = pending
    pending = new Set()
    const out = kept().shared([...names])
    if (!out.length) return
    const body = JSON.stringify({ store: kept().id, entries: out })
    const send = async (m: Peer) => {
      try {
        const r = await fetch(`${m.url}/api/machines/kept`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(5000) })
        if (r.ok || r.status === 404) return true
        console.warn(`machines: ${m.label} didn't take what's kept here (${r.status} ${(await r.text()).slice(0, 200)})`)
      } catch {}
      return false
    }
    await Promise.all((await peers()).map(async (m) => { if (!(await send(m))) setTimeout(() => void send(m), 2000).unref?.() }))
  }

  const seen = new Map<string, { store: string; seq: number }>()
  let pulling = false
  async function pull() {
    if (pulling || !plugin.loaded) return
    pulling = true
    try {
      watch()
      await Promise.all((await peers()).map(async (m) => {
        const was = seen.get(m.id)
        try {
          const q = was ? `?after=${was.seq}&store=${encodeURIComponent(was.store)}` : ""
          const r = await fetch(`${m.url}/api/machines/kept${q}`, { headers: MACHINE_CLIENT, signal: AbortSignal.timeout(10_000) })
          if (!r.ok) return
          const got = await r.json() as { store?: unknown; seq?: unknown; entries?: unknown }
          if (typeof got.store !== "string" || typeof got.seq !== "number" || !Array.isArray(got.entries)) return
          kept().merge(got.entries as Shared[])
          if (was && got.store === was.store && got.seq < was.seq) seen.delete(m.id)
          else seen.set(m.id, { store: got.store, seq: got.seq })
        } catch {}
      }))
    } finally { pulling = false }
  }

  plugin.route("GET", "machines/kept", async (req) => {
    await plugin.ownerOnly(req, "This machine's state")
    const k = kept(), after = req.query.store === k.id ? Number(req.query.after) || 0 : 0
    return { store: k.id, ...k.since(after) }
  }, { lock: false, sync: false })

  plugin.route("POST", "machines/kept", async (req) => {
    await plugin.ownerOnly(req, "This machine's state")
    const body = (req.body ?? {}) as Item
    if (!Array.isArray(body.entries)) throw new HTTPError(400, "send `entries`: [{name, at, data}]")
    watch()
    return { changed: kept().merge(body.entries as Shared[]).length }
  }, { lock: false, sync: false })

  plugin.onSync(() => watch())
  const first = setTimeout(() => void pull(), 3000)
  const every = setInterval(() => void pull(), PULL_MS)
  first.unref?.()
  every.unref?.()
  plugin.onUnload(() => { clearTimeout(first); clearInterval(every); if (pushing) clearTimeout(pushing); unwatch(); watched = "" })
  return { pull }
}
