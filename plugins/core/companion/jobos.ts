import { str, type Handoff } from "./jobs.ts"
import type { Need } from "./placement.ts"
import type { JobAsk } from "./types.ts"

export const ONLY_OS = ["macos", "ios", "windows", "linux"] as const
export type OnlyOs = typeof ONLY_OS[number]
export type OsNeed = { need: Need; why: string }

const SAID: Record<OnlyOs, OsNeed> = {
  macos: { need: "macos", why: "their ask is about something only the Mac has" },
  ios: { need: "macos", why: "their ask is about the iPhone app, which builds and runs (Xcode, its simulator) only on a Mac" },
  windows: { need: "windows", why: "their ask is about something only Windows has" },
  linux: { need: "linux", why: "their ask is about something only Linux has" },
}
const MAC_UI = /\b(traffic[- ]lights?|title ?bar|window (?:chrome|controls|buttons|frame|shadow|corners)|menu ?bar|notch|island|dock icon|vibrancy|swift helper)\b/i
const PHONE_APP = /\b(?:iphone|ios)(?: app)?\b|\bcapacitor\b|\bxcode\b|\btestflight\b/i
const DESKTOP_APP = /^app\.vaultite\b|^vaultite\b/i

export function osNeed(p: Pick<Handoff, "about" | "task"> & { os?: unknown }, m?: Pick<JobAsk, "app" | "appName" | "window" | "text">): OsNeed | null {
  const said = ONLY_OS.find((o) => o === str(p.os).trim().toLowerCase())
  if (said) return SAID[said]
  if (str(p.about) === "work") return null
  const words = [str(p.task), str(m?.text)].join("\n")
  const askedOnMac = !!m && (!!str(m.app) || !!m.window)
  const inApp = askedOnMac && (DESKTOP_APP.test(str(m.app)) || DESKTOP_APP.test(str(m.appName)))
  const ui = MAC_UI.exec(words)?.[1]
  if (ui && (inApp || (askedOnMac && str(p.about) === "app"))) return { need: "macos", why: `asked over the desktop app on a Mac, about its ${ui.toLowerCase()}, which only the Mac has` }
  if (str(p.about) === "app" && PHONE_APP.test(words)) return SAID.ios
  return null
}

const NAMES: Partial<Record<Need, string>> = { macos: "a Mac", windows: "a Windows machine", linux: "a Linux machine" }
export const osLine = (o: OsNeed) => `${o.why}: on ${NAMES[o.need] ?? o.need}`
