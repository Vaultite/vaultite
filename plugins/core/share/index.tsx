// Sharing's app side: Share… in a folder's menu opens its sheet, as shared documents have it: a link for one person (their
// name, what they may do, for how long), shown once to copy, and who has access, to remove.
import { useEffect, useState } from "react"
import { CalendarPlus, Check, ChevronDown, Copy, Share2, UserMinus } from "lucide-react"
import { activePane, Button, confirmDialog, copyText, currentFile, dateText, definePlugin, detailPath, Empty, fileRowsChanged, fmtAgo, getStore, Group, Loading, menuBelow, notify, notifyError, op, openDetail, Row, Section, Segmented, SettingRow, SheetHead, share, useStoreWith, type FileRow, type MenuItem } from "@vaultite"
import type { SharedFolders } from "./types.ts"

type Role = "read" | "comment" | "edit"
type Shared = { id: string; folder: string; guest: string; role: Role; created: string; expires: string; expired: boolean; used: string | null }
const ROLES: { value: Role; label: string }[] = [{ value: "read", label: "Can view" }, { value: "comment", label: "Can comment" }, { value: "edit", label: "Can edit" }]
const DAYS = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]
const DAY = { day: "numeric", month: "short" } as const
const name = (folder: string) => folder.split("/").pop() ?? folder

