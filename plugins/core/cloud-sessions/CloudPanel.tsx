// The Cloud panel: Claude Code on the web's sessions (cloud.ts), the ones that need you first, under each account's name
// when more than one shows. Its own panel, not Terminals': these are pages on claude.ai, not shells here.
import { useContext, useMemo, useState, useSyncExternalStore, type MouseEvent } from "react"
import { Cloud, Copy, Eye, Globe, Plus } from "lucide-react"
import {
  Button, cn, copyText, fmtAgo, useTick, HeadingButton, menuBelow, menuFor, notify, notifyError, PanelFold, SidebarHeading, SidebarRow, useAgents,
  type CloudAccount, type CloudSession, type CloudState, type MenuItem, type SidebarCtx,
} from "@vaultite"
import { accountOf, cloudListed, getCloud, hasCloud, newSession, openSession, setHidden, settings, shownAccounts, subscribeCloud } from "./cloud"

export const useCloud = () => useSyncExternalStore(subscribeCloud, getCloud)

/** The sessions by account, in the accounts' order (the logins' and organizations'), each listed as cloudListed says. */
function useGroups(s: CloudState, hidden: string[] | undefined) {
  return useMemo(() => {
    const shown = shownAccounts(s, hidden)
    const groups = shown.map((a) => ({ account: a as CloudAccount | undefined, ...cloudListed(s.sessions.filter((c) => c.account === a.id)) }))
    // (builds from before accounts: one group, no name)
    const loose = s.sessions.filter((c) => !c.account || !s.accounts.some((a) => a.id === c.account))
    if (loose.length) groups.push({ account: undefined, ...cloudListed(loose) })
    return groups
  }, [s, hidden])
}
type Group = ReturnType<typeof useGroups>[number]

const subhead = "flex h-6 items-end px-1.5 pb-0.5 text-[11px] font-medium text-tertiary max-md:h-8 max-md:text-[13px]"

/** A session's row: Claude Code's icon in its state's colour, its page in a web tab in its account's logins. */
function Row({ c, open, tab, page }: { c: CloudSession; open: boolean; tab: string; page?: boolean }) {
  const a = useAgents().find((x) => x.name === "claude")
  const account = accountOf(useCloud(), c)
  const state = c.state === "running" ? "working" : c.state === "waiting" ? "waiting for you" : "idle"
  const menu = (): MenuItem[] => [
    { label: "Open in a new tab", icon: Globe, run: () => openSession(c, true) },
    { label: "Copy link", icon: Copy, run: () => void copyText(c.url).then(() => notify("Copied the link", { id: "copied" }), (e) => notifyError(e)) },
  ]
  return (
    <SidebarRow icon={a?.icon ?? Cloud} tint={c.state === "idle" ? undefined : a?.tint} badge={c.state === "running" ? "working" : c.state === "waiting" && "ask"}
      label={c.title} open={open} active={tab.endsWith(c.url)} tip={`${c.title} (${state})${account ? `, ${account.label}` : ""}`} data-cloud={c.id} data-state={c.state}
      className={c.state === "waiting" ? "font-semibold" : undefined} more onContextMenu={menuFor(menu)}
      onClick={(e) => openSession(c, e.metaKey || e.ctrlKey || e.button === 1)}>
      <span className="mr-1 shrink-0 truncate text-[11px] font-normal text-tertiary group-hover/row:hidden">
        {page ? `${state[0].toUpperCase()}${state.slice(1)} · ${fmtAgo(c.updated, { short: true })}` : fmtAgo(c.updated, { short: true })}
      </span>
    </SidebarRow>
  )
}

/** One account's rows, under its name when `named`, the older ones behind Show older. */
function Rows({ g, named, open, tab, page, first }: { g: Group; named: boolean; open: boolean; tab: string; page?: boolean; first: boolean }) {
  const [older, setOlder] = useState(false)
  if (!g.listed.length && !(open && g.older.length) && !named) return null
  return (
    <div className="flex flex-col gap-px" data-cloud-account={g.account?.label}>
      {open && named && <div data-cloud-heading className={cn(subhead, !first && "mt-1")}>{g.account?.label ?? "Other"}</div>}
      {!open && !first && <div aria-hidden className="mx-auto my-1 h-px w-4 bg-border" />}
      {g.listed.map((c) => <Row key={c.id} c={c} open={open} tab={tab} page={page} />)}
      {open && older && g.older.map((c) => <Row key={c.id} c={c} open={open} tab={tab} page={page} />)}
      {open && !!g.older.length && (
        <button type="button" data-keyrow data-cloud-older onClick={() => setOlder(!older)}
          className="flex h-7 min-w-0 cursor-pointer items-center truncate rounded-[5px] pl-1.5 text-left text-[13px] whitespace-nowrap text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground max-md:min-h-11 max-md:text-[15px]">
          {older ? "Show fewer" : `Show ${g.older.length} older`}
        </button>
      )}
      {open && named && !g.listed.length && !g.older.length && (
        <button type="button" onClick={() => newSession(g.account)}
          className="flex h-7 min-w-0 cursor-pointer items-center truncate pl-1.5 text-left text-[13px] whitespace-nowrap text-tertiary hover:text-muted-foreground">
          No sessions. Start one
        </button>
      )}
    </div>
  )
}

