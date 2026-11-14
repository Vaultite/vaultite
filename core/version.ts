export const APP_VERSION = "0.14.0"
export const API_VERSION = 10
export const MIN_API_VERSION = 1

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]*)?$/

export function parseVersion(v: unknown): [number, number, number] | null {
  const m = typeof v === "string" ? SEMVER.exec(v.trim()) : null
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** "hevy/v1.2.0" is 1.2.0 too: a plugin in a folder of a repository of several. */
export const tagVersion = (tag: string) => tag.slice(tag.lastIndexOf("/") + 1).replace(/^v/, "")

/** null for something that isn't a version. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a), y = parseVersion(b)
  if (!x || !y) return null
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}
