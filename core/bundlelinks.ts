// A bundle shared as a link (core/docs/bundles.md), its file in a GitHub repository: owner/name[/folder]. No Node: the
// app, the demo and the desktop app's main process read these.
const SITE = "https://vaultite.com"

export type Repo = { owner: string; name: string; dir: string | null; tag: string | null }

const SEG = /^[\w.-]+$/

/** The repository in what someone pastes or opens: owner/name[/folder][@tag], gh:…, a github.com address (…/tree/<branch>/
 *  <folder>: the branch is dropped), or a bundle's link (vaultite.com/b/…, vaultite://bundle/…). Null when it names none. */
export function parseRepo(given: string): Repo | null {
  let s = given.trim().replace(/[?#].*$/, "")
  let gh = false
  s = s.replace(/^gh:/i, "").replace(/^vaultite:\/\/bundle\//i, "").replace(/^(https?:\/\/)?(www\.)?vaultite\.com\/b\//i, "")
  s = s.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, () => { gh = true; return "" }).replace(/\/+$/, "")
  let tag: string | null = null
  const at = /@([\w.+-]+)$/.exec(s)
  if (at) { tag = at[1]; s = s.slice(0, at.index) }
  const parts = s.split("/")
  if (gh && (parts[2] === "tree" || parts[2] === "blob")) parts.splice(2, 2)
  if (parts.length < 2 || parts.some((p) => !SEG.test(p) || /^\.+$/.test(p))) return null
  const [owner, repo, ...dir] = parts
  const name = repo.replace(/\.git$/, "")
  if (!name || (dir.length && repo !== name)) return null
  return { owner, name, dir: dir.join("/") || null, tag }
}

/** owner/name[/folder][@tag], as the app's import takes it. */
export const repoText = (r: Repo, withTag = true) => `${r.owner}/${r.name}${r.dir ? `/${r.dir}` : ""}${withTag && r.tag ? `@${r.tag}` : ""}`

/** The page that shows a bundle and tries it live: vaultite.com/b/owner/name[/folder]. */
export const webLink = (r: Repo) => `${SITE}/b/${repoText(r, false)}`
