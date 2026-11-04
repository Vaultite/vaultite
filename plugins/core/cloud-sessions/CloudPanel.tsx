// The Cloud panel: Claude Code on the web's sessions (cloud.ts), those needing you first, in the account picked on its
// heading (as Sites picks logins) or each account's under its name. Not Terminals': these are claude.ai's pages.
import { useContext, useEffect, useMemo, useState, useSyncExternalStore, type MouseEvent } from "react"
import { Archive, ChevronsUpDown, Cloud, Copy, GitPullRequestArrow, Globe, Pencil, Plus, SquareTerminal } from "lucide-react"
import {
  Button, copyText, fmtAgo, HeadingButton, menuBelow, menuFor, notify, notifyError, PanelFold, SidebarHeading, SidebarRow, useAgents, useScopedState,
  type CloudAccount, type CloudSession, type CloudState, type MenuItem, type SidebarCtx,
} from "@vaultite"
import {
  accountOf, archive, badgeOf, canAct, cloudListed, diffUrl, getCloud, hasCloud, leaving, needsYou, newSession, openGitHub, openSession, PICKED, pickedOf, rename,
  setHidden, settings, shownAccounts, STATUS, statusOf, subscribeCloud, teleport, teleportable,
} from "./cloud"

export const useCloud = () => useSyncExternalStore(subscribeCloud, getCloud)

/** The accounts shown, the one picked in this workspace (undefined: all of them) and picking. */
export function usePicked() {
  const s = useCloud()
  const set = settings.use()
  const [id, pick] = useScopedState<string | null>(PICKED, null)
  const shown = useMemo(() => shownAccounts(s, set.hidden), [s, set.hidden])
  return { s, shown, picked: pickedOf(shown, id), pick: (a: CloudAccount | null) => pick(a?.id ?? undefined), hidden: set.hidden }
}

/** The sessions shown: the picked account's, else every shown one's; none on their way to the archive. */
export function useShown(s: CloudState, shown: CloudAccount[], picked: CloudAccount | undefined) {
  const list = useMemo(() => s.sessions.filter((c) => (picked ? c.account === picked.id : !c.account || shown.some((a) => a.id === c.account) || !s.accounts.some((a) => a.id === c.account))),
    [s, shown, picked])
  return leaving.use(list, (c) => c.id)
}

/** The orgs a Claude Code account here is signed in to: a session of one can be continued here. */
export function useTeleportable() {
  const claude = useAgents().some((a) => a.name === "claude")
  const [orgs, setOrgs] = useState<string[]>([])
  useEffect(() => { if (claude) void teleportable().then(setOrgs) }, [claude])
  return (c: CloudSession) => claude && !c.remote && !!c.account && orgs.includes(c.account)
}

/** A session's menu: open it, continue it here, its work on GitHub, rename, copy its link, archive. */
export function sessionMenu(c: CloudSession, here: boolean): MenuItem[] {
  const diff = diffUrl(c)
  return [
    { label: "Open in a new tab", icon: Globe, run: () => openSession(c, true) },
    ...(here ? [{ label: "Continue in a terminal", icon: SquareTerminal, run: () => void teleport(c) }] : []),
    ...(diff ? [{ label: c.pr ? `Open pull request #${c.pr.number}` : "Open the branch's changes", icon: GitPullRequestArrow, run: () => openGitHub(diff) }] : []),
    ...(canAct() ? [{ label: "Rename…", icon: Pencil, sep: true, run: () => rename(c) }] : []),
    { label: "Copy link", icon: Copy, sep: !canAct(), run: () => void copyText(c.url).then(() => notify("Copied the link", { id: "copied" }), (e) => notifyError(e)) },
    ...(canAct() ? [{ label: "Archive", icon: Archive, sep: true, run: () => void archive(c) }] : []),
  ]
}

