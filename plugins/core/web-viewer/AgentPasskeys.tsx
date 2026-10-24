// Passkeys that approve agents' logins on this Mac (electron/browser/logins.ts): the list, and adding one from a phone,
// whose Safari opens this server's page by a QR code (plugins/core/web-viewer/approvals.ts) and Touch ID here confirms it.
import { useCallback, useEffect, useState } from "react"
import { KeyRound, Plus, Trash2 } from "lucide-react"
import { Button, dateText, Empty, get, notifyError, PageHeader, Panel, webPages } from "@vaultite"
import { Qr } from "./Passkey"

type Key = { id: string; name: string; site: string; added: number }
const DAY: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }
const engine = <T,>(name: string, ...args: unknown[]) => Promise.resolve(webPages?.engine?.(name, ...args)) as Promise<T>

export function AgentPasskeys() {
  const [keys, setKeys] = useState<Key[] | null>(null)
  const [adding, setAdding] = useState<{ url: string } | { error: string } | null>(null)
  const read = useCallback(() => void engine<Key[]>("logins:passkeys").then((k) => setKeys(Array.isArray(k) ? k : []), () => setKeys([])), [])
  useEffect(read, [read])
  // (a passkey added from the phone: the list shows it, the QR code goes)
  useEffect(() => webPages?.on((m) => { if (m.type === "engine:logins:passkeys") { read(); setAdding(null) } }), [read])
  const add = async () => {
    try {
      const [{ url }, { token }] = await Promise.all([get("web-viewer/https") as Promise<{ url: string }>, engine<{ token: string }>("logins:passkey-start")])
      setAdding(url ? { url: `${url}/api/web-viewer/passkey?token=${token}` }
        : { error: "Your phone reaches this Mac's Vaultite over https on your tailnet, which isn't served yet: run tailscale serve --https=8447 8793 here (8793: Vaultite's port), then add one." })
    } catch (e) { notifyError(e, "Couldn't start adding a passkey") }
  }
  const remove = (k: Key) => void engine("logins:passkey-remove", k.id).catch((e) => notifyError(e, "Couldn't remove it"))
  return (
    <div className="mx-auto max-w-[640px] px-4 pt-2 pb-10" data-agent-passkeys>
      <PageHeader title="Passkeys for agents' logins" subtitle="An agent logging in with an entry not tagged agent-free waits for your yes, given with one of these" />
      {keys === null ? null : !keys.length ? <Empty>None yet. Add one from your phone: it then approves agents' logins with Face ID.</Empty> : (
        <Panel className="py-1">
          <div className="flex flex-col [&>:where(:not(:first-child))]:border-t-[0.5px] [&>:where(:not(:first-child))]:border-border">
            {keys.map((k) => (
              <div key={k.id} className="flex min-h-12 items-center gap-3 py-1.5" data-agent-passkey={k.name}>
                <KeyRound className="size-5 shrink-0 text-muted-foreground" strokeWidth={2} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] leading-[20px] font-medium md:text-[14px]">{k.name}</div>
                  <div className="truncate text-[13px] text-muted-foreground md:text-[12px]">{k.site} · added {dateText(k.added, DAY)}</div>
                </div>
                <button type="button" aria-label={`Remove ${k.name}`} data-tip="Remove" onClick={() => remove(k)}
                  className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
                  <Trash2 className="size-4" strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}
      {adding && "url" in adding ? (
        <div className="mt-4 flex flex-col items-center text-center" data-agent-passkey-add={adding.url}>
          <p className="text-[13px] text-muted-foreground">Scan this with your phone's camera: Safari opens a page to add a passkey, then confirm here with Touch ID. The code works once, for 10 minutes.</p>
          <Qr text={adding.url} />
          <Button look="quiet" size="small" className="mt-2" onClick={() => setAdding(null)}>Cancel</Button>
        </div>
      ) : adding ? <p className="mt-4 text-[13px] text-muted-foreground">{adding.error}</p> : (
        <div className="mt-3"><Button look="quiet" size="small" onClick={() => void add()} data-agent-passkey-new><Plus className="size-4" strokeWidth={2} />Add a passkey…</Button></div>
      )}
    </div>
  )
}
