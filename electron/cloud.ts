// Claude Code on the web's sessions (the Cloud sessions plugin), read and acted on with the Browser's claude.ai logins
// through claude.ai's JSON API (plugins/core/cloud-sessions/CLAUDE.md), and their pull requests through `gh`.
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import type { Session, WebContents } from "electron"
import { strings } from "../core/values.ts"
import type { AppWindow } from "./appwindow.ts"

/** A claude.ai organization whose sessions are read: `label` its name, or its login's email for a personal one
 *  ("<email>'s Organization"); `profiles` the logins it's in, in the order the app named them. */
export type CloudAccount = { id: string; label: string; profiles: string[] }
/** A pull request of a session's branch, as GitHub has it. */
export type CloudPr = { number: number; url: string; state: "open" | "draft" | "merged" | "closed" }
/** A session as claude.ai's sidebar has it: `state` its `session_status`, `account` its organization, `profile` the first
 *  logins it's in; `summary` where its last turn left it (its question, `outcome` input); `remote`: Remote Control's. */
export type CloudSession = {
  id: string; title: string; state: "running" | "waiting" | "idle"; updated: number; url: string; profile: string; account: string
  summary?: string; outcome?: "done" | "input" | "review"; unread?: boolean; created?: number
  repos?: { repo: string; branch?: string }[]; origin?: "web" | "cli" | "phone"; remote?: boolean; pr?: CloudPr
}
/** What the app tells: `signedIn`, some profile it named is signed in to claude.ai (known from its cookies, nothing
 *  asked); the accounts and their sessions only once the user said yes; `base`, claude.ai's address. */
export type CloudState = { signedIn: boolean; accounts: CloudAccount[]; sessions: CloudSession[]; base: string }
/** What the app asks for: the profiles to look in, whether they may be read (the user's yes), accounts not to read. */
type CloudWant = { profiles: string[]; read: boolean; hidden: string[] }

/** What it needs of the browser (web.ts): a profile's claude.ai page if one is open, its session, whether it was ever
 *  used, and telling a window. */
export type CloudHost = {
  page: (profile: string, site: string) => WebContents | undefined
  session: (profile: string) => Promise<Session>
  used: (profile: string) => boolean
  tell: (win: AppWindow, msg: Record<string, unknown>) => void
  profileOf: (x: unknown) => string
}

/** Asked of claude.ai with a profile's logins, no page needed. VAULTITE_TEST_CLAUDE_URL: web/qa/webwatch.mjs's stand-in. */
const BASE = process.env.VAULTITE_TEST_CLAUDE_URL || "https://claude.ai"
const TEST = !!process.env.VAULTITE_TEST_CLAUDE_URL
const hostOf = (u: string) => { try { return new URL(u).hostname } catch { return "" } }
const CLOUD = {
  orgs: `${BASE}/api/organizations`,
  // (what claude.ai's own sidebar lists: /v1/code/sessions no longer says whether one is working)
  list: `${BASE}/v1/sessions?limit=50`,
  one: (id: string) => `${BASE}/v1/sessions/${encodeURIComponent(id)}`,
  headers: (org: string) => ({ accept: "application/json", "anthropic-version": "2023-06-01", "anthropic-beta": "ccr-byoc-2025-07-29", "x-organization-uuid": org }),
  page: (id: string) => `${BASE}/code/${encodeURIComponent(id)}`,
  // (read again sooner while a session is working or waiting: its news comes sooner)
  busy: TEST ? 1500 : 5000,
  idle: TEST ? 1500 : 15_000,
  // (a profile's organizations, and whether it's signed in at all, change rarely)
  orgsFor: TEST ? 1500 : 600_000,
  cookiesFor: TEST ? 500 : 10_000,
  // (pull requests: asked of GitHub every few minutes, for sessions of the last two weeks)
  prsFor: TEST ? 1500 : 180_000,
}

