import { z } from "zod"

const opt = <T extends z.ZodType>(s: T) => s.optional().catch(undefined)
const settings = <F extends Record<string, z.ZodType>>(fields: F) => z.looseObject(fields).catch(z.looseObject(fields).parse({}))
const KEYS = opt(z.array(z.coerce.string())), TEXT = opt(z.string()), FLAG = opt(z.boolean())
/** The settings the helper follows (settings.get of each plugin; one left out: the manifest's default). */
export const DICTATION_SETTINGS = settings({ fn: FLAG, keys: KEYS, languages: KEYS, microphone: TEXT, engine: TEXT, language: TEXT, silence: opt(z.coerce.number()), keep_audio: FLAG })
export const COMPANION_SETTINGS = settings({
  keys: KEYS, sounds: FLAG, voice: TEXT, voice_provider: TEXT, voice_name: TEXT, elevenlabs_voice: TEXT, elevenlabs_model: TEXT, voice_speed: opt(z.coerce.number()),
  voice_front: TEXT, realtime_model: TEXT, realtime_voice: TEXT, job_news: TEXT, timeline: FLAG, hide_from_shares: FLAG, quiet_on_calls: FLAG,
})
export const SCREEN_SETTINGS = settings({ private_apps: KEYS })
type Settings = { dictation: z.infer<typeof DICTATION_SETTINGS>; companion: z.infer<typeof COMPANION_SETTINGS>; screen: z.infer<typeof SCREEN_SETTINGS> }
type Decls = Record<string, { default?: unknown }>

/** `keys` dictate, `talk` talk to the companion (its own: a key in both talks). */
export type Prefs = { fn: boolean; keys: string[]; talk: string[]; privateApps: string[]; dictation: Settings["dictation"]
  /** Whether its answers are spoken (`auto`: an ask by voice), by which cloud voice first, which voices, how fast. */
  voice: { mode: "auto" | "always" | "off"; provider: "auto" | "elevenlabs" | "soniox"; name: string; eleven: { voice: string; model: string }; speed: number }
  /** Soft cues as it's summoned, sent an ask, and answers (the companion's `sounds`). */
  sounds: boolean
  /** Who hears a spoken ask and answers it first (realtimefront.ts): a realtime model, or dictation and the voice. */
  realtime: { front: "realtime" | "pipeline"; model: string; voice: string }
  /** Which jobs' news is told (the companion's job_news). */
  jobNews: string
  /** The screen's timeline kept in memory, the last seconds (the companion's `timeline`). */
  timeline: boolean
  /** Its windows kept out of screen shares and recordings (`hide_from_shares`); quiet while on a call (`quiet_on_calls`). */
  hideFromShares: boolean; quietOnCalls: boolean }
const defaultsOf = (decls: Decls) => Object.fromEntries(Object.entries(decls).map(([k, d]) => [k, d?.default]))
const among = <T extends string>(all: readonly T[], v: string | undefined, fallback: T) => all.find((m) => m === v) ?? fallback
/** The home vault's settings the helper follows: dictation's, the companion's and screen's data.json, their manifests'
 *  `settings` giving the defaults. */
export function prefsOf(d: Settings["dictation"], c: Settings["companion"], s: Settings["screen"], decls: Record<keyof Settings, Decls>): Prefs {
  const D = DICTATION_SETTINGS.parse(defaultsOf(decls.dictation)), C = COMPANION_SETTINGS.parse(defaultsOf(decls.companion)), S = SCREEN_SETTINGS.parse(defaultsOf(decls.screen))
  const talk = c.keys ?? C.keys ?? []
  return {
    fn: (d.fn ?? D.fn ?? true) !== false,
    keys: (d.keys ?? D.keys ?? []).filter((k) => !talk.includes(k)),
    talk,
    privateApps: s.private_apps ?? S.private_apps ?? [],
    dictation: d,
    sounds: (c.sounds ?? C.sounds ?? true) !== false,
    voice: {
      mode: among(["auto", "always", "off"], c.voice ?? C.voice, "auto"),
      provider: among(["auto", "elevenlabs", "soniox"], c.voice_provider ?? C.voice_provider, "auto"),
      name: c.voice_name ?? C.voice_name ?? "",
      eleven: { voice: c.elevenlabs_voice ?? C.elevenlabs_voice ?? "", model: c.elevenlabs_model ?? C.elevenlabs_model ?? "" },
      speed: Math.min(1.3, Math.max(0.7, (c.voice_speed ?? C.voice_speed ?? 1) || 1)),
    },
    realtime: {
      front: (c.voice_front ?? C.voice_front) === "pipeline" ? "pipeline" : "realtime",
      model: (c.realtime_model ?? C.realtime_model) || "gpt-realtime-2.1-mini",
      voice: (c.realtime_voice ?? C.realtime_voice) || "cedar",
    },
    jobNews: c.job_news ?? C.job_news ?? "quiet",
    timeline: (c.timeline ?? C.timeline ?? false) === true,
    hideFromShares: (c.hide_from_shares ?? C.hide_from_shares ?? true) !== false,
    quietOnCalls: (c.quiet_on_calls ?? C.quiet_on_calls ?? true) !== false,
  }
}
