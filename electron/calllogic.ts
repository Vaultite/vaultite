// Whether the user is on a call (or recording), from who has the microphone open (screen.swift `mics`), apart from
// Electron. The companion keeps quiet meanwhile: its answers show as text, played only when they ask.

/** A process with an audio device running, as screen.swift tells it: `app`/`appBundle` the app responsible for it (a
 *  browser for its helper), `chain` its parents' pids. */
export type MicUser = { pid: number; bundle: string; app: string; appBundle: string; chain: number[]; input: boolean; output: boolean }
/** The call: the app on it, since when, when its mic last ran. */
export type Call = { app: string; bundle: string; since: number; heard: number }

/** Apps that are for calls: one opening the mic is on one at once, and while it plays sound it still is (muted). */
const CALL_APPS: Record<string, string> = {
  "us.zoom.xos": "Zoom", "com.apple.FaceTime": "FaceTime", "com.apple.avconferenced": "FaceTime", "com.apple.TelephonyUtilities": "a phone call",
  "com.apple.telephonyutilities.callservicesd": "a phone call", "com.microsoft.teams": "Teams", "com.microsoft.teams2": "Teams",
  "com.tinyspeck.slackmacgap": "Slack", "com.hnc.Discord": "Discord", "com.cisco.webexmeetingsapp": "Webex", "Cisco-Systems.Spark": "Webex",
  "com.skype.skype": "Skype", "net.whatsapp.WhatsApp": "WhatsApp", "desktop.WhatsApp": "WhatsApp", "ru.keepcoder.Telegram": "Telegram",
  "org.whispersystems.signal-desktop": "Signal", "com.around.Around": "Around", "app.tuple.app": "Tuple", "com.google.meet": "Google Meet",
}
/** Browsers: a call in a page (Meet, Huddles) opens the mic at once; their sound alone is no call (a video). */
const BROWSERS: Record<string, string> = {
  "com.google.Chrome": "Chrome", "com.apple.Safari": "Safari", "com.apple.WebKit.GPU": "Safari", "org.mozilla.firefox": "Firefox",
  "company.thebrowser.Browser": "Arc", "com.microsoft.edgemac": "Edge", "com.brave.Browser": "Brave", "com.vivaldi.Vivaldi": "Vivaldi",
  "com.operasoftware.Opera": "Opera", "com.openai.atlas": "ChatGPT Atlas",
}
/** Apps that keep the mic open all day for the user's own sake (noise filters, audio routers, mic mixers): never a call. */
const ALWAYS_ON = [/krisp/i, /^com\.rogueamoeba\.(soundsource|loopback)/i, /^com\.elgato\.wavelink/i, /^com\.reincubate\.camo/i, /nvidia.*broadcast/i, /^com\.bzg\.boom/i]
/** Dictation apps hold the mic a moment at a time: never a call. */
const DICTATION = [/wispr/i, /superwhisper/i, /macwhisper/i, /vorssaint/i, /voiceink/i, /aqua\.?voice/i, /^com\.apple\.(CoreSpeech|corespeechd|assistantd|SpeechRecognitionCore|siri)/i]
/** Another app holding the mic this long is a call or a recording (OBS, Voice Memos...): quiet then too. */
export const HELD_MS = 5000
/** A call's mic gone quiet stays a call this long (a page's mute stops its mic). */
export const GRACE_MS = 15_000
/** A browser or another app holding the mic longer than this is stuck (a tab that never let go), not a call; an app for
 *  calls never is (a long hangout). */
export const STUCK_MS = 3 * 3600_000
/** An app excused ("Not a call") counts again once it let go of the mic this long (a blip isn't a let-go). */
export const LET_GO_MS = 3000

/** The base app of a helper's bundle (com.google.Chrome.helper -> com.google.Chrome). */
const base = (b: string) => b.replace(/\.helper(\.[\w.-]+)?$/i, "").replace(/\.(renderer|gpu|plugin)$/i, "")
/** Who `u` is: the app responsible for it first (a browser's helper is the browser). */
function who(u: MicUser) {
  for (const b of [u.appBundle, u.bundle].map(base).filter(Boolean)) {
    if (CALL_APPS[b]) return { bundle: b, app: CALL_APPS[b], kind: "call" as const }
    if (BROWSERS[b]) return { bundle: b, app: BROWSERS[b], kind: "browser" as const }
  }
  const b = base(u.appBundle || u.bundle)
  return { bundle: b, app: u.app || b || "another app", kind: "other" as const }
}
/** Not a call however long it holds the mic: ours (any of this app's processes), dictation, the system's own. */
function ignored(u: MicUser, own: Set<number>) {
  if (own.has(u.pid) || u.chain.some((p) => own.has(p))) return true
  const b = [u.bundle, u.appBundle].join(" ")
  if (/vaultite/i.test(b) || [...DICTATION, ...ALWAYS_ON].some((r) => r.test(u.bundle) || r.test(u.appBundle) || r.test(u.app))) return true
  const w = who(u)
  // (the system's daemons open the mic for Siri and such; its call apps are named above)
  return w.kind === "other" && /^com\.apple\./.test(w.bundle) && !/VoiceMemos|QuickTimePlayerX|Photo ?Booth/i.test(w.bundle)
}

/** The call now: a call app on the mic at once, another after HELD_MS till STUCK_MS (`first`: since when); over GRACE_MS
 *  after its mic stops. `excused`: apps said not on a call (bundle: last seen on the mic), out till they let go of it. */
export function callFrom(users: MicUser[], own: Set<number>, was: Call | null, first: Map<string, number>, now: number, excused = new Map<string, number>()): Call | null {
  const held = users.filter((u) => u.input && !ignored(u, own)).map((u) => ({ u, w: who(u) }))
  for (const k of [...first.keys()]) if (!held.some((o) => o.w.bundle === k)) first.delete(k)
  for (const o of held) if (!first.has(o.w.bundle)) first.set(o.w.bundle, now)
  for (const [k, seen] of excused) if (held.some((o) => o.w.bundle === k)) excused.set(k, now); else if (now - seen >= LET_GO_MS) excused.delete(k)
  const open = held.filter((o) => !excused.has(o.w.bundle) && (o.w.kind === "call" || now - first.get(o.w.bundle)! < STUCK_MS))
  if (was && excused.has(was.bundle)) was = null
  // (the call's own app first, so it keeps its name while another opens the mic)
  const on = open.find((o) => o.w.bundle === was?.bundle) ?? open.find((o) => o.w.kind !== "other") ?? open.find((o) => now - first.get(o.w.bundle)! >= HELD_MS)
  if (on) return was?.bundle === on.w.bundle ? { ...was, heard: now } : { app: on.w.app, bundle: on.w.bundle, since: now, heard: now }
  if (!was) return null
  // (still holding the mic but stuck: over at once)
  if (held.some((o) => o.w.bundle === was!.bundle)) return null
  // (a call app still playing the call's sound: muted, not hung up)
  const playing = users.some((u) => u.output && !ignored(u, own) && who(u).bundle === was!.bundle && who(u).kind === "call")
  if (playing) return { ...was, heard: now }
  return now - was.heard < GRACE_MS ? was : null
}

/** The call in a few words, for `vau companion status`. */
export const callSaid = (c: Call | null) => (c ? (c.app === "a phone call" ? "on a phone call" : `on a call in ${c.app}`) : "")
/** Why it's quiet, at a glance in its box: the app holding the mic named. */
export const callShown = (app: string) => (app === "a phone call" ? "Quiet: you're on a phone call" : `Quiet: ${app} has your mic`)
