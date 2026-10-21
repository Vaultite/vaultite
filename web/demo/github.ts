// A bundle in a GitHub repository, fetched by the visitor's browser: the demo has no git, so this is core/bundles.ts
// importFrom's clone over GitHub's API (the file list, its tags) and raw files, made into an export to import.
import { CONFIGS, PICTURES, slug } from "../../core/bundles.ts"
import { parseRepo, repoText } from "../../core/bundlelinks.ts"
import { HTTPError } from "../../core/plugins.ts"
import { compareVersions, tagVersion } from "../../core/version.ts"

const API = "https://api.github.com", RAW = "https://raw.githubusercontent.com"
const MAX_BYTES = 64 << 20, MAX_FILES = 2000
const STABLE = /^v?\d+\.\d+\.\d+$/

type Fetch = (url: string) => Promise<Response>
type Export = { vaultite: "bundle"; format: 1; id: string | null; files: Record<string, unknown> }

async function ask(f: Fetch, url: string, what: string) {
  let r: Response
  try { r = await f(url) } catch { throw new HTTPError(502, "couldn't reach GitHub from this browser") }
  if (r.status === 403 || r.status === 429) throw new HTTPError(429, "GitHub is asking this browser to wait (too many requests): try again in a few minutes")
  if (r.status === 404) throw new HTTPError(404, what)
  if (!r.ok) throw new HTTPError(502, `GitHub answered ${r.status}`)
  return r
}

/** The bundle in `given` (owner/name[/folder][@tag]) at its tag, else its newest version tag, else the default branch:
 *  its folder at the top (bundle.json) without the repository's own files, or one .bundle.json. */
export async function fromGitHub(given: string, f: Fetch = fetch): Promise<Export> {
  const r = parseRepo(given)
  if (!r) throw new HTTPError(400, `'${given}' isn't a bundle's repository: owner/name on GitHub (owner/name/folder for one in a folder)`)
  const repo = `${r.owner}/${r.name}`, none = `there's no public repository ${repo} on GitHub`
  let ref = r.tag && r.dir && !r.tag.includes("/") ? `${r.dir}/${r.tag}` : r.tag
  if (!ref) {
    const tags = (await (await ask(f, `${API}/repos/${repo}/tags?per_page=100`, none)).json() as { name: string }[]).map((t) => t.name)
      .filter((t) => (r.dir ? t.startsWith(`${r.dir}/`) && STABLE.test(t.slice(r.dir.length + 1)) : STABLE.test(t)))
      .sort((a, b) => compareVersions(tagVersion(b), tagVersion(a))!)
    ref = tags[0] ?? "HEAD"
  }
  const tree = await (await ask(f, `${API}/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, r.tag ? `${repo} has no tag ${r.tag}` : none)).json() as
    { tree: { path: string; type: string; mode: string; size?: number }[]; truncated?: boolean }
  const top = r.dir ? `${r.dir}/` : ""
  // (as a clone without symlinks, and the app's readFolder: nothing hidden)
  const all = tree.tree.filter((e) => e.type === "blob" && e.mode !== "120000" && e.path.startsWith(top))
    .map((e) => ({ rel: e.path.slice(top.length), size: e.size ?? 0 })).filter((e) => !e.rel.split("/").some((p) => p.startsWith(".")))
  if (r.dir && !all.length) throw new HTTPError(404, `${given} has no folder ${r.dir}`)
  const got = new Map<string, Promise<Uint8Array>>()
  const raw = (rel: string) => got.get(rel) ?? got.set(rel, ask(f, `${RAW}/${repo}/${encodeURIComponent(ref!)}/${(top + rel).split("/").map(encodeURIComponent).join("/")}`, `${rel} is gone from ${repo}`)
    .then(async (res) => new Uint8Array(await res.arrayBuffer()))).get(rel)!
  const text = (b: Uint8Array) => { try { return new TextDecoder("utf-8", { fatal: true }).decode(b) } catch { return null } }
  let files: Record<string, unknown>, id: string | null = null
  if (all.some((e) => e.rel === "bundle.json")) {
    const conf = async (name: string) => { try { return all.some((e) => e.rel === name) ? JSON.parse(text(await raw(name)) ?? "") : null } catch { return null } }
    const pages = await conf("pages.json"), newtab = await conf("newtab.json")
    const named = [...(Array.isArray(pages?.pinned) ? pages.pinned : []), String(newtab?.page ?? "")]
    const own = (rel: string) => rel.includes("/") || rel === "bundle.json" || PICTURES.includes(rel) || CONFIGS.some((c) => rel === `${c}.json`) || named.includes(rel)
    const take = all.filter((e) => own(e.rel))
    if (take.length > MAX_FILES || take.reduce((n, e) => n + e.size, 0) > MAX_BYTES) throw new HTTPError(413, "that bundle is too big: over 64 MB in all")
    files = {}
    for (let i = 0; i < take.length; i += 8) {
      await Promise.all(take.slice(i, i + 8).map(async ({ rel }) => {
        const b = await raw(rel), t = text(b)
        files[rel] = t ?? (rel.endsWith(".json") ? "" : { base64: Buffer.from(b).toString("base64") })
      }))
    }
  } else {
    const one = all.filter((e) => !e.rel.includes("/") && e.rel.endsWith(".bundle.json"))
    if (one.length !== 1) throw new HTTPError(404, `${given} has no bundle: a bundle.json at its top (the bundle's folder), or one .bundle.json`)
    let o: Export
    try { o = JSON.parse(text(await raw(one[0].rel)) ?? "") } catch { throw new HTTPError(400, `${one[0].rel} isn't JSON`) }
    if (!o || typeof o !== "object" || o.vaultite !== "bundle" || !o.files || typeof o.files !== "object") throw new HTTPError(400, `${one[0].rel} isn't a Vaultite bundle`)
    files = { ...o.files }
    id = typeof o.id === "string" ? o.id : null
  }
  const from = repoText(r, false)
  const m = files["bundle.json"]
  let meta: Record<string, unknown> = {}
  try { meta = typeof m === "string" ? JSON.parse(m) : (m as Record<string, unknown>) ?? {} } catch { /* the import says what's wrong */ }
  files["bundle.json"] = JSON.stringify({ ...meta, from }, null, 2) + "\n"
  return { vaultite: "bundle", format: 1, id: id ?? slug((r.dir ?? r.name).split("/").at(-1)!), files }
}
