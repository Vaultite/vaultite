// Containers: named logins a tab picks (Personal, Work), each its own cookies and storage, so one site can be signed in
// to with several accounts side by side. A tab in one is `view:web/@<id>/<address>`; a tab in none has its workspace's.
import { settings, profile, type Settings } from "./state"

export type Container = { id: string; name: string; color: ContainerColor
  /** Sites it opens ("youtube.com"): a page of one opened in no container opens in this one. */
  sites?: string[]
  /** Its pages need Touch ID to open (electron/browser/lock.ts). */
  lock?: boolean
  /** What agents may do in its pages (electron/browser/agent.ts): read them, or act in them too; unset, nothing. */
  agents?: "read" | "act" }
export const COLORS = ["blue", "orange", "green", "red", "purple", "pink", "yellow", "teal", "indigo", "gray"] as const
export type ContainerColor = (typeof COLORS)[number]
export const colorOf = (c: Pick<Container, "color">) => `var(--${COLORS.includes(c.color) ? c.color : "gray"})`

/** Until the user changes them (kept in code: a vault gets them written only once it's changed). */
const DEFAULTS: Container[] = [
  { id: "personal", name: "Personal", color: "blue" },
  { id: "work", name: "Work", color: "orange" },
  // (agents' own: what they sign in to there is theirs to use, the user's other logins aren't)
  { id: "agents", name: "Agents", color: "purple", agents: "act" },
]

const ID = /^[a-z0-9]{1,24}$/
const clean = (list: unknown): Container[] | null => Array.isArray(list)
  ? list.flatMap((c): Container[] => c && typeof c === "object" && ID.test(String(c.id)) && typeof c.name === "string" && c.name.trim()
    ? [{ id: c.id, name: c.name.trim().slice(0, 40), color: COLORS.includes(c.color) ? c.color : "gray",
        ...(Array.isArray(c.sites) && c.sites.length ? { sites: c.sites.filter((s: unknown): s is string => typeof s === "string" && !!s) } : {}),
        ...(c.lock === true ? { lock: true } : {}), ...(c.agents === "read" || c.agents === "act" ? { agents: c.agents } : {}) }]
    : [])
  : null

export const containersOf = (s: Settings) => clean(s.containers) ?? DEFAULTS
export const containers = () => containersOf(settings.get())
export const useContainers = () => containersOf(settings.use())
export const containerById = (id: string | null | undefined) => (id ? containers().find((c) => c.id === id) ?? null : null)

/** A web tab's arg: its container's id (null: none) and its address. */
export function splitArg(arg: string): { container: string | null; url: string } {
  const m = /^@([a-z0-9]{1,24})\/(.*)$/s.exec(arg)
  return m ? { container: m[1], url: m[2] } : { container: null, url: arg }
}
export const argOf = (url: string, container: string | null) => (container ? `@${container}/${url}` : url)

/** The logins (electron/web.ts's profile) of a page in `container`, or the workspace's in none. */
export const profileIn = (container: string | null) => (container ? `c-${container}` : profile())
/** The container a page's logins are, from its profile ("c-work"); null for a workspace's. */
export const containerOfProfile = (prof: string) => (prof.startsWith("c-") ? prof.slice(2) : null)

/** "www.youtube.com" → "youtube.com": what a container's sites name. */
export function siteOf(url: string) {
  let host = ""
  try { host = new URL(url).hostname.toLowerCase() } catch { return "" }
  if (!host.includes(".") || /^[\d.]+$/.test(host)) return host
  const parts = host.split(".")
  return parts.slice(/\.(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/.test(host) ? -3 : -2).join(".")
}

/** The container a page opened in none goes to: the one whose sites have its site, if any. */
export function ruleFor(url: string): string | null {
  const site = siteOf(url)
  return (site && containers().find((c) => c.sites?.includes(site))?.id) || null
}

const save = (list: Container[]) => settings.set({ containers: list })

export function newContainerId(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20) || "container"
  const taken = new Set(containers().map((c) => c.id))
  let id = base, n = 2
  while (taken.has(id)) id = `${base}${n++}`
  return id
}
export function addContainer(name: string, color?: ContainerColor): Container {
  const list = containers()
  const c: Container = { id: newContainerId(name), name: name.trim().slice(0, 40), color: color ?? COLORS[list.length % COLORS.length] }
  void save([...list, c])
  return c
}
export const updateContainer = (id: string, change: Partial<Omit<Container, "id">>) =>
  save(containers().map((c) => (c.id === id ? { ...c, ...change } : c)))
export const removeContainer = (id: string) => save(containers().filter((c) => c.id !== id))

/** Always open `site` in `id` (null: in no container): it leaves any other container's sites. */
export function setSiteRule(site: string, id: string | null) {
  return save(containers().map((c) => {
    const sites = (c.sites ?? []).filter((s) => s !== site)
    if (c.id === id) sites.push(site)
    const { sites: _, ...rest } = c
    return sites.length ? { ...rest, sites } : rest
  }))
}
