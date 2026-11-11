// The Agents panel's view menu, as Claude Code on the web's: group by, sort by, which kinds show (view.ts), and whose
// sessions notify (the Inbox's `muted`).
import { accountsOf, agentsOn, notifyError, openMenu, type AgentRun, type MenuItem } from "@vaultite"
import { GROUPS, inbox, settings, SORTS } from "./view"

const save = (p: Promise<void>) => void p.catch((e) => notifyError(e, "Couldn't save that"))

/** The panel's view menu, as Claude Code on the web's: group by, sort by, which kinds show, and whose sessions notify. */
export async function viewMenu(r: DOMRect, kinds: { kind: AgentRun["kind"]; label: string }[]) {
  const claude = agentsOn().find((a) => a.name === "claude")
  const [accounts] = await Promise.all([claude ? accountsOf(claude, "") : [], settings.ready(), inbox.ready()])
  const items = (): MenuItem[] => {
    const s = settings.get() ?? {}, group = s.group ?? "none", sort = s.sort ?? "status", hide = s.hide ?? []
    const muted = (inbox.get()?.muted ?? []).map((m) => m.toLowerCase())
    const isMuted = (a: { id: string; label: string }) => muted.includes(a.id.toLowerCase()) || muted.includes(a.label.toLowerCase())
    const mute = (a: { id: string; label: string }) => {
      const rest = (inbox.get()?.muted ?? []).filter((m) => m.toLowerCase() !== a.id.toLowerCase() && m.toLowerCase() !== a.label.toLowerCase())
      save(inbox.set({ muted: isMuted(a) ? (rest.length ? rest : null) : [...rest, a.label] }))
    }
    const out: MenuItem[] = [
      { label: "Group by", caption: true, run: () => {} },
      ...GROUPS.map((g) => ({ label: g.label, checked: g.id === group, run: () => save(settings.set({ group: g.id === "none" ? null : g.id })) })),
      { label: "Sort by", caption: true, sep: true, run: () => {} },
      ...SORTS.map((o) => ({ label: o.label, checked: o.id === sort, run: () => save(settings.set({ sort: o.id === "status" ? null : o.id })) })),
    ]
    const listed = kinds.filter((k) => kinds.length > 1 || hide.includes(k.kind))
    if (listed.length) {
      out.push({ label: "Show", caption: true, sep: true, run: () => {} },
        ...listed.map((k) => ({ label: k.label, checked: !hide.includes(k.kind), keep: true, run: () => {
          const next = hide.includes(k.kind) ? hide.filter((x) => x !== k.kind) : [...hide, k.kind]
          save(settings.set({ hide: next.length ? next : null }))
        } })))
    }
    // (only an agent with several accounts has any to tell apart; Claude Code's plugin says whose a session is)
    if (accounts.length > 1) {
      out.push({ label: "Notifications", sep: true, run: () => {}, items: [
        { label: "Sessions in these accounts notify you and show in the inbox", caption: true, run: () => {} },
        ...accounts.map((a) => ({ label: a.label, checked: !isMuted(a), keep: true, run: () => mute(a) })),
      ] })
    }
    return out
  }
  openMenu({ x: r.left, y: r.bottom + 4, flip: r.top - 4 }, items(), false, items)
}
