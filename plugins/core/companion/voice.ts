// Its voice's keys and its sample (the desktop app speaks: electron/voice.ts). ElevenLabs' key is this machine's, in
// data/config.json (`companion.elevenlabs`), never the vault's; Soniox's is dictation's.
import { OpError, type Plugin } from "../../../core/plugins.ts"
import { openaiText, realtimeKeys, SET_OPENAI } from "./realtime.ts"

// (tests point these at a stand-in)
const ELEVEN_WS = () => process.env.VAULTITE_ELEVENLABS_URL || "wss://api.elevenlabs.io"
const ELEVEN_API = () => process.env.VAULTITE_ELEVENLABS_API || "https://api.elevenlabs.io"
const SONIOX_TTS = () => process.env.VAULTITE_SONIOX_TTS_URL || "wss://tts-rt.soniox.com/tts-websocket"
const SONIOX_MODEL = "tts-rt-v2"
/** A stock voice any key may use: what a key is checked with. */
const CHECK_VOICE = "nPczCjzI2devNBz1zQrb"
export const SET_ELEVEN = `vau secret "ElevenLabs API key" | vau voice key --provider elevenlabs`

const keyOf = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "")
const allKeys = (plugin: Plugin) => plugin.secrets() as { companion?: { elevenlabs?: unknown; openai?: unknown }; dictation?: { soniox?: unknown } }

/** What its voice runs on here, each piece the user's own key (or this Mac's, free), for its status: who hears a Talk key's
 *  words and through which mic (as the desktop app says), who speaks (in order tried), the realtime voice. Never a key. */
export function voiceHere(plugin: Plugin, setting: (key: string) => string, mic?: string) {
  const k = allKeys(plugin), eleven = !!keyOf(k.companion?.elevenlabs), openai = !!keyOf(k.companion?.openai)
  // (Soniox hears only with dictation's engine on auto or soniox: plugins/core/dictation)
  const engine = String(plugin.peer("dictation")?.settings().engine ?? "auto")
  const soniox = !!keyOf(k.dictation?.soniox) && (engine === "auto" || engine === "soniox")
  const order = setting("voice_provider") === "soniox" ? ["soniox", "elevenlabs"] : ["elevenlabs", "soniox"]
  const speaks = setting("voice") === "off" ? [] : [...order.filter((p) => (p === "soniox" ? !!keyOf(k.dictation?.soniox) : eleven)), "mac"]
  const realtime = setting("voice") === "off" || setting("voice_front") !== "realtime" ? "off" : openai ? "on" : "no key"
  return { hears: soniox ? "soniox" : "mac", ...(mic ? { mic } : {}), speaks, realtime, ...(realtime === "on" ? { model: setting("realtime_model") } : {}) }
}
const VOICE_NAMES: Record<string, string> = { soniox: "Soniox", elevenlabs: "ElevenLabs", mac: "this Mac's" }
/** voiceHere's words. */
export const voiceHereText = (v: ReturnType<typeof voiceHere>) =>
  `Voice here: hears with ${v.hears === "soniox" ? "Soniox" : "this Mac's recognizer"}${v.mic ? ` through ${v.mic}` : ""}; ${v.speaks.length ? `speaks with ${v.speaks.map((p) => VOICE_NAMES[p]).join(", then ")}` : "never speaks (voice off)"}; realtime ${v.realtime === "on" ? `on (OpenAI ${v.model})` : v.realtime === "no key" ? "off: no OpenAI key" : "off"}.`

/** What ElevenLabs says this key's plan has used and allows this month (characters), or null (no key, no answer). */
export async function elevenUsage(plugin: Plugin): Promise<{ used: number; limit: number; resets?: number } | null> {
  const key = keyOf(allKeys(plugin).companion?.elevenlabs)
  if (!key) return null
  try {
    const r = await fetch(`${ELEVEN_API()}/v1/user/subscription`, { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(5000) })
    if (!r.ok) return null
    const j = await r.json() as { character_count?: number; character_limit?: number; next_character_count_reset_unix?: number }
    return typeof j.character_count === "number" && typeof j.character_limit === "number"
      ? { used: j.character_count, limit: j.character_limit, ...(j.next_character_count_reset_unix ? { resets: j.next_character_count_reset_unix * 1000 } : {}) } : null
  } catch { return null }
}

