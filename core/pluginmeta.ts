// What a plugin's manifest says about it beyond what the app checks: its version, repository and disclosures (no Node,
// no packages: the server, the app and tools/plugin-index.ts read them alike).
export const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
export const REPO = /^[\w.-]+\/[\w.-]+$/
/** A host a plugin talks to ("api.example.com", "*.example.com"), or "*": hosts the user sets in its settings (a sync's server). */
export const HOST = /^(?:\*|(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+(:\d+)?)$/i

/** What a plugin says it does beyond the vault (`disclosures`), in words: shown before it may run. Booleans but `network`. */
export const DISCLOSURES = { network: "talks to", shell: "runs programs on this machine", outsideVault: "reads or writes files outside the vault",
  clipboard: "reads the clipboard" } as const
export type Disclosures = { network?: string[]; shell?: boolean; outsideVault?: boolean; clipboard?: boolean }

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** A manifest's (or an index entry's) `disclosures`, as far as they read (core/rules.ts says what's wrong). */
export function disclosuresOf(m: Record<string, unknown>): Disclosures {
  const d = isMap(m.disclosures) ? m.disclosures : {}
  const out: Disclosures = {}
  if (Array.isArray(d.network)) { const hosts = d.network.filter((h): h is string => typeof h === "string" && HOST.test(h)); if (hosts.length) out.network = hosts }
  for (const k of ["shell", "outsideVault", "clipboard"] as const) if (d[k] === true) out[k] = true
  return out
}

/** Its disclosures as sentences after "It ": "talks to api.example.com", "runs programs on this machine". */
export function disclosed(d: Disclosures | null | undefined): string[] {
  const out: string[] = []
  const named = (d?.network ?? []).filter((h) => h !== "*"), any = d?.network?.includes("*")
  if (named.length || any) out.push(`${DISCLOSURES.network} ${[named.join(", "), any ? "any host you set in its settings" : ""].filter(Boolean).join(" and ")}`)
  for (const k of ["shell", "outsideVault", "clipboard"] as const) if (d?.[k]) out.push(DISCLOSURES[k])
  return out
}

/** A manifest's `icon` as a name: Lucide's ("heart-pulse") or one an app plugin adds ("claude"). */
export const ICON_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
/** ...or an SVG file in its folder ("icon.svg"), at most ICON_MAX bytes. */
export const ICON_FILE = /^[\w-]+(\/[\w-]+)*\.svg$/
export const ICON_MAX = 16_000
const ICON_DATA = /^data:image\/svg\+xml,[^"\\\s]+$/

/** An SVG mark as the app draws it: a data address (null for what doesn't read as one SVG). Drawn as a mask in the
 *  text's colour (web core/icons.tsx), never as a document, so nothing in it runs. */
export function svgIcon(svg: string): string | null {
  const s = svg.replace(/^﻿/, "").replace(/^\s*(<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|\s)*/i, "").trim()
  if (s.length > ICON_MAX || !/^<svg[\s>]/i.test(s) || !/<\/svg>$/i.test(s) || /<script|<foreignObject/i.test(s)) return null
  return `data:image/svg+xml,${encodeURIComponent(s)}`
}

/** A manifest's (or an index entry's) `icon` as the app draws it: a name, or its SVG file read by `read` (a path in
 *  its folder -> its text, or null) as a data address; an index entry's data address as it is. Null for none. */
export function iconOf(icon: unknown, read?: (file: string) => string | null): string | null {
  if (typeof icon !== "string") return null
  if (ICON_NAME.test(icon)) return icon
  if (ICON_DATA.test(icon) && icon.length <= ICON_MAX * 3) return icon
  if (read && ICON_FILE.test(icon)) { const svg = read(icon); return svg === null ? null : svgIcon(svg) }
  return null
}