function ShareSheet({ folder }: { folder: string }) {
  const [list, setList] = useState<Shared[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [again, setAgain] = useState(0)
  useEffect(() => {
    let on = true
    op<Shared[]>("share.list", { folder }).then((r) => on && setList(r), (e) => on && setError(String((e as Error).message)))
    return () => { on = false }
  }, [folder, again])
  const remove = async (s: Shared) => {
    if (!(await confirmDialog({ title: `Remove ${s.guest}'s access?`, body: `Their link stops working at once. To share ${name(folder)} with them again, make a new one.`, confirm: "Remove", danger: true }))) return
    try { await op("share.revoke", { id: s.id }); notify(`${s.guest} can't open ${name(folder)} any more`) } catch (e) { notifyError(e, "Couldn't remove it") }
    setAgain((n) => n + 1)
  }
  const change = async (s: Shared, to: { role?: Role; days?: number }) => {
    try { await op("share.update", { id: s.id, ...to }) } catch (e) { notifyError(e, "Couldn't change it") }
    setAgain((n) => n + 1)
  }
  // (a person's access as shared documents have it: what they may do, a menu; Remove access, at its foot)
  const menu = (s: Shared): MenuItem[] => [
    ...ROLES.map((r) => ({ label: r.label, checked: s.role === r.value, run: () => { if (s.role !== r.value) void change(s, { role: r.value }) } })),
    { label: s.expired ? "Turn on for 30 days" : "Keep for 30 more days", icon: CalendarPlus, sep: true, run: () => void change(s, { days: 30 }) },
    { label: "Remove access", icon: UserMinus, danger: true, sep: true, run: () => void remove(s) },
  ]
  const online = useStoreWith((st) => st?.shareLinks) !== false
  return (
    <div className="flex flex-col gap-5" data-share-sheet={folder}>
      <SheetHead icon={Share2} tint="var(--primary)" title={`Share ${name(folder)}`}
        sub="Each person gets a link of their own: they see this folder and nothing else of your vault, and no agent works for them." />
      {online ? <NewLink folder={folder} made={() => setAgain((n) => n + 1)} />
        : <Empty>Links need a machine of yours on the internet, one with MCP's public address (vau docs mcp).</Empty>}
      <Section title="People with access">
        {!list ? <Loading error={error} />
          : !list.length ? <Empty>Nobody yet.</Empty>
          : <Group>{list.map((s) => (
            <Row key={s.id} title={s.guest} data-share-row={s.id}
              meta={[s.expired ? "Link expired" : `Until ${dateText(new Date(s.expires), DAY)}`, s.used ? `opened ${fmtAgo(s.used)}` : "not opened yet"].join(" · ")}
              right={<button type="button" onClick={(e) => menuBelow(e, menu(s))} data-share-role={s.role}
                className="flex shrink-0 cursor-pointer items-center gap-0.5 rounded-[6px] px-1.5 py-1 text-[14px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground max-md:text-[16px]">
                {ROLES.find((r) => r.value === s.role)?.label}<ChevronDown className="size-3.5" strokeWidth={2.25} />
              </button>} />
          ))}</Group>}
      </Section>
    </div>
  )
}

/** Who it's for, what they may do and for how long; then their link, shown only now. */
function NewLink({ folder, made }: { folder: string; made: () => void }) {
  const [guest, setGuest] = useState("")
  const [role, setRole] = useState<Role>("comment")
  const [days, setDays] = useState("30")
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<{ guest: string; url: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const create = async () => {
    if (!guest.trim() || busy) return
    setBusy(true)
    try {
      const r = await op<{ link: string; guest: string }>("share.create", { folder, guest: guest.trim(), role, days: Number(days) })
      setLink({ guest: r.guest, url: r.link }); setGuest(""); made()
      // (copied at once, as a share link is: the click that made it is still the user's)
      copyText(r.link).then(() => setCopied(true), () => setCopied(false))
    } catch (e) { notifyError(e, "Couldn't make a link") } finally { setBusy(false) }
  }
  const copy = () => copyText(link!.url).then(() => setCopied(true), (e) => notifyError(e, "Couldn't copy it"))
  return (
    <>
      <Group>
        <SettingRow stack label="Name" sub="Their comments and edits show it">
          <input value={guest} onChange={(e) => setGuest(e.target.value)} placeholder="Who it's for" aria-label="Who it's for" data-share-guest
            onKeyDown={(e) => { if (e.key === "Enter") void create() }}
            className="h-9 min-w-0 rounded-[8px] border-[0.5px] border-border bg-card px-3 text-[15px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/40 sm:w-56" />
        </SettingRow>
        <SettingRow stack label="Access"><Segmented label="Access" value={role} onChange={setRole} options={ROLES} /></SettingRow>
        <SettingRow stack label="Link works for"><Segmented label="Link works for" value={days} onChange={setDays} options={DAYS} /></SettingRow>
      </Group>
      <Button look="primary" busy={busy} disabled={!guest.trim()} onClick={() => void create()} className="self-start" data-share-create>Create link</Button>
      {link && (
        <div className="flex flex-col gap-2 rounded-[10px] bg-foreground/[0.04] p-3" data-share-link>
          <div className="flex gap-2">
            <input readOnly value={link.url} aria-label={`${link.guest}'s link`} onFocus={(e) => e.target.select()}
              className="h-9 min-w-0 flex-1 rounded-[8px] border-[0.5px] border-border bg-card px-3 font-mono text-[13px] outline-none" />
            <Button onClick={() => void copy()} data-share-copy>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "Copied" : "Copy"}</Button>
          </div>
          <p className="text-[13px] text-muted-foreground">Shown only now: send it to {link.guest} only. Anyone with it can open the folder as them.</p>
        </div>
      )}
    </>
  )
}

/** A folder that can be shared from the app: not hidden, and not in a guest's own app. */
const shareable = (path: string) => !share && !!path && !path.split("/").some((x) => x.startsWith("."))
const openShare = (folder: string) => openDetail(detailPath("share", folder))

/** The folder in sight: a folder's tab, else the open file's. */
function folderHere() {
  const to = activePane()?.to ?? ""
  if (to.startsWith("view:folder/")) return to.slice("view:folder/".length)
  const f = currentFile()
  return f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ""
}

// The tree marks a shared folder after its name, as Finder and Drive do; its tooltip says with whom.
const USERS = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
let marked: { from: SharedFolders | undefined; rows: Record<string, FileRow> } = { from: undefined, rows: {} }
function sharedRows(): Record<string, FileRow> {
  const from = getStore()?.sharedFolders
  if (from === marked.from) return marked.rows
  const rows: Record<string, FileRow> = {}
  for (const [folder, people] of Object.entries(from ?? {})) {
    const live = people.filter((p) => Date.parse(p.expires) > Date.now())
    if (!live.length) continue
    const mark = document.createElement("span")
    mark.className = "ml-1 inline-grid size-[13px] shrink-0 place-items-center text-tertiary [&>svg]:size-full"
    mark.dataset.sharedMark = ""
    mark.dataset.tip = `Shared with ${live.map((p) => p.guest).join(", ")}`
    mark.innerHTML = USERS
    rows[folder] = { after: [mark] }
  }
  marked = { from, rows }
  return rows
}
/** The tree drawn again when what's shared changes. */
function Marks() {
  const from = useStoreWith((s) => s?.sharedFolders)
  useEffect(() => { fileRowsChanged() }, [from])
  return null
}

export default definePlugin({
  details: { share: { title: (_s, [folder]) => `Share ${name(folder ?? "")}`, render: (_s, [folder]) => <ShareSheet folder={folder ?? ""} /> } },
  folderMenu: (path) => (shareable(path) ? [{ label: "Share…", icon: Share2, section: "share", run: () => openShare(path) }] : []),
  commands: [{ id: "share:folder", name: "Share folder…", words: "invite link people access guest", icon: Share2, when: () => shareable(folderHere()), run: () => openShare(folderHere()) }],
  fileRows: () => (share ? {} : sharedRows()),
  // (a guest's first tab: the folder shared with them, as a shared folder's link opens)
  home: () => (share ? "view:folder" : null),
  background: () => (share ? null : <Marks />),
})
