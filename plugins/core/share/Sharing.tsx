// Sharing's sheet and the Shared page, loaded when one opens: a link for one person, shown once, and who has access, to
// change or remove; the Shared page (view:shared) has every share at once, with the guests' address.
import { useEffect, useState } from "react"
import { CalendarPlus, Check, ChevronDown, Copy, Globe, Link2, Share2, UserMinus } from "lucide-react"
import { Button, confirmDialog, copyText, dateText, Empty, fmtAgo, Group, Loading, menuBelow, notify, notifyError, OnThisMac, op, openFolder, openView, Panel, Row, Section, Segmented, SettingRow, SheetHead, useOverConnect, useStoreWith, useTick, type MenuItem } from "@vaultite"

type Role = "read" | "comment" | "edit"
/** A share as share.list gives it; `here`: its guest has the folder open now. */
type Shared = { id: string; folder: string; guest: string; role: Role; created: string; expires: string; expired: boolean; used: string | null; here?: boolean }
/** A link just made, shown only now. */
type Fresh = { guest: string; url: string }
const ROLES: { value: Role; label: string }[] = [{ value: "read", label: "Can view" }, { value: "comment", label: "Can comment" }, { value: "edit", label: "Can edit" }]
const DAYS = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]
const DAY = { day: "numeric", month: "short" } as const
const name = (folder: string) => folder.split("/").pop() ?? folder

/** The shares (one folder's, or all), asked again after a change and, for who's in one now, every 20 seconds in sight.
 *  Not through Vaultite Connect, where sharing is the Mac's (`over`). */
function useShares(folder?: string) {
  const over = useOverConnect()
  const [list, setList] = useState<Shared[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [again, setAgain] = useState(0)
  const tick = useTick(20_000)
  useEffect(() => {
    if (over) return
    let on = true
    op<Shared[]>("share.list", folder ? { folder } : {}).then((r) => on && setList(r), (e) => on && setError(String((e as Error).message)))
    return () => { on = false }
  }, [folder, again, tick, over])
  return { list, error, over, reload: () => setAgain((n) => n + 1) }
}

/** What a person's access is: until when, and whether they're in it now or when they last were. */
const accessMeta = (s: Shared) => [s.expired ? "Link expired" : `Until ${dateText(new Date(s.expires), DAY)}`,
  s.here ? "here now" : s.used ? `opened ${fmtAgo(s.used)}` : "not opened yet"].join(" · ")

/** A person's access, as ShareSheet and the Shared page list it: who, until when, and its menu (what they may do, more
 *  days, a new link, removing it). `fresh`: a new link made, to show once. */
function AccessRow({ s, title, done, fresh }: { s: Shared; title?: string; done: () => void; fresh: (l: Fresh) => void }) {
  const folder = name(s.folder)
  const remove = async () => {
    if (!(await confirmDialog({ title: `Remove ${s.guest}'s access?`, body: `Their link stops working at once. To share ${folder} with them again, make a new one.`, confirm: "Remove", danger: true }))) return
    try { await op("share.revoke", { id: s.id }); notify(`${s.guest} can't open ${folder} any more`) } catch (e) { notifyError(e, "Couldn't remove it") }
    done()
  }
  const change = async (to: { role?: Role; days?: number }) => {
    try { await op("share.update", { id: s.id, ...to }) } catch (e) { notifyError(e, "Couldn't change it") }
    done()
  }
  const relink = async () => {
    if (!(await confirmDialog({ title: `Give ${s.guest} a new link?`, body: `The link they have stops working at once, and ${folder} closes where they have it open. Send them the new one.`, confirm: "New link" }))) return
    try {
      const r = await op<{ link: string; guest: string }>("share.new-link", { id: s.id })
      fresh({ guest: r.guest, url: r.link })
    } catch (e) { notifyError(e, "Couldn't make a new link") }
    done()
  }
  // (as shared documents have it: what they may do, a menu; Remove access, at its foot)
  const menu = (): MenuItem[] => [
    ...ROLES.map((r) => ({ label: r.label, checked: s.role === r.value, run: () => { if (s.role !== r.value) void change({ role: r.value }) } })),
    { label: s.expired ? "Turn on for 30 days" : "Keep for 30 more days", icon: CalendarPlus, sep: true, run: () => void change({ days: 30 }) },
    { label: "New link…", icon: Link2, run: () => void relink() },
    { label: "Remove access", icon: UserMinus, danger: true, sep: true, run: () => void remove() },
  ]
  return (
    <Row title={title ?? s.guest} data-share-row={s.id} data-share-here={s.here ? "" : undefined} meta={accessMeta(s)}
      right={<button type="button" onClick={(e) => menuBelow(e, menu())} data-share-role={s.role}
        className="flex shrink-0 cursor-pointer items-center gap-0.5 rounded-[6px] px-1.5 py-1 text-[14px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground max-md:text-[16px]">
        {ROLES.find((r) => r.value === s.role)?.label}<ChevronDown className="size-3.5" strokeWidth={2.25} />
      </button>} />
  )
}

/** A link just made: copied at once (the click that made it is still the user's), shown only now. */
function FreshLink({ link }: { link: Fresh }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    setCopied(false)
    copyText(link.url).then(() => setCopied(true), () => setCopied(false))
  }, [link])
  const copy = () => copyText(link.url).then(() => setCopied(true), (e) => notifyError(e, "Couldn't copy it"))
  return (
    <div className="flex flex-col gap-2 rounded-[10px] bg-foreground/[0.04] p-3" data-share-link>
      <div className="flex gap-2">
        <input readOnly value={link.url} aria-label={`${link.guest}'s link`} onFocus={(e) => e.target.select()}
          className="h-9 min-w-0 flex-1 rounded-[8px] border-[0.5px] border-border bg-card px-3 font-mono text-[13px] outline-none" />
        <Button onClick={() => void copy()} data-share-copy>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "Copied" : "Copy"}</Button>
      </div>
      <p className="text-[13px] text-muted-foreground">Shown only now: send it to {link.guest} only. Anyone with it can open the folder as them.</p>
    </div>
  )
}