/** Asked once a profile is signed in to claude.ai: reading the user's sessions with their logins waits for a yes. */
function Ask() {
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

/** The + button: a new session in the one account, else a menu of them. */
export function newMenu(e: MouseEvent, accounts: CloudAccount[]) {
  if (accounts.length <= 1) return newSession(accounts[0])
  menuBelow(e, accounts.map((a) => ({ label: `New session in ${a.label}`, icon: Plus, run: () => newSession(a) })))
}

/** Which accounts show: every one read, each a switch. */
function accountsMenu(e: MouseEvent, s: CloudState, hidden: string[] | undefined) {
  menuBelow(e, s.accounts.map((a) => ({ label: a.label, checked: !hidden?.includes(a.label), keep: true,
    run: () => void setHidden(a.label, !hidden?.includes(a.label)).catch((err) => notifyError(err, "Couldn't save that")) })))
}

/** The panel draws nothing until there's something to show (a desktop app signed in to claude.ai); in the rail, only
 *  the sessions' icons. */
export function CloudPanel({ open, tab }: SidebarCtx) {
  const s = useCloud()
  const set = settings.use()
  const groups = useGroups(s, set.hidden)
  const fold = useContext(PanelFold)
  if (!hasCloud() || set.read === false || (!s.signedIn && !s.sessions.length)) return null
  const asking = set.read === undefined
  const named = groups.length > 1
  if (!open) return asking ? null : <>{groups.map((g, i) => <Rows key={g.account?.id ?? ""} g={g} named={false} open={false} tab={tab} first={i === 0} />)}</>
  const shown = shownAccounts(s, set.hidden)
  return (
    <div className="flex shrink-0 flex-col" data-cloud-panel>
      <SidebarHeading title="Cloud" open={open}>
        {s.accounts.length > 1 && <HeadingButton icon={Eye} label="Accounts shown" onClick={(e) => accountsMenu(e, s, set.hidden)} />}
        {!asking && <HeadingButton icon={Plus} label="New cloud session" onClick={(e) => newMenu(e, shown)} />}
      </SidebarHeading>
      {!fold?.collapsed && (asking ? <Ask /> : (
        <div className="flex flex-col gap-px">
          {groups.map((g, i) => <Rows key={g.account?.id ?? ""} g={g} named={named} open tab={tab} first={i === 0} />)}
          {!named && !groups.some((g) => g.listed.length || g.older.length) && (
            <button type="button" onClick={() => newSession(shown[0])}
              className="flex h-7 min-w-0 cursor-pointer items-center truncate pl-1.5 text-left text-[13px] whitespace-nowrap text-tertiary hover:text-muted-foreground">
              {s.accounts.length ? "No sessions. Start one" : "Reading your sessions…"}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/** The panel as a tab (view:cloud): the rows spelled out, a size up, with a button per account to start one. */
export function CloudView() {
  const s = useCloud()
  const set = settings.use()
  useTick()
  const say = (text: string) => <p data-cloud-view className="text-[15px] text-muted-foreground">{text}</p>
  if (!hasCloud()) return say("Cloud sessions are read in the desktop app, with the Browser's logins.")
  if (set.read === false) return say("Showing your sessions here is off: Cloud sessions' settings turn it on.")
  if (set.read !== true) return s.signedIn ? <div data-cloud-view className="max-w-md"><Ask /></div> : say("Sign in to claude.ai in the Browser, and your Claude Code sessions show here.")
  const shown = shownAccounts(s, set.hidden)
  return (
    <div data-cloud-view>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[13px] text-muted-foreground max-md:text-[15px]">Claude Code on the web's sessions. Click one to open it.</p>
        {(shown.length ? shown : [undefined]).map((a) => (
          <Button key={a?.id ?? ""} size="small" onClick={() => newSession(a)}><Plus className="size-3.5" strokeWidth={2.25} />{shown.length > 1 ? `New in ${a!.label}` : "New session"}</Button>
        ))}
      </div>
      <div className="size-up-bleed"><div data-size-up><CloudList /></div></div>
    </div>
  )
}

/** The sessions on a blank tab's page, spelled out. */
export function CloudList() {
  const s = useCloud()
  const set = settings.use()
  const groups = useGroups(s, set.hidden)
  if (set.read !== true) return null
  return (
    <div className="flex flex-col gap-px pb-1">
      {groups.map((g, i) => <Rows key={g.account?.id ?? ""} g={g} named={groups.length > 1} open tab="" page first={i === 0} />)}
    </div>
  )
}
