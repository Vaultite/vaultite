// The desktop app's updates as one machine, updates.ts its runner. No Electron: tools/test_update.ts runs it.
import { sentence } from "../core/plainerror.ts"

export type How = "install" | "release" | "relaunch" | "worktree"
export type Via = "build" | "store" | "release"

type Look =
  | { kind: "idle" }
  | { kind: "pinning"; byHand: boolean }
  | { kind: "building"; byHand: boolean; want: string; to: string | null }
  | { kind: "store"; byHand: boolean }
  | { kind: "release"; byHand: boolean; downloading: string | null }

type Restart =
  | { kind: "offered" }
  | { kind: "waiting"; on: string }
  | { kind: "staging"; byHand: boolean }
  | { kind: "restarting" }

export type Offer = { commit: string; how: How; behind: string | null; restart: Restart }
export type Updates = { look: Look; offer: Offer | null }
export const START: Updates = { look: { kind: "idle" }, offer: null }

export type ReleaseOutcome = { kind: "current" } | { kind: "downloaded" } | { kind: "failed"; why: string }

export type UpdateEvent =
  | { type: "check"; byHand: boolean; via: Via | null; off: boolean; recent: boolean }
  | { type: "pinned"; want: string }
  | { type: "pin-failed" }
  | { type: "building"; commit: string }
  | { type: "built"; code: number | null; out: string; built: string | null; quitting: boolean }
  | { type: "looked"; state: string | null; why: string; quitting: boolean }
  | { type: "release-found"; version: string }
  | { type: "release-looked"; outcome: ReleaseOutcome; quitting: boolean }
  | { type: "offered"; commit: string; how: How; again?: boolean; behind?: string | null }
  | { type: "changed"; what: string }
  | { type: "weighed"; auto: boolean; why: string | null }
  | { type: "restart"; byHand: boolean; built: string | null; replaceable: boolean; releases: boolean }
  | { type: "staged"; ok: boolean }
  | { type: "quit"; off: boolean; updatable: boolean; built: string | null; replaceable: boolean }
  | { type: "mode-changed"; off: boolean }

export type Current = { via: "build"; pinned: boolean } | { via: "store"; why: string } | { via: "release" }
export type Leave = "relaunch" | "relaunch-soon" | "release" | "quit"

export type Effect =
  | { kind: "tell" | "menu" | "status" | "weigh" | "arm" | "disarm" | "check" | "pin" | "stop-build" | "store-look" | "release-look" | "restart" | "hand-over" | "begin-quit" | "unnote" }
  | { kind: "build"; byHand: boolean; want: string }
  | { kind: "stage"; commit: string; reopen: boolean }
  | { kind: "note"; to: string }
  | { kind: "leave"; then: Leave }
  | { kind: "current"; current: Current }
  | { kind: "failed"; why: string }

type Step = { to: Updates; do: Effect[]; ignored?: true }

export const AWAY_S = 10 * 60

export function restartWaitsOn(s: { othersOpen: boolean; pages: number; safe: number; idle: number; busy: string | null }): string | null {
  if (s.othersOpen) return "another machine's window is open"
  if (!s.pages) return "no window is open"
  if (s.safe < s.pages) return "a window would lose something (unsaved, under way, or in use)"
  if (s.idle < AWAY_S) return "the user is at the computer"
  return s.busy
}

const going = (o: Offer | null) => o?.restart.kind === "staging" || o?.restart.kind === "restarting"
const looking = (l: Look) => l.kind === "building" || l.kind === "store" || l.kind === "release"
const short = (commit: string) => commit.slice(0, 7)
const when = (c: boolean, ...d: Effect[]) => (c ? d : [])

export function step(p: Updates, e: UpdateEvent): Step {
  const s = move(p, e)
  if (p.offer?.restart.kind === "waiting" && s.to.offer?.restart.kind !== "waiting") s.do.push({ kind: "disarm" })
  return s
}

