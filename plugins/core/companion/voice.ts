import { z } from "zod"
import { OpError, type Plugin } from "../../../core/plugins.ts"
import { openaiText, realtimeKeys, SET_OPENAI } from "./realtime.ts"
import { messageOf } from "./errors.ts"

const KeySet = z.looseObject({ set: z.boolean() })

const ELEVEN_WS = () => process.env.VAULTITE_ELEVENLABS_URL || "wss://api.elevenlabs.io"
const ELEVEN_API = () => process.env.VAULTITE_ELEVENLABS_API || "https://api.elevenlabs.io"
const SONIOX_TTS = () => process.env.VAULTITE_SONIOX_TTS_URL || "wss://tts-rt.soniox.com/tts-websocket"
const SONIOX_MODEL = "tts-rt-v2"
const CHECK_VOICE = "nPczCjzI2devNBz1zQrb"
export const SET_ELEVEN = `vau secret "ElevenLabs API key" | vau voice key --provider elevenlabs`

const keyOf = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "")
const Secrets = z.looseObject({ companion: z.looseObject({ elevenlabs: z.unknown().optional(), openai: z.unknown().optional() }).optional().catch(undefined),
  dictation: z.looseObject({ soniox: z.unknown().optional() }).optional().catch(undefined) }).catch({})
const Subscription = z.object({ character_count: z.number().optional().catch(undefined), character_limit: z.number().optional().catch(undefined),
  next_character_count_reset_unix: z.number().optional().catch(undefined) })
const Sampled = z.looseObject({ said: z.boolean(), by: z.string().optional(), why: z.string().optional() })
const allKeys = (plugin: Plugin) => Secrets.parse(plugin.secrets())

export function voiceHere(plugin: Plugin, setting: (key: string) => string, mic?: string) {
  const k = allKeys(plugin), eleven = !!keyOf(k.companion?.elevenlabs), openai = !!keyOf(k.companion?.openai)
  const engine = String(plugin.peer("dictation")?.settings().engine ?? "auto")
  const soniox = !!keyOf(k.dictation?.soniox) && (engine === "auto" || engine === "soniox")
  const order = setting("voice_provider") === "soniox" ? ["soniox", "elevenlabs"] : ["elevenlabs", "soniox"]
  const speaks = setting("voice") === "off" ? [] : [...order.filter((p) => (p === "soniox" ? !!keyOf(k.dictation?.soniox) : eleven)), "mac"]
  const realtime = setting("voice") === "off" || setting("voice_front") !== "realtime" ? "off" : openai ? "on" : "no key"
  return { hears: soniox ? "soniox" : "mac", ...(mic ? { mic } : {}), speaks, realtime, ...(realtime === "on" ? { model: setting("realtime_model") } : {}) }
}
const VOICE_NAMES: Record<string, string> = { soniox: "Soniox", elevenlabs: "ElevenLabs", mac: "this Mac's" }
export const voiceHereText = (v: ReturnType<typeof voiceHere>) =>
  `Voice here: hears with ${v.hears === "soniox" ? "Soniox" : "this Mac's recognizer"}${v.mic ? ` through ${v.mic}` : ""}; ${v.speaks.length ? `speaks with ${v.speaks.map((p) => VOICE_NAMES[p]).join(", then ")}` : "never speaks (voice off)"}; realtime ${v.realtime === "on" ? `on (OpenAI ${v.model})` : v.realtime === "no key" ? "off: no OpenAI key" : "off"}.`

export async function elevenUsage(plugin: Plugin): Promise<{ used: number; limit: number; resets?: number } | null> {
  const key = keyOf(allKeys(plugin).companion?.elevenlabs)
  if (!key) return null
  try {
    const r = await fetch(`${ELEVEN_API()}/v1/user/subscription`, { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(5000) })
    if (!r.ok) return null
    const j = Subscription.safeParse(await r.json()).data
    return j && typeof j.character_count === "number" && typeof j.character_limit === "number"
      ? { used: j.character_count, limit: j.character_limit, ...(j.next_character_count_reset_unix ? { resets: j.next_character_count_reset_unix * 1000 } : {}) } : null
  } catch { return null }
}

export function voiceOps(plugin: Plugin, changed: () => void) {
  const all = () => allKeys(plugin)
  const eleven = () => keyOf(all().companion?.elevenlabs), soniox = () => keyOf(all().dictation?.soniox)
  const openai = realtimeKeys(plugin)

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
      if (provider === "soniox") return { provider, ...KeySet.parse(await ctx.op("dictation.key", { ...(key ? { key } : {}), ...(remove ? { remove } : {}) })) }
      if (provider === "openai") return openai({ key, remove })
      const stored = all().companion ?? {}
      if (remove) { const rest = Object.fromEntries(Object.entries(stored).filter(([k]) => k !== "elevenlabs")); plugin.saveSecrets(Object.keys(rest).length ? rest : null); return { provider: "elevenlabs", set: false, removed: true } }
      const k = typeof key === "string" ? key.trim() : ""
      if (!k) return { provider: "elevenlabs", set: !!eleven() }
      if (!/^[\x21-\x7e]{16,200}$/.test(k)) throw new OpError("that isn't an ElevenLabs key (one line, no spaces)")
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
    id: "companion.voice",
    cli: "voice",
    summary: "Turn the companion's voice off or on in one step (the voice setting): an answer written after it follows the new state.",
    help: `on is the default (answers said aloud when asked by voice); always says typed asks' answers too.
Its answers follow it at once: one written after turning it off shows as text, after turning it on is said.

  vau voice off
  vau voice on
  vau voice always`,
    kind: "write",
    args: ["mode"],
    params: { mode: { type: "string", required: true, enum: ["off", "on", "auto", "always"], description: "off, on (auto: when asked by voice), or always" } },
    run: ({ mode }) => {
      const m = mode === "on" ? "auto" : String(mode)
      plugin.patchSettings({ voice: m === "auto" ? null : m })
      changed()
      return { voice: m }
    },
    text: (r: { voice: string }) => r.voice === "off" ? "Voice off: answers show as text only." : r.voice === "always" ? "Voice on: every answer is said aloud." : "Voice on: answers to a spoken ask are said aloud.",
    did: (p) => ({ action: "settings", text: `Turned the companion's voice ${p.mode === "off" ? "off" : "on"}` }),
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
      const r = await plugin.desktop("voice:sample", { text: String(text).slice(0, 2000), ...(provider ? { provider } : {}) }).catch((e) => { throw new OpError(`it can't speak here: ${messageOf(e)}`, 409) })
      return Sampled.safeParse(r).data ?? { said: false }
    },
    text: (r: { said: boolean; by?: string; why?: string }) => (r.said ? `Said it (${r.by}).` : `Didn't say it${r.why ? `: ${r.why}` : ""}.`),
  })
}