/** A session's row in the sidebar: Claude Code's icon, its dot (working, needs you, unread), its page on a click. */
function Row({ c, open, tab, named }: { c: CloudSession; open: boolean; tab: string; named: boolean }) {
  const a = useAgents().find((x) => x.name === "claude")
  const s = useCloud(), account = named ? accountOf(s, c) : undefined
  const here = useTeleportable()(c)
  const status = STATUS[statusOf(c)].toLowerCase()
  return (
    <SidebarRow icon={a?.icon ?? Cloud} tint={statusOf(c) === "done" && !c.unread ? undefined : a?.tint} badge={badgeOf(c)}
      label={c.title} open={open} active={tab.endsWith(c.url)} tip={`${c.title} (${status})${account ? `, ${account.label}` : ""}`} data-cloud={c.id} data-state={c.state}
      data-status={statusOf(c)} data-leaving={leaving.has(c.id) ? "" : undefined}
      className={needsYou(c) || c.unread ? "font-semibold" : undefined} more onContextMenu={menuFor(() => sessionMenu(c, here))}
      swipe={canAct() ? () => [{ label: "Archive", icon: Archive, removes: true, run: () => void archive(c) }] : undefined}
      onClick={(e) => openSession(c, e.metaKey || e.ctrlKey || e.button === 1)}>
      <span className="mr-1 shrink-0 truncate text-[11px] font-normal text-tertiary group-hover/row:hidden">{fmtAgo(c.updated, { short: true })}</span>
    </SidebarRow>
  )
}

const subhead = "flex h-6 items-end px-1.5 pb-0.5 text-[11px] font-medium text-tertiary max-md:h-8 max-md:text-[13px]"
const quiet = "flex h-7 min-w-0 cursor-pointer items-center truncate rounded-[5px] pl-1.5 text-left text-[13px] whitespace-nowrap max-md:min-h-11 max-md:text-[15px]"

/** One account's rows (under its name when `named`), the older ones behind Show older. */
function Rows({ account, list, named, open, tab, first }: { account?: CloudAccount; list: CloudSession[]; named: boolean; open: boolean; tab: string; first: boolean }) {
  const [older, setOlder] = useState(false)
  const g = useMemo(() => cloudListed(list), [list])
  if (!open && !g.listed.length) return null
  return (
    <div className="flex flex-col gap-px" data-cloud-account={account?.label}>
      {open && named && <div data-cloud-heading className={`${subhead} ${first ? "" : "mt-1"}`}>{account?.label ?? "Other"}</div>}
      {!open && !first && <div aria-hidden className="mx-auto my-1 h-px w-4 bg-border" />}
      {g.listed.map((c) => <Row key={c.id} c={c} open={open} tab={tab} named={false} />)}
      {open && older && g.older.map((c) => <Row key={c.id} c={c} open={open} tab={tab} named={false} />)}
      {open && !!g.older.length && (
        <button type="button" data-keyrow data-cloud-older onClick={() => setOlder(!older)} className={`${quiet} text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground`}>
          {older ? "Show fewer" : `Show ${g.older.length} older`}
        </button>
      )}
      {open && !g.listed.length && !g.older.length && (
        <button type="button" onClick={() => newSession(account)} className={`${quiet} text-tertiary hover:text-muted-foreground`}>No sessions. Start one</button>
      )}
    </div>
  )
}

/** Asked once a profile is signed in to claude.ai: reading the user's sessions with their logins waits for a yes. */
export function Ask() {
  const answer = (yes: boolean) => void settings.set({ read: yes }).catch((e) => notifyError(e, "Couldn't save that"))
  return (
    <div className="mx-1.5 my-1 space-y-2 rounded-[8px] bg-foreground/[0.04] p-2.5" data-cloud-ask>
      <p className="text-[13px] leading-[18px]">Show your Claude Code sessions from claude.ai here?</p>
      <p className="text-[12px] leading-[16px] text-muted-foreground">Read with the Browser's logins, every account it's signed in to. You can hide any of them.</p>
      <div className="flex gap-2">
        <Button size="small" look="primary" onClick={() => answer(true)}>Show them</Button>
        <Button size="small" look="secondary" onClick={() => answer(false)}>Not now</Button>
      </div>
    </div>
  )
}

/** The + button: a new session in the account picked, the one shown, else a menu of them. */
export function newMenu(e: MouseEvent, accounts: CloudAccount[], picked?: CloudAccount) {
  if (picked || accounts.length <= 1) return newSession(picked ?? accounts[0])
  menuBelow(e, accounts.map((a) => ({ label: `New session in ${a.label}`, icon: Plus, run: () => newSession(a) })))
}

/** Whose sessions show: all accounts or one, and which accounts show at all (the rest aren't read). */
export function accountsMenu(e: MouseEvent, s: CloudState, shown: CloudAccount[], picked: CloudAccount | undefined, pick: (a: CloudAccount | null) => void, hidden: string[] | undefined) {
  menuBelow(e, [
    { label: "Sessions in", caption: true, run: () => {} },
    { label: "All accounts", checked: !picked, run: () => pick(null) },
    ...shown.map((a) => ({ label: a.label, checked: a.id === picked?.id, run: () => pick(a) })),
    { label: "Accounts shown", sep: true, run: () => {}, items: s.accounts.map((a) => ({ label: a.label, checked: !hidden?.includes(a.label), keep: true,
      run: () => void setHidden(a.label, !hidden?.includes(a.label)).catch((err) => notifyError(err, "Couldn't save that")) })) },
  ])
}

