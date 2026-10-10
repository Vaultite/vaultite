// Vault plugins installed from a git repository (GitHub's owner/name, a git URL, or a folder on this machine): fetched with
// git (argv, no shell) at a tag, checked, copied into .vaultite/plugins/<id>/ off, and recorded in the vault's lock file.
// Or from a zip at an https address pinned by its hash (`…/x.zip#sha256=<hex>`), for plugins that aren't in a repository.
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { OpError } from "./ops.ts"
import { today } from "./plugins.ts"
import { DISCLOSURES, disclosuresOf } from "./pluginmeta.ts"
import { ignoreOf, userFilesOf, walk } from "./rules.ts"
import { compareVersions, tagVersion } from "./version.ts"
import { checkVaultPlugin, DIR, digestOf } from "./vaultplugins.ts"
import { unzip } from "./unzip.ts"
import type { Item, Vault } from "./vault.ts"

/** Where a plugin came from, as .vaultite/plugins-lock.json keeps it (so another machine knows): `source` as asked,
 *  `repo` on GitHub, the tag and commit fetched (null from a plain folder), its content hash and version then. */
export type Locked = { source: string; repo: string | null; tag: string | null; commit: string | null; version: string; hash: string; installed: string }
export const LOCK = "plugins-lock" // .vaultite/plugins-lock.json

/** What a source names: a git address to clone (or a plain folder to copy), its GitHub repo, the plugin's folder in it
 *  (`dir`, for a repository of several plugins: its tags are `<dir>/v1.2.0`), a tag asked for; or a zip to download
 *  (`archive`: its address and the sha256 it must have). */
export type Source = { given: string; url: string | null; folder: string | null; repo: string | null; dir: string | null; tag: string | null
  archive?: { url: string; sha256: string } }

/** A zip's address: https (http only to this machine), its path ending in .zip, `#sha256=<64 hex>` after it. */
const ARCHIVE = /^(https?):\/\/([^/?#]+)(\/[^?#]*\.zip)(\?[^#]*)?(?:#sha256=([0-9a-fA-F]{64}))?$/i
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i
export const ZIP_MAX = 64 << 20, UNZIPPED_MAX = 256 << 20, ENTRIES_MAX = 5000

const STABLE = /^v?\d+\.\d+\.\d+$/
const GIT_TIMEOUT = 120_000

/** "owner/name[@tag]", a git URL ("https://...", "git@host:o/n.git", "file://...") with "@tag" after it, or a folder on
 *  this machine (a git repository is cloned, so its tags count; else copied as it is). */
export function parseSource(given: string, tag?: string | null): Source {
  let s = given.trim()
  let at: string | null = tag?.trim() || null
  const cut = (re: RegExp) => { const m = re.exec(s); if (m) { s = s.slice(0, m.index); at ??= m[1] } }
  const local = /^(\/|~\/|\.\.?\/|\.\.?$)/.test(s)
  if (local) {
    const expand = (p: string) => path.resolve(p.replace(/^~(?=\/)/, os.homedir()))
    if (!fs.existsSync(expand(s))) cut(/@([\w.+-]+)$/)
    const dir = expand(s)
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new OpError(`there's no folder ${dir}`, 404)
    return fs.existsSync(path.join(dir, ".git")) ? { given, url: pathToFileURL(dir).href, folder: null, repo: null, dir: null, tag: at }
      : { given, url: null, folder: dir, repo: null, dir: null, tag: null }
  }
  const zip = ARCHIVE.exec(s)
  if (zip) {
    const [, scheme, host, file, , hash] = zip
    if (scheme.toLowerCase() !== "https" && !LOOPBACK.test(host)) throw new OpError(`a plugin's zip is fetched over https only: ${scheme}://${host}${file}`)
    if (!hash) throw new OpError(`a plugin's zip needs its hash after its address, #sha256=<64 hex digits>, so what's installed is what was meant: ${scheme}://${host}${file}`)
    // (recorded and shown without its query: a short-lived signed address isn't kept in the vault's lock file)
    return { given: `${scheme}://${host}${file}#sha256=${hash.toLowerCase()}`, url: null, folder: null, repo: null, dir: null, tag: null,
      archive: { url: s.replace(/#.*$/, ""), sha256: hash.toLowerCase() } }
  }
  if (/^(https?|ssh|git|file):\/\//i.test(s) || /^[\w.-]+@[\w.-]+:/.test(s)) {
    cut(/@([\w.+-]+)$/)
    const gh = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(s)
    return { given, url: s, folder: null, repo: gh ? `${gh[1]}/${gh[2]}` : null, dir: null, tag: at }
  }
  cut(/@([\w.+-]+)$/)
  const m = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?((?:\/[\w.-]+)*)$/.exec(s)
  const dir = m?.[3].slice(1) || null
  if (!m || dir?.split("/").some((p) => /^\.+$/.test(p))) {
    throw new OpError(`'${given}' isn't a plugin's source: owner/name on GitHub (owner/name/folder for one of several in it, with @tag), a git URL, or a folder`)
  }
  // (VAULTITE_GITHUB: another place for owner/name, this machine's; file://<folder> in the tests)
  const base = (process.env.VAULTITE_GITHUB || "https://github.com").replace(/\/+$/, "")
  return { given, url: `${base}/${m[1]}/${m[2]}${base === "https://github.com" ? ".git" : ""}`, folder: null, repo: `${m[1]}/${m[2]}`, dir,
    tag: at && dir && !at.includes("/") ? `${dir}/${at}` : at }
}

/** git with these arguments (never a shell; no prompts for a password): its output, or an OpError with its message. */
export function git(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout: GIT_TIMEOUT, maxBuffer: 16 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "" } },
      (err, stdout, stderr) => (err ? reject(new OpError(`git ${args.find((a, i) => !a.startsWith("-") && args[i - 1] !== "-c")}: ${(String(stderr).trim().split("\n").at(-1) || err.message).slice(0, 300)}`, 502)) : resolve(String(stdout))))
  })
}