function move(p: Updates, e: UpdateEvent): Step {
  const go = (to: Updates, ...d: Effect[]): Step => ({ to, do: d })
  const stay = () => go(p)
  const refuse = (): Step => ({ to: p, do: [], ignored: true })
  const look = (l: Look) => ({ ...p, look: l })
  switch (e.type) {
    case "check": {
      if ((!e.byHand && e.off) || !e.via) return stay()
      if (looking(p.look) || p.look.kind === "pinning" || going(p.offer)) return refuse()
      const status = when(e.byHand, { kind: "status" })
      if (e.via === "release") return go(look({ kind: "release", byHand: e.byHand, downloading: null }), { kind: "menu" }, ...status, { kind: "release-look" })
      if (e.via === "store") return go(look({ kind: "store", byHand: e.byHand }), ...status, { kind: "menu" }, { kind: "store-look" })
      if (!e.byHand && e.recent) return stay()
      return go(look({ kind: "pinning", byHand: e.byHand }), { kind: "pin" })
    }
    case "pinned": {
      if (p.look.kind !== "pinning") return refuse()
      const byHand = p.look.byHand
      return go(look({ kind: "building", byHand, want: e.want, to: null }), ...when(byHand, { kind: "status" }),
        { kind: "build", byHand, want: e.want }, { kind: "menu" })
    }
    case "pin-failed":
      return p.look.kind === "pinning" ? go(look({ kind: "idle" })) : refuse()
    case "building":
      if (p.look.kind !== "building") return refuse()
      return go(look({ ...p.look, to: e.commit }), { kind: "status" })
    case "built": {
      if (p.look.kind !== "building") return refuse()
      const { byHand, want } = p.look
      let s = go(look({ kind: "idle" }), { kind: "status" })
      const last = e.out.trim().split("\n").pop()?.trim() ?? ""
      if (e.code === 0 && last === e.built) { const o = offered(s.to, last, "install", byHand); s = { to: o.to, do: [...s.do, ...o.do] } }
      else if (byHand && e.code === 3) s.do.push({ kind: "current", current: { via: "build", pinned: !!want } })
      else if (byHand && !e.quitting && !going(s.to.offer)) s.do.push({ kind: "failed", why: buildFailure(e.out) })
      if (s.to.offer && s.to.offer.commit !== e.built && !going(s.to.offer)) s = { ...s, to: { ...s.to, offer: null } }
      s.do.push({ kind: "menu" })
      return s
    }
    case "looked": {
      if (p.look.kind !== "store") return refuse()
      const byHand = p.look.byHand, d: Effect[] = []
      if (byHand && e.state === "current" && !p.offer) d.push({ kind: "current", current: { via: "store", why: e.why } })
      else if (byHand && e.state === "failed" && !e.quitting) d.push({ kind: "failed", why: sentence(e.why) })
      return go(look({ kind: "idle" }), ...d, ...when(byHand, { kind: "status" }), { kind: "menu" })
    }
    case "release-found":
      if (p.look.kind !== "release") return refuse()
      return go(look({ ...p.look, downloading: e.version }), { kind: "status" })
    case "release-looked": {
      if (p.look.kind !== "release") return refuse()
      const byHand = p.look.byHand, d: Effect[] = []
      if (byHand && e.outcome.kind === "current") d.push({ kind: "current", current: { via: "release" } })
      else if (byHand && e.outcome.kind === "failed" && !e.quitting) d.push({ kind: "failed", why: e.outcome.why })
      return go(look({ kind: "idle" }), ...d, { kind: "status" }, { kind: "menu" })
    }
    case "offered":
      return offered(p, e.commit, e.how, e.again ?? false, e.behind)
    case "changed":
      if (going(p.offer)) return refuse()
      if (p.offer?.commit === e.what) return stay()
      return go({ ...p, offer: { commit: e.what, how: "worktree", behind: null, restart: p.offer?.restart ?? { kind: "offered" } } }, { kind: "tell" }, { kind: "menu" })
    case "weighed": {
      const o = p.offer
      if (!o || going(o)) return stay()
      if (!e.auto) return o.restart.kind === "offered" ? stay() : go({ ...p, offer: { ...o, restart: { kind: "offered" } } })
      if (e.why === null) return go(p, { kind: "restart" })
      return go({ ...p, offer: { ...o, restart: { kind: "waiting", on: e.why } } }, { kind: "arm" })
    }
    case "restart": {
      const o = p.offer
      if (!o || going(o)) return refuse()
      const to = (r: Restart): Updates => ({ ...p, offer: { ...o, restart: r } })
      const restarting = to({ kind: "restarting" })
      if (o.how === "worktree") return go(restarting, { kind: "hand-over" }, { kind: "begin-quit" }, { kind: "status" }, { kind: "leave", then: "relaunch" })
      if (o.how === "relaunch") return go(restarting, { kind: "hand-over" }, { kind: "begin-quit" }, { kind: "note", to: short(o.commit) }, { kind: "status" }, { kind: "leave", then: "relaunch-soon" })
      if (o.how === "release") {
        if (!e.releases) return refuse()
        return go(restarting, { kind: "begin-quit" }, { kind: "note", to: o.commit }, { kind: "status" }, { kind: "leave", then: "release" })
      }
      if (e.built !== o.commit || !e.replaceable) return refuse()
      return go(to({ kind: "staging", byHand: e.byHand }), { kind: "stop-build" }, { kind: "stage", commit: o.commit, reopen: true }, { kind: "note", to: short(o.commit) }, { kind: "status" })
    }
    case "staged": {
      const o = p.offer
      if (o?.restart.kind !== "staging") return refuse()
      if (e.ok) return go({ ...p, offer: { ...o, restart: { kind: "restarting" } } }, { kind: "leave", then: "quit" })
      return go({ ...p, offer: null }, { kind: "unnote" }, { kind: "status" }, { kind: "menu" },
        ...when(o.restart.byHand, { kind: "failed", why: "The new version couldn't be put in place (update.log says why)." }))
    }
    case "quit": {
      const o = p.offer, d: Effect[] = [{ kind: "stop-build" }]
      if (!o || going(o) || o.how !== "install" || e.off || !e.updatable || e.built !== o.commit || !e.replaceable) return go(p, ...d)
      return go({ ...p, offer: { ...o, restart: { kind: "restarting" } } }, ...d, { kind: "stage", commit: o.commit, reopen: false })
    }
    case "mode-changed":
      return go(p, { kind: "tell" }, ...when(!e.off && !p.offer, { kind: "check" }))
  }
}

