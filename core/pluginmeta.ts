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
