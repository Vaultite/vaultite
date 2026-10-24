// Sharing's app side: Share… in a folder's menu opens its sheet, as shared documents have it: a link for one person (their
// name, what they may do, for how long), shown once to copy, and who has access, to remove.
import { useEffect, useState } from "react"
import { Check, Copy, Share2 } from "lucide-react"
import { Button, confirmDialog, copyText, dateText, definePlugin, detailPath, Empty, fmtAgo, Group, Loading, notify, notifyError, op, openDetail, Row, Section, Segmented, SettingRow, SheetHead, share } from "@vaultite"

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
  return (
    <div className="flex flex-col gap-5" data-share-sheet={folder}>
      <SheetHead icon={Share2} tint="var(--primary)" title={`Share ${name(folder)}`}
        sub="Each person gets a link of their own: they see this folder and nothing else of your vault, and no agent works for them." />
      <NewLink folder={folder} made={() => setAgain((n) => n + 1)} />
      <Section title="People with access">
        {!list ? <Loading error={error} />
          : !list.length ? <Empty>Nobody yet.</Empty>
          : <Group>{list.map((s) => (
            <Row key={s.id} title={s.guest} data-share-row={s.id}
              meta={[ROLES.find((r) => r.value === s.role)?.label, s.expired ? "expired" : `until ${dateText(new Date(s.expires), DAY)}`, s.used ? `opened ${fmtAgo(s.used)}` : "not opened yet"].join(" · ")}
              right={<button type="button" onClick={() => void remove(s)} className="cursor-pointer text-[14px] text-destructive" data-share-remove>Remove</button>} />
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
      setLink({ guest: r.guest, url: r.link }); setGuest(""); setCopied(false); made()
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

export default definePlugin({
  details: { share: { title: (_s, [folder]) => `Share ${name(folder ?? "")}`, render: (_s, [folder]) => <ShareSheet folder={folder ?? ""} /> } },
  folderMenu: (path) => (shareable(path) ? [{ label: "Share…", icon: Share2, section: "share", run: () => openDetail(detailPath("share", path)) }] : []),
})