export function cloudHandlers(host: CloudHost) {
  const site = siteOfHost(hostOf(BASE))
  let want: CloudWant = { profiles: [], read: false, hidden: [] }
  const wantOf = (x: unknown): CloudWant => {
    const w = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
    return { profiles: [...new Set(strings(w.profiles).filter((p) => p === "" || host.profileOf(p) === p))].slice(0, 50), read: w.read === true, hidden: strings(w.hidden) }
  }
  /** The windows that asked (`web:cloud`): they're told the state as it changes, and its news. */
  const windows = new Set<AppWindow>()
  /** Whether a profile is signed in to claude.ai, by its cookies, looked at lately. */
  const cookies = new Map<string, { at: number; in: boolean }>()
  /** A profile's claude.ai organizations (the ones with claude.ai's apps, not an API-only one), read lately. */
  const orgs = new Map<string, { at: number; orgs: { id: string; name: string }[] }>()
  /** Each account's sessions as last read, and when to read it next (later after a failure). */
  const lists = new Map<string, CloudSession[]>()
  const next = new Map<string, { at: number; wait: number }>()
  /** Accounts claude.ai turned away (no Claude Code in that organization): not listed, asked again in an hour. */
  const none = new Set<string>()
  /** Sessions archived here, left out until claude.ai's list says so too (a read already on its way has them). */
  const archived = new Map<string, number>()
  let accounts: CloudAccount[] = []
  let signedIn = false
  let timer: ReturnType<typeof setInterval> | undefined
  let reading = false

  /** `url` asked with a profile's logins: from one of its claude.ai pages when one is open (the site's own origin: what
   *  its pages ask is never turned away), else with the session's cookies from here, like accountOf. */
  async function ask(profile: string, url: string, headers: Record<string, string>, method = "GET", body?: unknown): Promise<{ status: number; json: unknown }> {
    const init = { method, credentials: "include", headers: body === undefined ? headers : { ...headers, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }
    const page = host.page(profile, site)
    if (page) return await page.executeJavaScriptInIsolatedWorld(1003, [{ code: `fetch(${JSON.stringify(url)}, ${JSON.stringify(init)}).then(async (r) => ({ status: r.status, json: r.ok ? await r.json().catch(() => null) : null }))` }])
    const r = await (await host.session(profile)).fetch(url, init as RequestInit)
    return { status: r.status, json: r.ok ? await r.json().catch(() => null) : null }
  }

  async function signedInTo(profile: string) {
    const had = cookies.get(profile)
    if (had && Date.now() - had.at < CLOUD.cookiesFor) return had.in
    // (logins never used have no folder: not made just to look, which would set up a session, extensions and all)
    if (!host.used(profile)) return false
    const all = await (await host.session(profile)).cookies.get({ url: BASE })
    const signed = all.some((c) => c.name.startsWith("sessionKey"))
    cookies.set(profile, { at: Date.now(), in: signed })
    return signed
  }

  /** Its organizations; [] signed out, or when they couldn't be had (asked again a minute later). */
  async function orgsOf(profile: string) {
    const had = orgs.get(profile)
    if (had && Date.now() < had.at) return had.orgs
    let list: { id: string; name: string }[] = [], wait = CLOUD.orgsFor
    try {
      const r = await ask(profile, CLOUD.orgs, { accept: "application/json" })
      if (!Array.isArray(r.json)) throw new Error(String(r.status))
      list = (r.json as Record<string, unknown>[]).flatMap((o) => typeof o?.uuid === "string" && Array.isArray(o.capabilities) && o.capabilities.includes("chat")
        ? [{ id: o.uuid, name: typeof o.name === "string" ? o.name : "" }] : [])
    } catch { wait = 60_000 }
    orgs.set(profile, { at: Date.now() + wait, orgs: list })
    return list
  }

  /** An account's sessions, read with `profile`'s logins when they're due; null when they weren't read now. */
  async function readAccount(profile: string, account: string): Promise<CloudSession[] | null> {
    const due = next.get(account)
    if (due && Date.now() < due.at) return null
    let r: { status: number; json: unknown }
    try { r = await ask(profile, CLOUD.list, CLOUD.headers(account)) } catch { r = { status: 0, json: null } }
    if (r.status === 401 || r.status === 403 || r.status === 404) {
      // (signed out since: its organizations are asked again; turned away: none here)
      if (r.status === 401) orgs.delete(profile); else none.add(account)
      next.set(account, { at: Date.now() + (r.status === 401 ? 60_000 : 3_600_000), wait: CLOUD.idle })
      lists.delete(account)
      return null
    }
    const data = (r.json as { data?: unknown } | null)?.data
    if (!Array.isArray(data)) {
      // (a failure: asked again later and later, up to five minutes; the list stays as it was)
      const wait = Math.min(300_000, (due?.wait ?? CLOUD.idle) * 2)
      next.set(account, { at: Date.now() + wait, wait })
      return null
    }
    none.delete(account)
    const had = new Map((lists.get(account) ?? []).map((c) => [c.id, c]))
    const list = (data as Record<string, unknown>[]).flatMap((x): CloudSession[] => {
      if (typeof x?.id !== "string") return []
      if (x.session_status === "archived") { archived.delete(x.id); return [] }
      if ((archived.get(x.id) ?? 0) > Date.now() - 60_000) return []
      const s = sessionOf(x, profile, account)
      // (its pull request stays till GitHub is asked again)
      const pr = had.get(s.id)?.pr
      return [pr && s.repos?.length ? { ...s, pr } : s]
    })
    const wait = list.some((c) => c.state !== "idle") ? CLOUD.busy : CLOUD.idle
    next.set(account, { at: Date.now() + wait, wait })
    return list
  }

  /** Every account's sessions, most recent first. */
  const state = (): CloudState => ({
    signedIn, accounts, base: BASE,
    sessions: [...lists.values()].flat().sort((a, b) => b.updated - a.updated),
  })
  const tellAll = (before: string) => {
    const after = state()
    if (JSON.stringify(after) !== before) for (const w of windows) host.tell(w, { type: "cloud", ...after })
  }

  const news = (s: CloudSession, kind: "done" | "waiting", title: string) => {
    const body = s.summary ? `${s.title}: ${s.summary}` : s.title
    for (const w of windows) host.tell(w, { type: "session", id: 0, profile: s.profile, site, url: s.url, kind, title, body: body.slice(0, 280) })
  }

  /** Each named profile signed in to claude.ai, each of its organizations once (in the first profile that has it), each
   *  account's sessions when due, with news of what changed; the windows told when anything did. */
  async function read() {
    for (const w of windows) if (w.isDestroyed()) windows.delete(w)
    if (!windows.size) { clearInterval(timer); timer = undefined; return }
    if (reading) return
    reading = true
    try {
      const before = JSON.stringify(state())
      const w = want, hidden = new Set(w.hidden)
      const seen = new Map<string, CloudAccount>()
      let signed = false
      for (const profile of w.profiles) {
        if (!(await signedInTo(profile))) continue
        signed = true
        if (!w.read) continue
        for (const o of await orgsOf(profile)) {
          const had = seen.get(o.id)
          if (had) { had.profiles.push(profile); continue }
          const account = { id: o.id, label: labelOf(o.name), profiles: [profile] }
          seen.set(o.id, account)
          if (hidden.has(account.label)) continue
          const was = lists.get(o.id)
          const list = await readAccount(profile, o.id)
          if (!list) continue
          lists.set(o.id, list)
          // (an account's first read is where things stand, not news; a running session that left the list is done)
          if (!was) continue
          const now = new Map(list.map((c) => [c.id, c]))
          for (const c of was) {
            const n = now.get(c.id), said = newsOf(c, n)
            if (said) news(n ?? c, said.kind, said.title)
          }
          for (const n of list) if (n.state === "waiting" && !was.some((c) => c.id === n.id)) news(n, "waiting", "Claude Code needs you")
        }
      }
      // (hidden, turned away or gone: their sessions go, and a hidden one shows again from a fresh read)
      for (const id of [...lists.keys()]) if (!seen.has(id) || hidden.has(seen.get(id)!.label) || none.has(id)) { lists.delete(id); next.delete(id) }
      accounts = [...seen.values()].filter((a) => !none.has(a.id))
      signedIn = signed
      await prs()
      tellAll(before)
    } finally { reading = false }
  }

  // ---------- pull requests, asked of GitHub with `gh` (the user's own login there), when it's installed

  const gh = process.env.VAULTITE_TEST_GH || (TEST ? "" : ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh",
    ...(process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, "gh"))].find((p) => { try { return fs.statSync(p).isFile() } catch { return false } }) ?? "")
  /** Each "<repo> <branch>"'s pull request as GitHub last said (null: none), and when it was asked. */
  const prsKnown = new Map<string, { at: number; pr: CloudPr | null }>()
  let prsAt = 0
  async function prs() {
    if (!gh || Date.now() - prsAt < CLOUD.prsFor) return
    prsAt = Date.now()
    const recent = [...lists.values()].flat().filter((c) => Date.now() - c.updated < 14 * 86_400_000)
    const refs = [...new Set(recent.flatMap((c) => branchOf(c) ? [branchOf(c)!] : []))].slice(0, 40)
    if (refs.length) {
      const got = await askGitHub(gh, refs.map((k) => k.split(" ") as [string, string]))
      if (got) for (const k of refs) prsKnown.set(k, { at: Date.now(), pr: got.get(k) ?? null })
    }
    for (const [id, list] of lists) lists.set(id, list.map((c) => {
      const k = branchOf(c), pr = k ? prsKnown.get(k)?.pr ?? undefined : undefined
      return pr === c.pr || (pr && c.pr && JSON.stringify(pr) === JSON.stringify(c.pr)) ? c : { ...c, pr }
    }))
  }

  // ---------- what's done to a session: archived (and back, for Undo) or renamed

  const accountFor = (id: string) => [...lists.entries()].find(([, l]) => l.some((c) => c.id === id))
  async function act(action: unknown, id: unknown, value: unknown) {
    const sid = typeof id === "string" && /^session_\w{1,80}$/.test(id) ? id : ""
    if (!sid) throw new Error("no such session")
    const at = accountFor(sid)
    const org = at?.[0] ?? (typeof value === "object" && value && typeof (value as { account?: unknown }).account === "string" ? (value as { account: string }).account : "")
    const acct = accounts.find((a) => a.id === org)
    if (!acct) throw new Error("that session's account isn't read here")
    const before = JSON.stringify(state())
    const r = action === "archive" || action === "unarchive"
      ? await ask(acct.profiles[0], `${CLOUD.one(sid)}/${action}`, CLOUD.headers(org), "POST", {})
      : action === "rename" && typeof value === "string" && value.trim()
        ? await ask(acct.profiles[0], CLOUD.one(sid), CLOUD.headers(org), "PATCH", { title: value.trim().slice(0, 200) })
        : null
    if (!r) throw new Error("not something done to a session")
    if (r.status < 200 || r.status >= 300) throw new Error(r.status === 401 || r.status === 403 ? "claude.ai refused it: sign in to claude.ai again" : `claude.ai answered ${r.status}`)
    const list = lists.get(org) ?? []
    if (action === "archive") { archived.set(sid, Date.now()); lists.set(org, list.filter((c) => c.id !== sid)) }
    else if (action === "unarchive") {
      archived.delete(sid)
      const s = r.json && typeof r.json === "object" ? sessionOf(r.json as Record<string, unknown>, acct.profiles[0], org) : null
      if (s && !list.some((c) => c.id === sid)) lists.set(org, [...list, s])
    } else lists.set(org, list.map((c) => (c.id === sid ? { ...c, title: String(value).trim().slice(0, 200) } : c)))
    // (read again soon: claude.ai's own word on it)
    next.set(org, { at: Date.now() + 1000, wait: CLOUD.idle })
    tellAll(before)
    return { ok: true }
  }

  return {
    // Claude Code on the web's sessions in the profiles the app names: the window is told them from now on, as they
    // change (`cloud`) and their news. Asked again with what changed (a workspace, the user's yes, an account hidden).
    "web:cloud": (win: AppWindow, w: unknown) => {
      windows.add(win)
      want = wantOf(w)
      if (!timer) timer = setInterval(() => void read(), 1000)
      void read()
      return state()
    },
    // A session archived, back from the archive, or renamed, on claude.ai.
    "web:cloud-act": (_win: AppWindow, action: unknown, id: unknown, value: unknown) => act(action, id, value),
  }
}

