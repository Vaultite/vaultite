import { z } from "zod"
import { OpError, type Plugin } from "../../../core/plugins.ts"

const RT_WS = () => process.env.VAULTITE_OPENAI_REALTIME_URL || "wss://api.openai.com/v1/realtime"
const API = () => process.env.VAULTITE_OPENAI_API || "https://api.openai.com"
export const SET_OPENAI = `vau secret "OpenAI API key" | vau voice key --provider openai`

const Secrets = z.object({ companion: z.looseObject({ openai: z.unknown().optional() }).optional() })

export function realtimeKeys(plugin: Plugin) {
  const stored = () => Secrets.safeParse(plugin.secrets()).data?.companion ?? {}
  const key = () => { const v = stored().openai; return typeof v === "string" && v.trim() ? v.trim() : "" }

  plugin.route("GET", "companion/realtime", async (req) => {
    await plugin.ownerOnly(req, "The voice's keys")
    const k = key()
    return k ? { url: RT_WS(), key: k } : {}
  }, { lock: false, sync: false })

  // A Realtime client secret costs nothing, and a key restricted to Realtime may list no models.
  return async (p: { key?: unknown; remove?: unknown }) => {
    const all = stored()
    if (p.remove) { const { openai: _, ...rest } = all; plugin.saveSecrets(Object.keys(rest).length ? rest : null); return { provider: "openai", set: false, removed: true } }
    const k = typeof p.key === "string" ? p.key.trim() : ""
    if (!k) return { provider: "openai", set: !!key() }
    if (!/^[\x21-\x7e]{20,300}$/.test(k)) throw new OpError("that isn't an OpenAI key (one line, no spaces)")
    const model = String(plugin.settings().realtime_model ?? "").trim() || "gpt-realtime-2.1-mini"
    const r = await fetch(`${API()}/v1/realtime/client_secrets`, { method: "POST", signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
      body: JSON.stringify({ session: { type: "realtime", model } }) }).catch(() => null)
    if (r?.status === 401) throw new OpError("OpenAI refused this key: check it in its dashboard (API keys)", 400)
    if (r?.status === 403) throw new OpError("OpenAI says this key may not use the Realtime API: allow it (its permissions, Realtime or Model capabilities) in its dashboard", 400)
    plugin.saveSecrets({ ...all, openai: k })
    return { provider: "openai", set: true, checked: !!r?.ok }
  }
}

export const openaiText = (r: { set?: boolean; removed?: boolean; checked?: boolean }) =>
  r.removed ? "Removed the OpenAI key: the companion answers through dictation and its cloud voice."
    : r.checked === undefined ? (r.set ? "An OpenAI key is set: the companion talks in realtime." : `No OpenAI key here: ${SET_OPENAI}`)
      : `Set the OpenAI key${r.checked ? "" : " (OpenAI didn't answer, so it isn't checked)"}: the companion talks in realtime.`
