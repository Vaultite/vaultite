import fs from "node:fs"
import { z } from "zod"
import os from "node:os"
import path from "node:path"
import { type Machine, OpError, type Plugin, ROOT } from "../../../core/plugins.ts"
import { type Handoff, type Where, str } from "./jobs.ts"
import { cap, type Machines } from "./jobmachines.ts"
import type { workerLinks } from "./links.ts"
import { CLOUD, cloudIn, lacks, type Needs, type Ranked, RepoRules, rulesIn, rulesNeed, RULES_FILE, type Traits } from "./placement.ts"
import type { JobAsk } from "./types.ts"
import { APP_REPO, appUiOf, branchOf, checkoutNamed, checkoutsLine, type Found, fileAt, githubOf, headOf, jobBase, machineOfUrl, onlyHere, type Over, refusal, repoOf, resolveHere, rootsLine, sitesIn, tilde, unpushed, urlsIn, watched } from "./where.ts"

export const sameDir = (a: string, b: string) => { try { return fs.realpathSync(a) === fs.realpathSync(b) } catch { return false } }
export const sameRepo = (at: { cwd: string; repo: string }, repo: string) => {
  const name = repo.trim().replace(/\/+$/, "").replace(/\.git$/, "").split(/[/:]/).pop()!.toLowerCase()
  return !!name && (at.repo.toLowerCase() === name || path.basename(at.cwd).toLowerCase() === name)
}
export function namesRepo(text: string, repo: string) {
  const r = repo.trim().replace(/\/+$/, ""), name = r.split("/").pop()!, esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const word = "(?:repo|repository|checkout|codebase|project)"
  return (r.includes("/") && new RegExp(`(?<![\\w.-])${esc(r)}(?![\\w-])`, "i").test(text)) ||
    new RegExp(`(?<![\\w.-])${esc(name)}(?![\\w-])\\s+${word}\\b|\\b${word}\\s+(?:called\\s+|named\\s+)?${esc(name)}(?![\\w-])`, "i").test(text)
}
export function appAsk(o: Over, about: string) {
  if (about === "app") return "their ask is about Vaultite itself"
  const ui = about === "work" ? "" : appUiOf(o)
  return ui ? `asked over ${ui}` : ""
}
export function siteOf(site: URL, repo: string) {
  const name = repo.trim().replace(/\/+$/, "").replace(/\.git$/, "").split(/[/:]/).pop()!.toLowerCase()
  return name.length > 2 && site.hostname.toLowerCase().split(".").some((l) => l === name || l.replace(/-/g, "") === name.replace(/-/g, ""))
}
type Base = { words: string; agent: Pick<Needs, "agent" | "account"> }
const ruled = (t: Traits, far: Placed, base: Base) => lacks(t, { has: [...(far.repo ? [] : ["vault" as const]), ...rulesNeed(far.rules ?? [], base.words)] })
type Asker = { ranking: Machines["ranking"]; atMachine: ReturnType<typeof workerLinks>["atMachine"] }
async function siteElsewhere(site: URL, base: Base, { ranking, atMachine }: Asker) {
  for (const { t, why } of (await ranking({ has: [], ...base.agent })).ranked.filter((x) => !x.t.self && !x.t.cloud)) {
    const far = await atMachine(t.id, "companion.where", { url: site.href }, 6).then((r) => Placed.parse(r)).catch(() => null)
    if (!far || far.from !== "site" || !far.repo || far.refused || ruled(t, far, base)) continue
    return { machine: t.id, label: t.label, cwd: far.cwd, repo: far.repo, why: `${far.why}, on ${t.label}${why ? ` (${why})` : ""}`, from: far.from, base: far.base, live: !!far.live }
  }
  return null
}
type Routed = Omit<Where, "agent" | "account" | "harness" | "model" | "effort"> & { from?: Found["from"] }
async function siteOrNamed(o: { site?: URL; said: string; repo: string; page: Found; base: Base } & Asker, named: () => Promise<Routed>): Promise<Routed> {
  const here = o.page.why.replace(/: the vault.*$/, ""), site = namesRepo(o.said, o.repo) ? undefined : o.site
  const far = site ? await siteElsewhere(site, o.base, o) : null
  if (far) return far
  if (site && siteOf(site, o.repo)) throw new OpError(`no machine has a checkout that deploys ${site.host} (${here}), and ${o.repo} is another repo: name the site's own repo (repo: its owner/name on GitHub), or its folder (cwd) if ${o.repo} does deploy it`, 404)
  const r = await named()
  return { ...r, why: `${r.why}, as the handoff named (${here})` }
}
export const pageWins = (page: { cwd: string; repo: string; from?: Found["from"] }, repo: string, text: string) =>
  !!page.from && page.from !== "vault" && !sameRepo(page, repo) && !namesRepo(text, repo)