export function voiceOps(plugin: Plugin) {
  const all = () => allKeys(plugin)
  const eleven = () => keyOf(all().companion?.elevenlabs), soniox = () => keyOf(all().dictation?.soniox)
  const openai = realtimeKeys(plugin)

  /** The cloud voices this machine has a key for, for its desktop app. */
  plugin.route("GET", "companion/voice", async (req) => {
    await plugin.ownerOnly(req, "The voice's keys")
    const e = eleven(), s = soniox()
    return { ...(e ? { elevenlabs: { url: ELEVEN_WS(), key: e } } : {}), ...(s ? { soniox: { url: SONIOX_TTS(), key: s, model: SONIOX_MODEL } } : {}) }
  }, { lock: false, sync: false })

  plugin.op({
    id: "companion.voice-key",
    cli: "voice key",
    mcp: false,
    owner: "The voice's keys",
    summary: "Set this machine's key for a cloud voice the companion speaks with: ElevenLabs' (first tried once set), Soniox's (dictation's too), or OpenAI's (its realtime voice).",
    help: `Kept in this machine's data/config.json, never in the vault; checked first (ElevenLabs': a word said). Pipe it in from
vau secret, so it never lands in a transcript. With nothing piped, says whether one is set.

  ${SET_ELEVEN}
  ${SET_OPENAI}
  vau voice key --provider elevenlabs --remove`,
    kind: "write",
    lock: false,
    params: {
      key: { type: "string", stdin: true, description: "the API key (piped in when left out)" },
      provider: { type: "string", enum: ["elevenlabs", "soniox", "openai"], default: "elevenlabs", description: "whose key: elevenlabs, soniox (the same as vau dictation key), or openai (the realtime voice: it hears you and answers at once)" },
      remove: { type: "boolean", description: "remove the key: the next voice speaks" },
    },
    run: async ({ key, provider, remove }, ctx) => {
      if (ctx.who.client === "mcp") throw new OpError("not over MCP: keys stay on the user's machines (vau voice key, in a terminal)", 403)
      if (provider === "soniox") return { provider, ...(await ctx.op("dictation.key", { ...(key ? { key } : {}), ...(remove ? { remove } : {}) })) }
      if (provider === "openai") return openai({ key, remove })
      const stored = (all().companion ?? {}) as Record<string, unknown>
      if (remove) { const { elevenlabs: _, ...rest } = stored; plugin.saveSecrets(Object.keys(rest).length ? rest : null); return { provider: "elevenlabs", set: false, removed: true } }
      const k = typeof key === "string" ? key.trim() : ""
      if (!k) return { provider: "elevenlabs", set: !!eleven() }
      if (!/^[\x21-\x7e]{16,200}$/.test(k)) throw new OpError("that isn't an ElevenLabs key (one line, no spaces)")
      // (a key may be for speech alone, without reading voices: checked by a word said, a few characters' cost)
      const r = await fetch(`${ELEVEN_API()}/v1/text-to-speech/${CHECK_VOICE}?output_format=pcm_16000`, { method: "POST", signal: AbortSignal.timeout(10_000),
        headers: { "xi-api-key": k, "Content-Type": "application/json" }, body: JSON.stringify({ text: "Hi.", model_id: "eleven_flash_v2_5" }) }).catch(() => null)
      if (r && (r.status === 401 || r.status === 403)) throw new OpError("ElevenLabs refused this key: check it (and that it may use text to speech) in its settings", 400)
      plugin.saveSecrets({ ...stored, elevenlabs: k })
      return { provider: "elevenlabs", set: true, checked: !!r?.ok }
    },
    text: (r: { provider: string; set?: boolean; removed?: boolean; checked?: boolean }) => r.provider === "soniox" ? (r.set ? "A Soniox key is set." : "No Soniox key here.")
      : r.provider === "openai" ? openaiText(r)
      : r.removed ? "Removed the ElevenLabs key: the companion speaks with Soniox's voice, else this Mac's."
      : r.checked === undefined ? (r.set ? "An ElevenLabs key is set: the companion speaks with ElevenLabs' voice." : `No ElevenLabs key here: ${SET_ELEVEN}`)
      : `Set the ElevenLabs key${r.checked ? "" : " (ElevenLabs didn't answer, so it isn't checked)"}: the companion speaks with ElevenLabs' voice.`,
    did: (p) => ({ action: "settings", text: p.remove ? `Removed the ${p.provider === "openai" ? "OpenAI" : "ElevenLabs"} key` : p.key ? "Set a voice key" : "Checked for a voice key" }),
  })

  plugin.op({
    id: "companion.voice-sample",
    cli: "voice sample",
    summary: "Say a sample aloud on this Mac in the companion's voice (or a provider's), for the user to hear it: only when they ask.",
    help: `Plays through the desktop app's menu-bar helper, with the settings' voices (voice_name, elevenlabs_voice).

  vau voice sample "Here's how I sound."
  vau voice sample "Olá, tudo bem?" --provider soniox`,
    kind: "read",
    lock: false,
    args: ["text"],
    params: {
      text: { type: "string", required: true, description: "what to say" },
      provider: { type: "string", enum: ["elevenlabs", "soniox"], description: "whose voice (default: as answers are said)" },
    },
    run: async ({ text, provider }) => {
      const r = await plugin.desktop("voice:sample", { text: String(text).slice(0, 2000), ...(provider ? { provider } : {}) }).catch((e: Error) => { throw new OpError(`it can't speak here: ${e.message}`, 409) })
      return (r ?? { said: false }) as { said: boolean; by?: string; why?: string }
    },
    text: (r: { said: boolean; by?: string; why?: string }) => (r.said ? `Said it (${r.by}).` : `Didn't say it${r.why ? `: ${r.why}` : ""}.`),
  })
}