/** The guests' address links are made at ("" none, undefined not known yet). */
const useGuestAddress = () => useStoreWith((st) => st?.shareLinks)

export function ShareSheet({ folder }: { folder: string }) {
  const { list, error, over, reload } = useShares(folder)
  const [fresh, setFresh] = useState<Fresh | null>(null)
  const online = useGuestAddress() !== ""
  const head = <SheetHead icon={Share2} tint="var(--primary)" title={`Share ${name(folder)}`}
    sub="Each person gets a link of their own: they see this folder and nothing else of your vault, and no agent works for them." />
  if (over) return <div className="flex flex-col gap-5" data-share-sheet={folder}>{head}<OnThisMac>Folders are shared on this Mac.</OnThisMac></div>
  return (
    <div className="flex flex-col gap-5" data-share-sheet={folder}>
      {head}
      {online ? <NewLink folder={folder} made={(l) => { setFresh(l); reload() }} />
        : <Empty>Links need a machine of yours on the internet: sign one in to Vaultite Cloud (Connections, Remote access).</Empty>}
      {fresh && <FreshLink link={fresh} />}
      <Section title="People with access">
        {!list ? <Loading error={error} />
          : !list.length ? <Empty>Nobody yet.</Empty>
          : <Group>{list.map((s) => <AccessRow key={s.id} s={s} done={reload} fresh={setFresh} />)}</Group>}
      </Section>
      <Group><SettingRow label="Everything you share" sub="Every folder's people, and who's in one now" onClick={() => openView("shared", { newTab: true })} data-share-all /></Group>
    </div>
  )
}

/** Who it's for, what they may do and for how long; `made`: their link, to show only now. */
function NewLink({ folder, made }: { folder: string; made: (l: Fresh) => void }) {
  const [guest, setGuest] = useState("")
  const [role, setRole] = useState<Role>("comment")
  const [days, setDays] = useState("30")
  const [busy, setBusy] = useState(false)
  const create = async () => {
    if (!guest.trim() || busy) return
    setBusy(true)
    try {
      const r = await op<{ link: string; guest: string }>("share.create", { folder, guest: guest.trim(), role, days: Number(days) })
      setGuest(""); made({ guest: r.guest, url: r.link })
    } catch (e) { notifyError(e, "Couldn't make a link") } finally { setBusy(false) }
  }
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
    </>
  )
}

/** view:shared: every folder shared and with whom, by folder (its name opens it), and the guests' address. */
export function SharedView() {
  const { list, error, over, reload } = useShares()
  const [fresh, setFresh] = useState<Fresh | null>(null)
  const address = useGuestAddress()
  const folders = [...new Set((list ?? []).map((s) => s.folder))]
  const copy = (url: string) => copyText(url).then(() => notify("Copied the address", { id: "copied" }), (e) => notifyError(e, "Couldn't copy it"))
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 p-4" data-shared>
      <Panel title="Shared folders" icon={Share2}>
        <div className="flex flex-col gap-4">
          {fresh && <FreshLink link={fresh} />}
          {over ? <OnThisMac>Who you share folders with is seen and changed on this Mac.</OnThisMac>
            : !list ? <Loading error={error} />
            : !list.length ? <Empty>Nothing is shared yet. To share a folder, open its menu and choose Share…</Empty>
            : folders.map((f) => (
              <Section key={f} title={<button type="button" onClick={() => openFolder(f)} data-shared-folder={f} className="cursor-pointer hover:text-foreground">{f}</button>}>
                <Group>{list.filter((s) => s.folder === f).map((s) => <AccessRow key={s.id} s={s} done={reload} fresh={setFresh} />)}</Group>
              </Section>
            ))}
        </div>
      </Panel>
      <Panel title="Guests' address" icon={Globe}>
        <Group>
          {address ? <SettingRow label="Links open at" sub={<code className="break-all text-[12px]">{address}</code>} chevron={Copy} onClick={() => void copy(address)} data-shared-address />
            : <SettingRow label="No address yet" sub="Sign this Mac in to Vaultite Cloud, and the people you share with open their folders there" onClick={() => openView("connections", { newTab: true })} data-shared-address="" />}
        </Group>
      </Panel>
    </div>
  )
}

