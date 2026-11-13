import { useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { Archive, ChevronDown, Cloud, Ellipsis, GitBranch, GitMerge, GitPullRequestArrow, GitPullRequestClosed, GitPullRequestDraft, Monitor, Plus, SquareTerminal } from "lucide-react"
import { Badged, Button, cn, Empty, FilterField, fmtAgo, HeadingButton, menuBelow, menuFor, PageHeader, plural, rightClickBelow, useAgents, useTick,
  type CloudSession } from "@vaultite"
import { accountOf, archive, badgeOf, canAct, hasCloud, needsYou, openGitHub, openSession, repoName, repoOf, settings, statusOf, teleport, type Status } from "./cloud"
import { Ask, newMenu, Picker, sessionMenu, useCloud, usePicked, useShown, useTeleportable } from "./CloudPanel"

const SECTIONS: { id: Status; title: string }[] = [
  { id: "needs", title: "Needs you" }, { id: "working", title: "Working" }, { id: "review", title: "Ready for review" }, { id: "done", title: "Recent" },
]
const RECENT = 20

const PR = {
  open: { icon: GitPullRequestArrow, color: "var(--green)", label: "Open" },
  draft: { icon: GitPullRequestDraft, color: "var(--gray)", label: "Draft" },
  merged: { icon: GitMerge, color: "var(--purple)", label: "Merged" },
  closed: { icon: GitPullRequestClosed, color: "var(--red)", label: "Closed" },
}

const haystack = (c: CloudSession, account?: string) => [c.title, c.summary, account, ...(c.repos ?? []).flatMap((r) => [r.repo, r.branch]), c.pr ? `#${c.pr.number}` : ""]
  .filter(Boolean).join(" ").toLowerCase()

export function CloudView() {
  const { s, shown, picked } = usePicked()
  const set = settings.use()
  const { list, leaving } = useShown(s, shown, picked)
  const [q, setQ] = useState("")
  const [repo, setRepo] = useState<string | null>(null)
  useTick()
  const repos = useMemo(() => [...new Set((list ?? []).flatMap((c) => (c.repos ?? []).map((r) => r.repo)))].sort(), [list])
  const say = (text: ReactNode) => <div data-cloud-view className="mx-auto max-w-[860px]"><PageHeader title="Cloud sessions" /><Empty>{text}</Empty></div>
  if (!hasCloud()) return say("Cloud sessions are read in the desktop app, with the Browser's logins.")
  if (set.read === false) return say("Showing your sessions here is off: Cloud sessions' settings turn it on.")
  if (set.read !== true) return s.signedIn
    ? <div data-cloud-view className="mx-auto max-w-[860px]"><PageHeader title="Cloud sessions" /><div className="max-w-md"><Ask /></div></div>
    : say("Sign in to claude.ai in the Browser, and your Claude Code sessions show here.")
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const all = picked || shown.length < 2
  const found = (list ?? []).filter((c) => (!repo || c.repos?.some((r) => r.repo === repo)) && (!words.length || words.every((w) => haystack(c, accountOf(s, c)?.label).includes(w))))
  const by = (id: Status) => found.filter((c) => statusOf(c) === id).sort((a, b) => b.updated - a.updated)
  const needs = (list ?? []).filter(needsYou).length, working = (list ?? []).filter((c) => c.state === "running").length
  const subtitle = [needs && `${needs} ${needs === 1 ? "needs" : "need"} you`, working && `${working} working`].filter(Boolean).join(", ") || "Claude Code on the web"
  const repoMenu = (e: MouseEvent) => menuBelow(e, [
    { label: "All repositories", checked: !repo, run: () => setRepo(null) },
    ...repos.map((r) => ({ label: r, icon: GitBranch, checked: r === repo, run: () => setRepo(r) })),
  ])
  return (
    <div data-cloud-view className="@container mx-auto max-w-[860px] pb-10">
      <PageHeader title="Cloud sessions" subtitle={subtitle}>
        <div className="flex items-center gap-2">
          <Picker big />
          <Button size="small" look="primary" onClick={(e) => newMenu(e, shown, picked)} data-cloud-new=""><Plus className="-ml-0.5 size-3.5" strokeWidth={2.25} />New session</Button>
        </div>
      </PageHeader>
      <div className="mb-4 flex items-center gap-2">
        <FilterField value={q} onChange={setQ} placeholder="Search sessions" />
        {repos.length > 1 && (
          <Button size="small" look="secondary" onClick={repoMenu} data-cloud-repo={repo ?? ""} className="max-md:h-11 max-md:text-[15px]">
            <span className="max-w-[12em] truncate">{repo ? repoName(repo) : "All repositories"}</span><ChevronDown aria-hidden className="-mr-1 size-3.5" strokeWidth={2.25} />
          </Button>
        )}
      </div>
      {!s.accounts.length && !s.sessions.length ? <Empty><span className="shimmer">Reading your sessions…</span></Empty>
        : !found.length ? <Empty>{list?.length ? "No sessions match." : "No sessions yet. New session starts one on claude.ai."}</Empty>
        : SECTIONS.map((sec) => <Section key={sec.id} id={sec.id} title={sec.title} list={by(sec.id)} named={!all} leaving={leaving} />)}
    </div>
  )
}

function Section({ id, title, list, named, leaving }: { id: Status; title: string; list: CloudSession[]; named: boolean; leaving: (k: string) => "" | undefined }) {
  const [more, setMore] = useState(false)
  if (!list.length) return null
  const shown = id === "done" && !more ? list.slice(0, RECENT) : list
  return (
    <section className="mb-5" data-cloud-section={id}>
      <h2 className="mb-1 flex items-baseline gap-2 px-2 text-[13px] font-semibold text-muted-foreground max-md:text-[15px]">
        {title}<span className="font-normal text-tertiary tabular-nums">{list.length}</span>
      </h2>
      <div className="flex flex-col">
        {shown.map((c) => <PageRow key={c.id} c={c} named={named} leaving={leaving(c.id)} />)}
      </div>
      {shown.length < list.length && (
        <button type="button" onClick={() => setMore(true)} data-cloud-more=""
          className="mt-1 h-7 cursor-pointer rounded-[6px] px-2 text-[13px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground max-md:h-11 max-md:text-[15px]">
          Show {plural(list.length - shown.length, "more")}
        </button>
      )}
    </section>
  )
}

function PageRow({ c, named, leaving }: { c: CloudSession; named: boolean; leaving: "" | undefined }) {
  const agent = useAgents().find((x) => x.name === "claude")
  const s = useCloud(), account = named ? accountOf(s, c) : undefined
  const here = useTeleportable()(c)
  const r = repoOf(c)
  const Icon = agent?.icon ?? Cloud
  const open = (e: MouseEvent | KeyboardEvent) => openSession(c, e.metaKey || e.ctrlKey || ("button" in e && e.button === 1))
  const pr = c.pr && PR[c.pr.state]
  const prChip = (className: string) => pr && (
    <button type="button" onClick={(e) => { e.stopPropagation(); openGitHub(c.pr!.url) }} data-cloud-pr={c.pr!.state} data-tip={`${pr.label} pull request`}
      className={cn("flex shrink-0 cursor-pointer items-center gap-1 rounded-[4px] font-medium tabular-nums hover:text-foreground", className)}>
      <pr.icon className="size-3.5" strokeWidth={2.25} style={{ color: pr.color }} />#{c.pr!.number}
    </button>
  )
  return (
    <div role="link" tabIndex={0} data-cloud={c.id} data-state={c.state} data-status={statusOf(c)} data-leaving={leaving} data-keyrow
      onClick={open} onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); open(e) } }} onKeyDown={(e) => { if (e.key === "Enter") open(e) }}
      onContextMenu={menuFor(() => sessionMenu(c, here))}
      className="group/row relative isolate flex min-h-11 cursor-pointer items-start gap-3 rounded-[8px] px-2 py-2 outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-primary/40 active:bg-foreground/[0.07] max-md:min-h-14 max-md:py-2.5">
      <span className="mt-0.5 shrink-0 max-md:mt-px">
        <Badged on={badgeOf(c)}>
          <Icon className="size-4 max-md:size-5" strokeWidth={2} style={{ color: statusOf(c) === "done" && !c.unread ? "var(--muted-foreground)" : agent?.tint }} />
        </Badged>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn("min-w-0 truncate text-[14px] leading-[20px] max-md:text-[17px] max-md:leading-[22px]", (needsYou(c) || c.unread) && "font-semibold")} data-cloud-title="">{c.title}</span>
          {c.remote && <span data-tip="Remote Control: it runs on a computer, claude.ai drives it" className="shrink-0 text-tertiary"><Monitor aria-label="Remote Control" className="size-3.5" strokeWidth={2} /></span>}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-[16px] text-muted-foreground @max-2xl:flex-wrap max-md:text-[15px] max-md:leading-[20px]">
          {prChip("@2xl:hidden")}
          {r && (
            <span className="flex min-w-0 shrink items-center gap-1" data-cloud-repo-of="">
              <GitBranch aria-hidden className="size-3 shrink-0 text-tertiary max-md:size-3.5" strokeWidth={2.25} />
              <span className="shrink-0">{repoName(r.repo)}</span>
              {r.branch && <span className="min-w-0 truncate text-tertiary">{r.branch}</span>}
              {(c.repos?.length ?? 0) > 1 && <span className="shrink-0 text-tertiary">+{c.repos!.length - 1}</span>}
            </span>
          )}
          {account && <span className="min-w-0 truncate text-tertiary @2xl:hidden" data-cloud-account-of="">{account.label}</span>}
          {c.summary && <>
            {r && <span aria-hidden className="shrink-0 text-tertiary @max-2xl:hidden">·</span>}
            <span className={cn("min-w-0 flex-[2] truncate @max-2xl:line-clamp-2 @max-2xl:basis-full @max-2xl:whitespace-normal", needsYou(c) && "text-foreground")} data-cloud-summary="">{c.summary}</span>
          </>}
        </div>
      </div>
      <div className="relative flex shrink-0 items-center gap-3 self-center text-[12px] text-tertiary max-md:text-[13px] @max-2xl:self-start @max-2xl:pt-0.5">
        {account && <span className="max-w-[14em] truncate @max-2xl:hidden md:group-hover/row:invisible" data-cloud-account-of="">{account.label}</span>}
        {prChip("text-muted-foreground @max-2xl:hidden md:group-hover/row:invisible")}
        <span className="min-w-8 text-right tabular-nums md:group-hover/row:invisible">{fmtAgo(c.updated, { short: true })}</span>
        <span onClick={(e) => e.stopPropagation()} data-cloud-actions=""
          className="invisible absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 transition-opacity max-md:hidden md:group-hover/row:visible md:group-hover/row:opacity-100 md:group-focus-within/row:visible md:group-focus-within/row:opacity-100">
          {here && <HeadingButton icon={SquareTerminal} label="Continue in a terminal" onClick={() => void teleport(c)} className="size-6" data-cloud-teleport="" />}
          {canAct() && <HeadingButton icon={Archive} label="Archive" onClick={() => void archive(c)} className="size-6" data-cloud-archive="" />}
          <HeadingButton icon={Ellipsis} label={`More for ${c.title}`} tip="More" onClick={rightClickBelow} className="size-6" />
        </span>
      </div>
    </div>
  )
}