/** "chat.example.co.uk" → "example.co.uk" (as web.ts' siteOf, for claude.ai and its stand-in). */
function siteOfHost(host: string) {
  const h = host.toLowerCase()
  if (!h || /^[\d.]+$/.test(h) || !h.includes(".")) return h
  return h.split(".").slice(/\.(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/.test(h) ? -3 : -2).join(".")
}
const labelOf = (name: string) => name.replace(/'s Organization$/, "").trim() || "Claude"
const text = (v: unknown, n = 200) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, n) : undefined)
const REPO = /^[\w.-]{1,100}\/[\w.-]{1,100}$/
const BRANCH = /^[\w./-]{1,200}$/

/** A session as claude.ai's list has it, in ours. */
function sessionOf(x: Record<string, unknown>, profile: string, account: string): CloudSession {
  const at = Date.parse(String(x.updated_at ?? "")), made = Date.parse(String(x.created_at ?? ""))
  const sum = (x.post_turn_summary ?? (x.external_metadata as Record<string, unknown> | undefined)?.post_turn_summary) as Record<string, unknown> | undefined
  const cat = sum?.status_category, ctx = (x.session_context ?? {}) as Record<string, unknown>
  const repos: { repo: string; branch?: string }[] = []
  for (const o of Array.isArray(ctx.outcomes) ? ctx.outcomes as Record<string, unknown>[] : []) {
    const g = o?.git_info as Record<string, unknown> | undefined, repo = typeof g?.repo === "string" ? g.repo : ""
    const branch = Array.isArray(g?.branches) && typeof g.branches[0] === "string" && BRANCH.test(g.branches[0]) ? g.branches[0] : undefined
    if (REPO.test(repo) && !repos.some((r) => r.repo === repo)) repos.push({ repo, ...(branch ? { branch } : {}) })
  }
  for (const s of Array.isArray(ctx.sources) ? ctx.sources as Record<string, unknown>[] : []) {
    const repo = /github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(String(s?.url ?? ""))?.[1] ?? ""
    if (REPO.test(repo) && !repos.some((r) => r.repo === repo)) repos.push({ repo })
  }
  const origin = x.origin === "web_claude_ai" ? "web" : x.origin === "claude_code_cli" ? "cli" : x.origin === "ios" || x.origin === "android" ? "phone" : undefined
  const summary = text(cat === "need_input" ? sum?.needs_action || sum?.status_detail : sum?.status_detail || sum?.recent_action, 280)
  return {
    id: String(x.id), title: text(x.title) ?? "Claude Code session",
    state: x.session_status === "running" ? "running" : x.session_status === "requires_action" ? "waiting" : "idle",
    updated: Number.isFinite(at) ? at : 0, url: CLOUD.page(String(x.id)), profile, account,
    ...(summary ? { summary } : {}),
    ...(cat === "completed" ? { outcome: "done" as const } : cat === "need_input" ? { outcome: "input" as const } : cat === "review_ready" ? { outcome: "review" as const } : {}),
    ...(x.unread === true ? { unread: true } : {}),
    ...(Number.isFinite(made) ? { created: made } : {}),
    ...(repos.length ? { repos } : {}),
    ...(origin ? { origin } : {}),
    ...(x.environment_kind === "bridge" ? { remote: true } : {}),
  }
}