function offered(p: Updates, commit: string, how: How, again: boolean, behind?: string | null): Step {
  if (going(p.offer)) return { to: p, do: [], ignored: true }
  const was = p.offer, kept = behind !== undefined ? behind : was?.behind ?? null
  if (!again && was?.commit === commit && was.how === how) return { to: { ...p, offer: { ...was, behind: kept } }, do: [] }
  return { to: { ...p, offer: { commit, how, behind: kept, restart: was?.restart ?? { kind: "offered" } } }, do: [{ kind: "tell" }, { kind: "menu" }, { kind: "weigh" }] }
}

export function statusOf(s: Updates, name: string): { text: string; restart: boolean } | null {
  if (going(s.offer)) return { text: "Restarting to update…", restart: true }
  const l = s.look, text = l.kind === "building" ? (l.to ? `Updating ${name} to ${short(l.to)}…` : l.byHand ? "Checking for updates…" : null)
    : l.kind === "release" ? (l.downloading ? `Downloading ${name} ${l.downloading}…` : l.byHand ? "Checking for updates…" : null)
    : l.kind === "store" && l.byHand ? "Checking for updates…" : null
  return text ? { text, restart: false } : null
}

export function offerMessage(o: Offer, name: string, auto: boolean) {
  if (o.how === "worktree") return { type: "update", text: `${o.commit}: relaunch to run them`, label: "Relaunch" }
  if (o.how === "relaunch") return { type: "update", text: `${name} ${short(o.commit)} is ready: relaunching takes a couple of seconds${auto ? ", and it does so while you're away" : ""}`, label: "Relaunch", auto }
  return { type: "update", name, version: o.how === "release" ? o.commit : short(o.commit), auto }
}

export function menuItem(s: Updates, o: { worktree: boolean; updatable: boolean }): { label: string; enabled?: boolean; act: "restart" | "check" } | null {
  if (o.worktree) return s.offer ? { label: "Relaunch to run your changes", act: "restart" } : null
  if (!o.updatable) return null
  if (s.offer) return { label: s.offer.how === "relaunch" ? "Relaunch to update" : "Restart to update", act: "restart" }
  const busy = looking(s.look)
  return { label: busy ? "Checking for updates…" : "Check for updates…", enabled: !busy, act: "check" }
}

export function buildFailure(out: string): string {
  if (/^boot: \d+ failed/m.test(out)) return "The new version didn't pass its startup check."
  if (/no code signing identity in the keychain: not building/.test(out)) return "This Mac has no code signing identity, and an update signed without one would sign you out of every site: add one (a self-signed code signing certificate will do)."
  if (/not building an update signed ad hoc/.test(out)) return "The new version couldn't be signed: the keychain may be locked. The next check tries again."
  if (/from before cookie encryption/.test(out)) return "Its server runs a version from before cookie encryption, which would sign you out of every site: update the server first."
  return "The new version didn't build."
}

export function describe(s: Updates): string {
  const { look: l, offer: o } = s, by = "byHand" in l && l.byHand ? " by hand" : ""
  const to = l.kind === "building" ? l.to : l.kind === "release" ? l.downloading : null
  const r = o?.restart.kind === "waiting" ? `waits: ${o.restart.on}` : o?.restart.kind
  return `${l.kind}${by}${to ? ` ${to.slice(0, 7)}` : ""}${o ? `, ${o.how} ${o.how === "worktree" ? o.commit : short(o.commit)} ${r}` : ""}`
}