/** The account picker: the one shown, a menu on a click (as the Sites panel's). */
export function Picker({ big }: { big?: boolean }) {
  const { s, shown, picked, pick, hidden } = usePicked()
  if (s.accounts.length < 2) return null
  const name = picked?.label ?? "All accounts"
  // (the sidebar's is short: an email's name before the @, when no other account shown has it)
  const local = picked?.label.split("@")[0] ?? ""
  const short = picked && local !== picked.label && !shown.some((a) => a !== picked && a.label.split("@")[0] === local) ? local : name
  const open = (e: MouseEvent) => accountsMenu(e, s, shown, picked, pick, hidden)
  if (big) return <Button size="small" look="secondary" onClick={open} aria-label={`Sessions in ${name}`} data-cloud-picker={picked?.id ?? ""}>
    <span className="max-w-[16em] truncate">{name}</span><ChevronsUpDown aria-hidden className="-mr-1 size-3.5 shrink-0" strokeWidth={2.25} />
  </Button>
  return (
    <button type="button" onClick={open} aria-label={`Sessions in ${name}`} data-tip={short === name ? "Whose sessions" : name} data-cloud-picker={picked?.id ?? ""}
      className="flex h-5 max-w-[60%] min-w-0 cursor-pointer items-center gap-1 rounded-[4px] px-1.5 text-[11px] font-medium text-tertiary hover:bg-foreground/[0.08] hover:text-muted-foreground">
      <span className="truncate">{short}</span>
      <ChevronsUpDown aria-hidden className="-mx-0.5 size-3 shrink-0" strokeWidth={2.25} />
    </button>
  )
}

/** Nothing until there's something to show (a desktop app signed in to claude.ai); in the rail, the sessions' icons. */
/** The sessions in groups: the picked account's, else each shown one's under its name. */
function useGroups() {
  const { s, shown, picked } = usePicked()
  const { list } = useShown(s, shown, picked)
  const groups = picked || shown.length < 2 ? [{ account: picked ?? shown[0], list: list ?? [] }]
    : shown.map((a) => ({ account: a as CloudAccount | undefined, list: (list ?? []).filter((c) => c.account === a.id) }))
  const loose = !picked && shown.length > 1 ? (list ?? []).filter((c) => !c.account || !s.accounts.some((a) => a.id === c.account)) : []
  if (loose.length) groups.push({ account: undefined, list: loose })
  return { s, shown, picked, groups, named: groups.length > 1 }
}

export function CloudPanel({ open, tab }: SidebarCtx) {
  const { s, shown, picked, groups, named } = useGroups()
  const set = settings.use()
  const fold = useContext(PanelFold)
  if (!hasCloud() || set.read === false || (!s.signedIn && !s.sessions.length)) return null
  const asking = set.read === undefined
  if (!open) return asking ? null : <>{groups.map((g, i) => <Rows key={g.account?.id ?? ""} account={g.account} list={g.list} named={false} open={false} tab={tab} first={i === 0} />)}</>
  return (
    <div className="flex shrink-0 flex-col" data-cloud-panel>
      <SidebarHeading title="Cloud" open={open} aside={!asking && <Picker />}>
        {!asking && <HeadingButton icon={Plus} label={picked ? `New session in ${picked.label}` : "New cloud session"} onClick={(e) => newMenu(e, shown, picked)} data-cloud-new="" />}
      </SidebarHeading>
      {!fold?.collapsed && (asking ? <Ask /> : (
        <div className="flex flex-col gap-px">
          {s.accounts.length || s.sessions.length
            ? groups.map((g, i) => <Rows key={g.account?.id ?? ""} account={g.account} list={g.list} named={named} open tab={tab} first={i === 0} />)
            : <p className={`${quiet} cursor-default text-tertiary`}>Reading your sessions…</p>}
        </div>
      ))}
    </div>
  )
}

/** The sessions on a blank tab's page, a size up. */
export function CloudList() {
  const { groups, named } = useGroups()
  if (settings.use().read !== true) return null
  return <div className="flex flex-col gap-px pb-1" data-size-up="">{groups.map((g, i) => <Rows key={g.account?.id ?? ""} account={g.account} list={g.list} named={named} open tab="" first={i === 0} />)}</div>
}
