// The app's version and the plugin API's (no Node). Bump API_VERSION when a change would break a plugin written for
// the one before; a manifest asking for more, or older than MIN_API_VERSION, isn't loaded.
export const APP_VERSION = "0.4.0"
export const API_VERSION = 3
/** The oldest plugin API this app still loads plugins for. */
export const MIN_API_VERSION = 1

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]*)?$/

/** "1.2.3" -> [1, 2, 3]; null if it isn't a version. A pre-release or build suffix is ignored. */
export function parseVersion(v: unknown): [number, number, number] | null {
  const m = typeof v === "string" ? SEMVER.exec(v.trim()) : null
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** A release tag's version: "v1.2.0" is 1.2.0, and so is "hevy/v1.2.0" (a plugin in a folder of a repository of several). */
export const tagVersion = (tag: string) => tag.slice(tag.lastIndexOf("/") + 1).replace(/^v/, "")

/** a < b: negative, a == b: 0, a > b: positive (null for something that isn't a version). */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a), y = parseVersion(b)
  if (!x || !y) return null
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}
