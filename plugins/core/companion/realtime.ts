// The realtime voice front's key (the desktop app talks: electron/realtimefront.ts). OpenAI's key is this machine's, in
// data/config.json (`companion.openai`), never the vault's; `vau voice key --provider openai` sets it.
import { OpError, type Plugin } from "../../../core/plugins.ts"

// (tests point these at a stand-in)
const RT_WS = () => process.env.VAULTITE_OPENAI_REALTIME_URL || "wss://api.openai.com/v1/realtime"
const API = () => process.env.VAULTITE_OPENAI_API || "https://api.openai.com"
export const SET_OPENAI = `vau secret "OpenAI API key" | vau voice key --provider openai`

export function realtimeKeys(plugin: Plugin) {
  const stored = () => ((plugin.secrets() as { companion?: Record<string, unknown> }).companion ?? {})
  const key = () => { const v = stored().openai; return typeof v === "string" && v.trim() ? v.trim() : "" }

  /** The realtime session's socket and key, for this machine's desktop app. */
  plugin.route("GET", "companion/realtime", async (req) => {
    await plugin.ownerOnly(req, "The voice's keys")
    const k = key()
    return k ? { url: RT_WS(), key: k } : {}
  }, { lock: false, sync: false })

  /** `vau voice key --provider openai`: set (checked by listing its models), removed, or whether one is set. */
  return async (p: { key?: unknown; remove?: unknown }) => {
    const all = stored()
    if (p.remove) { const { openai: _, ...rest } = all; plugin.saveSecrets(Object.keys(rest).length ? rest : null); return { provider: "openai", set: false, removed: true } }
    const k = typeof p.key === "string" ? p.key.trim() : ""
    if (!k) return { provider: "openai", set: !!key() }
    if (!/^[\x21-\x7e]{20,300}$/.test(k)) throw new OpError("that isn't an OpenAI key (one line, no spaces)")
    const r = await fetch(`${API()}/v1/models`, { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null)
    if (r && (r.status === 401 || r.status === 403)) throw new OpError("OpenAI refused this key: check it (and that it may use the Realtime API) in its dashboard", 400)
    plugin.saveSecrets({ ...all, openai: k })
    return { provider: "openai", set: true, checked: !!r?.ok }
  }
}

/** The op's words for OpenAI's key. */
export const openaiText = (r: { set?: boolean; removed?: boolean; checked?: boolean }) =>
  r.removed ? "Removed the OpenAI key: the companion answers through dictation and its cloud voice."
    : r.checked === undefined ? (r.set ? "An OpenAI key is set: the companion talks in realtime." : `No OpenAI key here: ${SET_OPENAI}`)
      : `Set the OpenAI key${r.checked ? "" : " (OpenAI didn't answer, so it isn't checked)"}: the companion talks in realtime.`
