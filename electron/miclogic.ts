// Which microphone dictation and the Talk key hear with (the setting `microphone`), apart from Electron. Opening a
// Bluetooth headset's mic drops it to its call profile (24 kHz, both ways) and back ~2 s after: `auto` avoids it.

/** An audio device as dictation.swift lists it: `transport` is Core Audio's code (bltn, blue, blea, usb...). */
export type AudioDevice = { uid: string; name: string; transport: string; input: boolean; output: boolean }
/** The devices, and the system's default input and output (their uids). */
export type Devices = { devices: AudioDevice[]; input: string; output: string }
/** The mic to open (`uid` "": the system's input), why, and the ones to take should it go mid-capture, in order. */
export type MicPick = { uid: string; name: string; bluetooth: boolean; why: string; fallback: string[] }

const BLUETOOTH = new Set(["blue", "blea"])
/** Plugged in: a mic of its own, not the room's through a headset's link (virtual and aggregate devices aren't mics). */
const WIRED = new Set(["usb", "1394", "thun", "pci", "hdmi", "dprt", "ccwd", "avb"])
export const isBluetooth = (d?: AudioDevice | null) => !!d && BLUETOOTH.has(d.transport)

/** `setting`: auto (the default), default (the system's input), builtin, or a device's name (or uid). */
export function pickMic(setting: unknown, list: Devices | null): MicPick {
  const raw = typeof setting === "string" ? setting.trim() : ""
  const want = raw.toLowerCase() || "auto"
  if (!list) return { uid: "", name: "", bluetooth: false, why: "devices not listed yet: the system's input", fallback: [] }
  const inputs = list.devices.filter((d) => d.input)
  const def = inputs.find((d) => d.uid === list.input) ?? null
  const out = list.devices.find((d) => d.uid === list.output) ?? null
  const builtin = inputs.find((d) => d.transport === "bltn") ?? null
  const wired = inputs.filter((d) => WIRED.has(d.transport))
  const of = (d: AudioDevice | null, why: string, fallback: (AudioDevice | null)[] = []): MicPick => d
    ? { uid: d.uid, name: d.name, bluetooth: isBluetooth(d), why, fallback: [...new Set(fallback.filter((x): x is AudioDevice => !!x && x.uid !== d.uid).map((x) => x.uid))] }
    : { uid: "", name: "", bluetooth: false, why: "no microphone found", fallback: [] }
  // (gone mid-capture: the others not on Bluetooth first while the output is, then whatever the system's input is then)
  const rest = isBluetooth(out) ? [builtin, ...wired] : []

  function auto(): MicPick {
    if (!isBluetooth(out)) return of(def, "the system's input")
    if (def && !isBluetooth(def)) return of(def, `the system's input (the output, ${out!.name}, is Bluetooth)`, rest)
    const alt = builtin ?? wired[0] ?? null
    if (alt) return of(alt, `the output, ${out!.name}, is Bluetooth: its mic would drop it to call quality`, rest)
    return of(def, `the output, ${out!.name}, is Bluetooth and there's no built-in or wired mic`)
  }
  if (want === "auto") return auto()
  if (want === "default") return of(def, "the system's input (set)")
  if (want === "builtin" || want === "built-in") return builtin ? of(builtin, "the built-in mic (set)", rest) : { ...of(def, "no built-in mic (a closed lid?): the system's input"), fallback: [] }
  const named = inputs.find((d) => d.name.toLowerCase() === want) ?? inputs.find((d) => d.uid === raw) ?? inputs.find((d) => d.name.toLowerCase().includes(want))
  if (named) return of(named, `${named.name} (set)`, [...rest, def])
  const a = auto()
  return { ...a, why: `${raw} isn't here: ${a.why}` }
}

/** A pick in a few words, for `vau companion status`. */
export const micSaid = (m: { name: string; why: string }) => m.name ? `${m.name}, ${m.why}` : m.why