/** A repository's version tags (v1.2.0 and 1.2.0; pre-releases only when asked by name), newest first; with `dir`, its
 *  plugin's in that folder (hevy/v1.2.0). */
export async function tagsOf(url: string, dir: string | null = null): Promise<string[]> {
  const out = await git(["ls-remote", "--tags", "--refs", url])
  return out.split("\n").map((l) => l.split("\trefs/tags/")[1]?.trim())
    .filter((t): t is string => !!t && (dir ? t.startsWith(`${dir}/`) && STABLE.test(t.slice(dir.length + 1)) : STABLE.test(t)))
    .sort((a, b) => compareVersions(tagVersion(b), tagVersion(a))!)
}

/** Its default branch's commit (an install without tags is followed by commit). */
async function headOf(url: string) {
  return (await git(["ls-remote", url, "HEAD"])).split("\t")[0].trim() || null
}

/** A source fetched and checked, in a temporary folder: its files (as the vault would have them), manifest, tag, commit. */
export type Fetched = { dir: string; id: string; manifest: Item; tag: string | null; commit: string | null; untagged: boolean; done: () => void }

/** Clone (or copy) a source at its tag (else its newest version tag, else the default branch: `untagged`), copy what
 *  the app reads to <tmp>/<id>/ and check it like an installed plugin: OpError 422 with its problems. */
