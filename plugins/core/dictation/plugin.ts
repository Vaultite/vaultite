// Soniox's key is this machine's (data/config.json, `dictation.soniox`), never the vault's: the desktop app asks for it
// to dictate (electron/dictation.ts) and for the companion's voice (companion/voice.ts), and streams to Soniox itself.
import { OpError, Plugin } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

// (tests point these at a stand-in)
const WS = () => process.env.VAULTITE_SONIOX_URL || "wss://stt-rt.soniox.com/transcribe-websocket"
const API = () => process.env.VAULTITE_SONIOX_API || "https://api.soniox.com"
const MODEL = "stt-rt-v6"
export const SET_KEY = `vau secret "Soniox API key" | vau dictation key`

const stored = () => (plugin.secrets()[plugin.id] ?? {}) as { soniox?: unknown }
const keyHere = () => { const k = stored().soniox; return typeof k === "string" && k.trim() ? k.trim() : "" }

/** Whether Soniox hears dictation here, with its key; `why` when the engine asked for is Soniox but there's no key. */
plugin.route("GET", "dictation/cloud", async (req) => {
  await plugin.ownerOnly(req, "Dictation's key")
  const s = plugin.settings()
  const engine = s.engine ?? "auto"
  if (plugin.isOff() || (engine !== "auto" && engine !== "soniox")) return {}
  const key = keyHere()
  if (!key) return engine === "soniox" ? { why: `No Soniox key on this machine (${SET_KEY})` } : {}
  const languages = Array.isArray(s.languages) ? s.languages.filter((l): l is string => typeof l === "string" && !!l.trim()).map((l) => l.trim()) : []
  return { url: WS(), key, model: MODEL, languages }
}, { lock: false, sync: false })

plugin.op({
  id: "dictation.key",
  cli: "dictation key",
  mcp: false,
  owner: "Dictation's key",
  summary: "Set this machine's Soniox key: dictation then goes through Soniox's cloud recognizer (this Mac's when it can't), and the companion speaks with Soniox's voice.",
  help: `Kept in this machine's data/config.json, never in the vault; checked with Soniox first. Pipe it in from vau secret, so
it never lands in a transcript. With nothing piped, says whether one is set.

  ${SET_KEY}
  vau dictation key --remove`,
  kind: "write",
  params: {
    key: { type: "string", stdin: true, description: "the Soniox API key (piped in when left out)" },
    remove: { type: "boolean", description: "remove the key: dictation is this Mac's again" },
  },
  lock: false,
  run: async ({ key, remove }, ctx) => {
    if (ctx.who.client === "mcp") throw new OpError("not over MCP: keys stay on the user's machines (vau dictation key, in a terminal)", 403)
    if (remove) { plugin.saveSecrets(null); return { set: false, removed: true } }
    const k = typeof key === "string" ? key.trim() : ""
    if (!k) return { set: !!keyHere() }
    if (!/^[\x21-\x7e]{8,200}$/.test(k)) throw new OpError("that isn't a Soniox key (one line, no spaces)")
    // (a key Soniox refuses isn't kept; unreachable, it's kept unchecked)
    const r = await fetch(`${API()}/v1/models`, { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(8000) }).catch(() => null)
    if (r && (r.status === 401 || r.status === 403)) throw new OpError("Soniox refused this key: check it in Soniox's console", 400)
    plugin.saveSecrets({ ...stored(), soniox: k })
    return { set: true, checked: !!r?.ok }
  },
  text: (r: { set: boolean; removed?: boolean; checked?: boolean }) => r.removed ? "Removed the Soniox key: dictation is this Mac's." :
    r.checked === undefined ? (r.set ? "A Soniox key is set: dictation goes through Soniox." : `No Soniox key here: ${SET_KEY}`) :
    `Set the Soniox key${r.checked ? "" : " (Soniox didn't answer, so it isn't checked)"}: dictation goes through Soniox.`,
  did: (p) => ({ action: "settings", text: p.remove ? "Removed the Soniox key" : p.key ? "Set the Soniox key" : "Checked for a Soniox key" }),
})
