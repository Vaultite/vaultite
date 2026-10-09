// view:publish: what's on the user's site, each note's page, Publish changes, and the plan it needs (bought in a
// browser, never in the app; nothing about plans in the iPhone app).
import { useEffect, useState } from "react"
import { ExternalLink, Globe } from "lucide-react"
import { confirmDialog, Empty, Group, inPhoneApp, Loading, notify, notifyError, op, openFile, openView, openWebLink, Panel, Row, Section } from "@vaultite"

export type Listed = {
  url: string | null; entitled: boolean | null; billing: string | null; items: string[]; warnings: string[]; error?: string
  pages: { path: string; title: string; slug: string; url: string | null; state: "published" | "changed" | "new" | "unknown" }[]
}
type Pushed = { url: string; pages: number; changed: number; images: number; removed: number }

const STATE = { published: "Published", changed: "Changed since published", new: "Not sent yet", unknown: "Not checked" }
const button = "h-9 shrink-0 cursor-pointer rounded-[8px] px-4 text-[15px] font-medium disabled:cursor-default disabled:opacity-50"
const small = "cursor-pointer rounded-[6px] px-2 py-1 text-[14px] hover:bg-foreground/[0.05]"

/** Buying happens in the browser (window.open goes there from the desktop app too). */
export const openBilling = (url: string) => { window.open(url, "_blank", "noopener,noreferrer") }

export async function publish(path: string, folder = false) {
  try {
    const r = await op<{ url: string | null }>("publish.add", { path })
    notify(`Published ${folder ? "the folder" : "it"}`, r.url ? { action: { label: "Open", run: () => openWebLink(r.url!) } } : {})
  } catch (e) {
    const billing = /get one in your browser at (\S+)/.exec(String((e as Error)?.message ?? ""))?.[1]
    if (billing && !inPhoneApp()) notify("Publishing needs a Publish plan", { kind: "error", action: { label: "Get Publish", run: () => openBilling(billing) } })
    else notifyError(e, "Couldn't publish")
  }
}

export async function unpublish(path: string, name: string) {
  if (!(await confirmDialog({ title: `Unpublish ${name}?`, body: "Its pages come off your site; links to them stop working.", confirm: "Unpublish" }))) return
  try {
    const r = await op<{ error?: string }>("publish.remove", { path })
    if (r.error) notify(`Unpublished here, but the site isn't updated: ${r.error}`, { kind: "error" })
    else notify(`Unpublished ${name}`)
  } catch (e) { notifyError(e, "Couldn't unpublish") }
}

export async function publishChanges() {
  try {
    const r = await op<Pushed>("publish.sync")
    notify(r.changed || r.removed ? `Published ${r.changed} ${r.changed === 1 ? "change" : "changes"}` : "Your site is up to date", { action: { label: "Open", run: () => openWebLink(r.url) } })
  } catch (e) { notifyError(e, "Couldn't publish") }
}

export function PublishedView() {
  const [data, setData] = useState<Listed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let on = true
    op<Listed>("publish.list").then((d) => { if (on) { setData(d); setError(null) } }, (e) => on && setError(String(e?.message ?? e)))
    return () => { on = false }
  }, [tick])
  if (!data) return <div className="mx-auto w-full max-w-[640px] p-4"><Loading error={error} /></div>
  const reload = () => setTick((n) => n + 1)
  const sync = async () => { setBusy(true); try { await publishChanges() } finally { setBusy(false); reload() } }
  const unsent = data.pages.filter((p) => p.state === "changed" || p.state === "new").length
  const remove = async (item: string) => { await unpublish(item, item.split("/").pop() ?? item); reload() }
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 p-4" data-published>
      <Panel title="Published" icon={Globe}>
        <div className="flex flex-col gap-4">
          {data.error ? <Empty>{data.error}{/signed in/i.test(data.error) && <> <button type="button" className="cursor-pointer text-primary hover:underline" onClick={() => openView("connections", { newTab: true })}>Open connections</button></>}</Empty>
            : data.entitled === false ? (
              <div className="flex items-center gap-3">
                <p className="flex-1 text-[15px] leading-[20px] text-muted-foreground">Publishing your notes as a website needs a Publish plan on your Vaultite Cloud account.</p>
                {data.billing && !inPhoneApp() && <button type="button" onClick={() => openBilling(data.billing!)} className={`${button} bg-primary text-primary-foreground`} data-publish-plan>Get Publish</button>}
              </div>
            ) : data.url && (
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => openWebLink(data.url!)} className="min-w-0 flex-1 cursor-pointer truncate text-left text-[15px] text-primary hover:underline" data-publish-site>{data.url.replace(/^https:\/\//, "")}</button>
                <button type="button" disabled={busy} onClick={() => void sync()} className={`${button} ${unsent ? "bg-primary text-primary-foreground" : "border-[0.5px] border-border"}`} data-publish-sync>
                  {busy ? "Publishing…" : unsent ? `Publish ${unsent} ${unsent === 1 ? "change" : "changes"}` : "Publish again"}
                </button>
              </div>
            )}
          <Section title="Chosen">
            {data.items.length ? (
              <Group>
                {data.items.map((item) => (
                  <Row key={item} title={item} meta={data.pages.some((p) => p.path === `${item}.md`) ? "Note" : `Folder, ${data.pages.filter((p) => p.path.startsWith(`${item}/`)).length} notes`}
                    right={<button type="button" onClick={() => void remove(item)} className={`${small} text-destructive`}>Unpublish</button>} />
                ))}
              </Group>
            ) : <Empty>Nothing yet. Publish a note or a folder from its menu.</Empty>}
          </Section>
          {data.pages.length > 0 && (
            <Section title="Pages">
              <Group>
                {data.pages.map((p) => (
                  <Row key={p.path} title={p.title} meta={`${p.path} · ${STATE[p.state]}`} onOpen={() => openFile(p.path)}
                    right={p.url && p.state !== "new" ? <button type="button" onClick={(e) => { e.stopPropagation(); openWebLink(p.url!) }} data-tip="Open the page" className={small}><ExternalLink className="size-4" /></button> : undefined} />
                ))}
              </Group>
            </Section>
          )}
          {data.warnings.map((w) => <Empty key={w}>{w}</Empty>)}
        </div>
      </Panel>
    </div>
  )
}