export async function fetchSource(src: Source, tiers: Map<string, string>, vaultIds: string[]): Promise<Fetched> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-install-"))
  const done = () => fs.rmSync(tmp, { recursive: true, force: true })
  try {
    let from: string, tag: string | null = null, commit: string | null = null, untagged = false
    if (src.folder) from = src.folder
    else if (src.archive) from = await unpack(src, path.join(tmp, "zip"))
    else {
      tag = src.tag ?? (await tagsOf(src.url!, src.dir))[0] ?? null
      untagged = !tag
      from = path.join(tmp, "clone")
      // (symlinks checked out as plain files: a link can't point a plugin's file anywhere on this machine)
      await git(["-c", "core.symlinks=false", "clone", "--quiet", "--depth", "1", "--no-tags", "--single-branch", ...(tag ? ["--branch", tag] : []), src.url!, from])
      commit = (await git(["rev-parse", "HEAD"], from)).trim()
      if (src.dir) {
        from = path.join(from, src.dir)
        if (!fs.existsSync(path.join(from, "manifest.json"))) throw new OpError(`${src.repo ?? src.url} has no plugin in ${src.dir}/${tag ? ` at ${tag}` : ""}`, 404)
      }
    }
    let manifest: Item
    try { manifest = JSON.parse(fs.readFileSync(path.join(from, "manifest.json"), "utf8")) } catch (e) {
      throw new OpError(`${src.given}${tag ? ` at ${tag}` : ""} has no readable manifest.json at its top (${(e as Error).message})`, 422)
    }
    const id = typeof manifest.id === "string" ? manifest.id : ""
    if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new OpError(`${src.given}: its manifest's id must be lowercase letters, digits and dashes`, 422)
    if (tiers.has(id)) throw new OpError(`${src.given} is '${id}', which is one of the app's own plugins: it can't be installed`, 409)
    const dir = path.join(tmp, "stage", id)
    const ignored = ignoreOf(from)
    for (const f of walk(from)) {
      if (fs.lstatSync(f).isSymbolicLink() || ignored(path.relative(from, f))) continue
      const to = path.join(dir, path.relative(from, f))
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(f, to)
    }
    const ids = new Map([...vaultIds.map((v): [string, string] => [v, "vault"]), [id, "vault"], ...tiers])
    const label = `${DIR}/${id}`
    const { problems } = checkVaultPlugin(dir, { ids, label, tag, installable: true, manifest })
    if (problems.length) throw new OpError(`${src.given}${tag ? ` at ${tag}` : ""} can't be installed`, 422, problems)
    return { dir, id, manifest, tag, commit, untagged, done }
  } catch (e) {
    done()
    throw e
  }
}

/** A source's zip downloaded (at most ZIP_MAX), checked against its sha256 and unpacked into `to` (its files at the
 *  top, or in its one top folder): the folder. Names that would leave the folder, too many files or too many bytes
 *  unpacked are refused. */
async function unpack(src: Source, to: string): Promise<string> {
  const { url, sha256 } = src.archive!, shown = src.given.replace(/#.*$/, "")
  let r: Response
  try { r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(GIT_TIMEOUT) }) } catch (e) {
    throw new OpError(`couldn't download ${shown}: ${(e as Error).message}`, 502)
  }
  if (!r.ok) throw new OpError(`couldn't download ${shown}: it answered ${r.status}`, 502)
  if (r.redirected && !/^https:/i.test(r.url) && !LOOPBACK.test(new URL(r.url).host)) throw new OpError(`${shown} sent the download elsewhere over plain http`, 502)
  if (Number(r.headers.get("content-length") ?? 0) > ZIP_MAX) throw new OpError(`${shown} is over ${ZIP_MAX >> 20} MB`, 413)
  const parts: Buffer[] = []
  let size = 0
  for await (const chunk of r.body as AsyncIterable<Uint8Array>) {
    size += chunk.length
    if (size > ZIP_MAX) throw new OpError(`${shown} is over ${ZIP_MAX >> 20} MB`, 413)
    parts.push(Buffer.from(chunk))
  }
  const buf = Buffer.concat(parts)
  const got = crypto.createHash("sha256").update(buf).digest("hex")
  if (got !== sha256) throw new OpError(`${shown} isn't the file its #sha256 names (it's ${got}): not installed`, 422)
  let entries: Map<string, () => Buffer>
  try { entries = unzip(buf) } catch (e) { throw new OpError(`${shown} isn't a zip that can be read: ${(e as Error).message}`, 422) }
  if (entries.size > ENTRIES_MAX) throw new OpError(`${shown} has over ${ENTRIES_MAX} files`, 422)
  const names = [...entries.keys()]
  const bad = names.find((n) => n.startsWith("/") || n.includes("\\") || n.split("/").some((p) => p === ".." || p === "."))
  if (bad) throw new OpError(`${shown} has a file outside its folder: ${bad}`, 422)
  const tops = new Set(names.map((n) => n.split("/")[0]))
  const strip = !entries.has("manifest.json") && tops.size === 1 && entries.has(`${[...tops][0]}/manifest.json`) ? `${[...tops][0]}/` : ""
  let total = 0
  for (const [name, read] of entries) {
    const rel = name.slice(strip.length)
    if (!rel) continue
    let bytes: Buffer
    try { bytes = read() } catch (e) { throw new OpError(`${shown}: ${(e as Error).message}`, 422) }
    total += bytes.length
    if (total > UNZIPPED_MAX) throw new OpError(`${shown} unpacks to over ${UNZIPPED_MAX >> 20} MB`, 422)
    const out = path.join(to, ...rel.split("/"))
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, bytes)
  }
  return to
}