/** What a session going from one state to another is worth telling, if anything: done, or needing you (a question it
 *  ended its turn on is that too). */
function newsOf(was: CloudSession, now: CloudSession | undefined): { kind: "done" | "waiting"; title: string } | null {
  const to = now?.state ?? "idle"
  if (was.state === to) return null
  if (to === "waiting" || (was.state === "running" && now?.outcome === "input")) return { kind: "waiting", title: "Claude Code needs you" }
  if (was.state === "running") return { kind: "done", title: "Claude Code finished" }
  return null
}

/** The "<repo> <branch>" a session's pull request would be from: its first repository's branch, not a default one. */
function branchOf(c: CloudSession) {
  const r = c.repos?.find((x) => x.branch && !/^(main|master|trunk|develop)$/.test(x.branch))
  return r ? `${r.repo} ${r.branch}` : null
}

/** Each ref's newest pull request, in one GraphQL query; null when GitHub couldn't be asked (no login, offline). */
function askGitHub(gh: string, refs: [string, string][]): Promise<Map<string, CloudPr> | null> {
  const vars: string[] = [], parts: string[] = [], decl: string[] = []
  refs.forEach(([repo, branch], i) => {
    const [owner, name] = repo.split("/")
    decl.push(`$o${i}: String!, $n${i}: String!, $b${i}: String!`)
    parts.push(`r${i}: repository(owner: $o${i}, name: $n${i}) { pullRequests(headRefName: $b${i}, first: 1, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { number url state isDraft } } }`)
    vars.push("-f", `o${i}=${owner}`, "-f", `n${i}=${name}`, "-f", `b${i}=${branch}`)
  })
  const query = `query(${decl.join(", ")}) { ${parts.join(" ")} }`
  return new Promise((done) => execFile(gh, ["api", "graphql", "-f", `query=${query}`, ...vars], { timeout: 20_000, maxBuffer: 4 << 20 }, (_e, out) => {
    // (a repository it can't see answers null among the rest: the others still count)
    let data: Record<string, { pullRequests?: { nodes?: Record<string, unknown>[] } } | null>
    try { data = JSON.parse(out).data } catch { return done(null) }
    if (!data || typeof data !== "object") return done(null)
    const got = new Map<string, CloudPr>()
    refs.forEach(([repo, branch], i) => {
      const n = data[`r${i}`]?.pullRequests?.nodes?.[0]
      if (!n || typeof n.number !== "number" || typeof n.url !== "string" || !/^https:\/\//.test(n.url)) return
      const state = n.state === "MERGED" ? "merged" : n.state === "CLOSED" ? "closed" : n.isDraft ? "draft" : "open"
      got.set(`${repo} ${branch}`, { number: n.number, url: n.url, state })
    })
    done(got)
  }))
}