export const Placed = z.object({ cwd: z.string(), why: z.string(), from: z.enum(["note", "github", "preview", "site", "editor", "vault"]).optional(), preview: z.string().optional(),
  repo: z.string(), base: z.string(), refused: z.string(), missing: z.boolean().optional(), looked: z.string().optional(), have: z.string().optional(),
  live: z.boolean().optional(), carried: z.boolean().optional(), rules: RepoRules.optional(), cloudOk: z.boolean().optional(), cloud: z.boolean().optional() })
export type Placed = z.output<typeof Placed> & Found

export function jobPlaces(plugin: Plugin, m: Machines, atMachine: ReturnType<typeof workerLinks>["atMachine"]) {
  const { machines, hostOf, labelOf, traitsOf, ranking, harnessOf, cloudAccount } = m
  const lines = (k: string) => { const v = plugin.settings()[k] ?? plugin.manifest.settings?.[k]?.default; return Array.isArray(v) ? v.map(String).filter((x) => x.trim()) : [] }

  async function placeHere(o: Over, cwd: string, repo = "", fresh = true): Promise<Placed> {
    const self = (await machines()).filter((m) => m.self).map((m) => hostOf(m.url)).filter(Boolean)
    const isDir = (d: string) => !!fs.statSync(d, { throwIfNoEntry: false })?.isDirectory()
    const asked = cwd.replace(/^~(?=$|\/)/, os.homedir())
    let found: Found
    if (cwd && isDir(asked)) found = { cwd: asked, why: "as asked" }
    else if (cwd || repo) {
      const own = checkoutNamed(repo || asked), what = repo || path.basename(asked)
      if (!own) return { cwd: cwd ? asked : what, why: cwd ? `no folder ${tilde(asked)}, nor a checkout of ${what}` : `no checkout of ${what}`, repo: "", base: "", refused: "", missing: true,
        looked: rootsLine(), have: checkoutsLine() }
      found = { cwd: own, why: cwd ? `${tilde(asked)} is ${tilde(own)} here` : `${repo} is ${tilde(own)} here` }
    } else found = await resolveHere(o, plugin.vault.path, self)
    const top = found.cwd === plugin.vault.path ? "" : await repoOf(found.cwd)
    const base = !top ? "" : fresh && !watched(found) ? await jobBase(top) : await headOf(top), json = base ? await fileAt(top, base, RULES_FILE) ?? "" : ""
    const at = top || found.cwd, rules = rulesIn(json)
    return { ...found, cwd: at, repo: top ? at.split("/").pop()! : "", base, refused: refusal(at, lines("jobs_never")) || refusal(found.cwd, lines("jobs_never")),
      ...(top && sameDir(top, ROOT) ? { live: true } : {}), ...(rules.length ? { rules } : {}), ...(cloudIn(json) ? { cloudOk: true } : {}) }
  }
  async function elsewhere(cwd: string, repo: string, here: Placed, base: Base): Promise<{ machine: string; there: Placed }> {
    const r = await ranking({ has: [], ...base.agent }), asked: string[] = []
    for (const { t, why } of r.ranked.filter((x) => !x.t.self && !x.t.cloud)) {
      const far = await atMachine(t.id, "companion.where", { ...(cwd ? { cwd } : {}), ...(repo ? { repo } : {}) }, 6).then((r) => Placed.parse(r)).catch(() => null)
      const no = !far ? "it doesn't answer" : far.missing ? "" : ruled(t, far, base)
      asked.push(`${t.label}${no ? ` (${no})` : ""}`)
      if (far && !far.missing && !no) return { machine: t.id, there: { ...far, why: `${far.why}, on ${t.label} (none on ${await labelOf("")}${why ? `; ${why}` : ""})` } }
    }
    throw new OpError(`${await missingLine(here, "")}${asked.length ? `, nor on ${asked.join(", ")}` : ""}. Leave cwd out (it runs where the ask was), or name the repo (repo: each machine finds its own checkout) with machine`, 404)
  }
  const missingLine = async (there: Placed, machine: string) => `on ${await labelOf(machine)}, ${there.why}${there.looked ? ` (looked in ${there.looked}; its checkouts: ${there.have || "none"})` : ""}`
  async function route(m: JobAsk | undefined, p: Handoff): Promise<Omit<Where, "agent" | "account" | "harness" | "model" | "effort">> {
    const { from: _, ...r } = await routed(m, p)
    return r
  }
  async function routed(m: JobAsk | undefined, p: Handoff): Promise<Omit<Where, "agent" | "account" | "harness" | "model" | "effort"> & { from?: Found["from"] }> {
    const o: Over = m ? { url: m.url, app: m.app, title: m.title, path: m.path, screen: m.screen, under: m.under, ui: m.ui, chrome: m.chrome } : {}
    const own = !str(p.repo).trim() && !str(p.cwd) ? appAsk(o, str(p.about)) : ""
    if (own) {
      const r = await routed(m, { ...p, repo: APP_REPO, page: true }).catch((e) => e instanceof OpError && e.status === 404 ? e.message : Promise.reject(e))
      if (typeof r !== "string") return { ...r, why: `${own}: ${r.why}` }
      const at = await routed(m, { ...p, about: "work" })
      return { ...at, why: `${own}, but ${r.replace(/\. Leave cwd out.*$/, "")}: ${at.why}` }
    }
    let machine = str(p.machine).trim()
    if (machine && (await plugin.ask<Machine | null>("machines:machine", null, machine))?.self) machine = ""
    const repo = str(p.repo).trim(), asked = !!machine || !!str(p.cwd) || !!repo
    if (repo && !p.page && str(p.about) !== "app" && !machine && !str(p.cwd) && !o.path && (urlsIn(o).length || sitesIn(o).length)) {
      const page = await routed(m, { ...p, repo: "" }).catch(() => null)
      if (page && pageWins(page, repo, m?.text ?? ""))
        return { ...page, why: `${page.why} (not ${repo}, which the handoff named: their words don't)` }
      if (page?.from === "vault") return await siteOrNamed({ site: sitesIn(o)[0], said: str(m?.text), repo, page, base: baseOf(m, p), ranking, atMachine }, () => routed(m, { ...p, page: true }))
    }
    if (!asked) {
      const hosts = Object.fromEntries((await machines()).filter((x) => !x.self && x.online).map((x) => [x.id, hostOf(x.url)]).filter(([, h]) => h))
      machine = machineOfUrl(o, hosts)?.machine ?? ""
    }
    if (machine === CLOUD && !(await plugin.ask<Machine | null>("machines:machine", null, CLOUD))) {
      const here = await placeHere(o, str(p.cwd), repo)
      if (here.missing) throw new OpError(await missingLine(here, ""), 404)
      const cloud = (await traitsOf()).find((t) => t.cloud)
      const no = !cloud ? "jobs_cloud names no Claude Code account to start it" : lacks(cloud, { has: rulesNeed(here.rules ?? [], baseOf(m, p).words), repo: await githubOf(here.cwd) || here.repo, ...(here.cloudOk ? { cloud: true } : {}) })
      const got = no ? `the cloud ${no}` : await inCloud(here, "as asked")
      if (typeof got === "string") throw new OpError(`it can't run in the cloud: ${got}`, 409)
      if (got.there.refused) throw new OpError(`it can't run there: ${got.there.refused}`, 403)
      return { machine: "", label: "Cloud", cwd: got.there.cwd, repo: got.there.repo, why: got.there.why, cloud: true, ...(got.there.base ? { base: got.there.base } : {}), ...(got.there.live ? { live: true } : {}) }
    }
    let there = machine
      ? await atMachine(machine, "companion.where", { ...(str(p.cwd) ? { cwd: str(p.cwd) } : {}), ...(repo ? { repo } : {}), ...(o.url ? { url: o.url } : urlsIn(o)[0] ? { url: urlsIn(o)[0].href } : {}),
        ...(o.app ? { app: o.app } : {}), ...(o.title ? { title: o.title } : {}), ...(o.path ? { path: o.path } : {}) }).then((r) => Placed.parse(r))
      : await placeHere(o, str(p.cwd), repo)
    if (there.missing && machine) throw new OpError(await missingLine(there, machine), 404)
    const base = baseOf(m, p)
    if (there.missing) ({ machine, there } = await elsewhere(str(p.cwd), repo, there, base))
    let moved = ""
    if (!asked && !machine) ({ machine, there, moved } = await preferred(o, there, base))
    else if (repo && !machine && !str(p.cwd)) ({ machine, there } = await named(there, base))
    if (there.refused) throw new OpError(`it can't run there: ${there.refused}. Say so (where it would have run: ${tilde(there.cwd)})`, 403)
    return { machine, label: there.cloud ? "Cloud" : await labelOf(machine), cwd: there.cwd, repo: there.repo, why: there.why, ...(there.base ? { base: there.base } : {}), ...(there.preview ? { preview: there.preview } : {}),
      ...(there.cloud ? { cloud: true } : {}),
      ...(moved ? { moved } : {}), ...(there.live ? { live: true } : {}), ...(there.carried ? { carried: true } : {}), ...(there.from ? { from: there.from } : {}) }
  }
  const baseOf = (m: JobAsk | undefined, p: Handoff): Base => {
    const account = str(p.account).trim().toLowerCase()
    return { words: [str(p.task), m?.text ?? ""].join("\n"), agent: { agent: str(p.agent) || "claude", ...(account && account !== "default" ? { account } : {}) } }
  }
  async function inCloud(here: Placed, why: string, left: string | null = null): Promise<{ there: Placed; moved?: string } | string> {
    if (!(await githubOf(here.cwd))) return "its repo isn't on GitHub, so the cloud can't have it"
    const missing = left ?? await unpushed(here.cwd)
    if (missing) return `${missing} it starts from would be missing in the cloud`
    return { there: { ...here, cloud: true, why: `${here.why}, all pushed: in the cloud (${why || "a cloud session of its own"})` } }
  }
  async function placed(here: Placed, n: Needs, fits: (c: Ranked) => Promise<{ there: Placed; moved?: string } | string>, o: { cloud?: boolean } = {}): Promise<{ machine: string; there: Placed; moved: string }> {
    const r = await ranking(n), tried: string[] = []
    for (const c of r.ranked) {
      if (c.t.cloud && o.cloud === false) continue
      if (c.t.self) {
        const why = tried.length ? tried.join("; ") : r.ranked.length > 1 ? `${c.t.label}: ${c.why || "first in jobs_machine"}` : r.left.join("; ")
        return { machine: "", there: why ? { ...here, why: `${here.why} (${why}: here)` } : here, moved: "" }
      }
      const got = c.t.cloud ? await inCloud(here, c.why) : await fits(c)
      if (typeof got !== "string") return { machine: c.t.cloud ? "" : c.t.id, there: got.there, moved: got.moved ?? "" }
      tried.push(c.t.cloud ? `the cloud: ${got}` : got)
    }
    const why = [...tried, ...r.left].join("; ")
    return { machine: "", there: why ? { ...here, why: `${here.why} (${why}: here)` } : here, moved: "" }
  }
  async function named(here: Placed, base: Base): Promise<{ machine: string; there: Placed }> {
    if (here.refused) return { machine: "", there: here }
    const slug = await githubOf(here.cwd), left = slug ? await unpushed(here.cwd) : ""
    return placed(here, { has: rulesNeed(here.rules ?? [], base.words), repo: slug || here.repo, ...base.agent, ...(here.cloudOk ? { cloud: true } : {}) }, async ({ t, why }) => {
      if (!slug) return `its repo isn't on GitHub, so ${t.label} can't have it`
      if (left) return `${left} it starts from would be missing on ${t.label}`
      const far = await atMachine(t.id, "companion.where", { url: `https://github.com/${slug}` }, 6).then((r) => Placed.parse(r)).catch(() => null)
      if (!far || far.missing || !far.repo) return far ? `not checked out on ${t.label}` : `${t.label} doesn't answer`
      const no = ruled(t, far, base)
      if (no) return `${t.label} ${no}`
      return { there: { ...far, ...(here.base ? { base: here.base, carried: true } : {}), why: `${here.why}, all pushed: ${far.why}, on ${t.label}${why ? ` (${why})` : ""}` } }
    })
  }
  async function preferred(o: Over, here: Placed, base: Base): Promise<{ machine: string; there: Placed; moved: string }> {
    const local = watched(here)
    if (local && here.refused) return { machine: "", there: here, moved: "" }
    let gh = urlsIn(o).find((u) => u.hostname === "github.com")?.href ?? (here.from === "site" || here.from === "vault" ? sitesIn(o)[0]?.href : undefined)
    const slug = here.repo ? await githubOf(here.cwd) : "", left = local && slug ? await onlyHere(here.cwd) : ""
    if (local && slug) gh = `https://github.com/${slug}`
    const n: Needs = { has: [...(here.repo || gh ? [] : ["vault" as const]), ...rulesNeed(here.rules ?? [], base.words)], ...(here.repo ? { repo: slug || here.repo } : {}), ...base.agent,
      ...(here.repo && here.cloudOk ? { cloud: true } : {}) }
    return placed(here, n, async ({ t, why }) => {
      if (local && !slug) return `its repo isn't on GitHub, so ${t.label} can't have it`
      if (left) return `${left}, not yet pushed, would be lost on ${t.label}`
      const far = await atMachine(t.id, "companion.where", { ...(gh ? { url: gh } : {}), ...(o.path ? { path: o.path } : {}) }, 6).then((r) => Placed.parse(r)).catch(() => null)
      if (!far || (!far.repo && here.repo)) return far ? `not checked out on ${t.label}` : `${t.label} doesn't answer`
      const no = ruled(t, far, base)
      if (no) return `${t.label} ${no}`
      const on = `on ${t.label}${why ? ` (${why})` : ""}`
      if (!local) return { there: { ...far, why: `${far.why}, ${on}` } }
      const branch = await branchOf(here.cwd), at = [branch, here.base.slice(0, 7)].filter(Boolean).join(" at ")
      return { there: { ...far, ...(here.base ? { base: here.base } : {}), why: `${here.why}, all pushed: ${far.why}, ${on}, previewed there` },
        moved: `${here.preview ? `the preview ${here.preview}` : `${tilde(here.cwd)}, open in their editor`} on ${await labelOf("")}${at ? ` (${at})` : ""}` }
    }, { cloud: !local })
  }

  async function placedWith(w: Awaited<ReturnType<typeof route>>, p: Handoff): Promise<Where> {
    if (!w.cloud) return { ...w, ...await harnessOf(p) }
    const account = cloudAccount() || "default", agent = account === "default" ? "claude" : `claude_${account}`
    return { ...w, agent, account: account === "default" ? "" : cap(account), model: "", effort: "", harness: "Claude Code on the web" }
  }
  return { placeHere, route, placedWith }
}