export function readLock(vault: Vault): Record<string, Locked> {
  const o = vault.config(LOCK)
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v && typeof v === "object" && typeof (v as Item).source === "string")) as Record<string, Locked>
}

function writeLock(vault: Vault, id: string, entry: Locked | null) {
  let cur: Item = {}
  try { cur = vault.readConfig(LOCK) ?? {} } catch { throw new OpError(".vaultite/plugins-lock.json doesn't read: not overwriting it (fix it, or try again)", 409) }
  const next = { ...cur }
  if (entry) next[id] = entry; else delete next[id]
  if (!Object.keys(next).length) vault.removeConfig(LOCK)
  else vault.setConfig(LOCK, Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b))))
}


/** Put a fetched plugin's files in the vault as `.vaultite/plugins/<id>/` (its settings, data.json, kept), swapping the
 *  whole folder at once; records it in the lock. */
export function place(vault: Vault, f: Fetched, src: Source): Locked {
  const root = vault.abs(DIR), target = path.join(root, f.id)
  const fresh = path.join(root, `.${f.id}.new`), old = path.join(root, `.${f.id}.old`)
  fs.rmSync(fresh, { recursive: true, force: true })
  fs.rmSync(old, { recursive: true, force: true })
  fs.mkdirSync(root, { recursive: true })
  fs.cpSync(f.dir, fresh, { recursive: true })
  // (its settings and the files it keeps as the user's stay as they are here)
  for (const f of ["data.json", ...userFilesOf(fresh)]) {
    if (!fs.existsSync(path.join(target, f))) continue
    fs.mkdirSync(path.dirname(path.join(fresh, f)), { recursive: true })
    fs.copyFileSync(path.join(target, f), path.join(fresh, f))
  }
  if (fs.existsSync(target)) fs.renameSync(target, old)
  fs.renameSync(fresh, target)
  fs.rmSync(old, { recursive: true, force: true })
  const entry: Locked = { source: src.given, repo: src.repo ?? (typeof f.manifest.repo === "string" ? f.manifest.repo : null), tag: f.tag, commit: f.commit,
    version: String(f.manifest.version ?? ""), hash: digestOf(target).content, installed: today() }
  writeLock(vault, f.id, entry)
  return entry
}

export function unlock(vault: Vault, id: string) {
  if (readLock(vault)[id]) writeLock(vault, id, null)
}

/** What a newer version would change: its files (added, removed, edited) and what it says it does beyond the vault. */
export function diff(installed: string, next: string, was: Item, now: Item) {
  const a = digestOf(installed).files, b = digestOf(next).files
  const files = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((f) => a[f] !== b[f]).sort()
    .map((f) => `${f in a ? (f in b ? "changed" : "removed") : "added"} ${f}`)
  const d0 = disclosuresOf(was), d1 = disclosuresOf(now)
  const disclosures: string[] = []
  const hosts0 = d0.network ?? [], hosts1 = d1.network ?? []
  const host = (h: string) => (h === "*" ? "any host you set in its settings" : h)
  for (const h of hosts1) if (!hosts0.includes(h)) disclosures.push(`now talks to ${host(h)}`)
  for (const h of hosts0) if (!hosts1.includes(h)) disclosures.push(`no longer talks to ${host(h)}`)
  for (const k of ["shell", "outsideVault", "clipboard"] as const) if (!!d0[k] !== !!d1[k]) disclosures.push(`${d1[k] ? "now" : "no longer"} ${DISCLOSURES[k]}`)
  return { files, disclosures }
}

/** An installed plugin's newer version, if there may be one: by tag (a newer version tag), by commit for one installed
 *  without tags, or a folder's files as they are now. Null when it's up to date. */
export async function newer(l: Locked): Promise<{ tag: string | null; commit: string | null } | null> {
  const src = parseSource(l.source)
  if (src.folder) return { tag: null, commit: null } // (a folder on this machine: what's there now is looked at)
  if (src.archive) return null // (a zip pinned by its hash is one version: a newer one is installed from its own address)
  if (!src.url) return null
  if (l.tag) {
    const latest = (await tagsOf(src.url, src.dir))[0]
    return latest && compareVersions(tagVersion(latest), l.version)! > 0 ? { tag: latest, commit: null } : null
  }
  const head = await headOf(src.url)
  return head && head !== l.commit ? { tag: null, commit: head } : null
}
