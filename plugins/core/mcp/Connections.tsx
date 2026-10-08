// view:connections: the AI apps connected from the internet (public.ts): sign in to Vaultite Cloud (cloud.ts), a guide
// per app, let one in by its code, disconnect. Polls while shown, faster while an app is connecting.
import { useEffect, useState, type ReactNode } from "react"
import { Bot, Check, ChevronDown, Copy, ExternalLink, Plug, type LucideIcon } from "lucide-react"
import { cn, confirmDialog, copyText, del, Empty, fmtAgo, get, Group, iconNamed, Loading, notify, notifyError, op, openWebLink, Panel, post, Row, Section, SettingRow } from "@vaultite"

type Connection = { id: string; name: string; created: string; used: string | null }
type Cloud = { state: "off" | "connecting" | "connected" | "reconnecting" | "offline" | "replaced"; handle: string | null; url: string | null; connectUrl: string; message?: string }
type State = { url: string | null; cloud: Cloud; connections: Connection[]; waiting: number
  /** Apps let in by their code that haven't finished signing in: a row each, till they're connections. */
  finishing?: string[] }

function useConnections() {
  const [data, setData] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const fast = data?.cloud.state === "connecting" || !!data?.finishing?.length
  useEffect(() => {
    let on = true
    const load = () => { if (!document.hidden) get<State>("mcp/connections").then((d) => { if (on) { setData(d); setError(null) } }, (e) => on && setError(String(e?.message ?? e))) }
    load()
    const id = setInterval(load, fast ? 1500 : 5000)
    return () => { on = false; clearInterval(id) }
  }, [tick, fast])
  return { data, error, reload: () => setTick((n) => n + 1) }
}

function Connect({ waiting, onDone }: { waiting: number; onDone: () => void }) {
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!code.trim() || busy) return
    setBusy(true)
    try {
      const r = await post<{ name: string }>("mcp/connections", { code })
      notify(`${r.name} can now finish connecting`)
      setCode("")
      onDone()
    } catch (e) { notifyError(e) } finally { setBusy(false) }
  }
  return (
    <form className="flex gap-2 py-2" onSubmit={(e) => { e.preventDefault(); void send() }}>
      <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Code from Vaultite's sign-in page" aria-label="Code from the sign-in page"
        autoCapitalize="characters" autoComplete="off" spellCheck={false} data-connect-code className={field} />
      <button type="submit" disabled={!code.trim() || busy}
        className="h-9 shrink-0 cursor-pointer rounded-[8px] bg-primary px-4 text-[15px] font-medium text-primary-foreground disabled:cursor-default disabled:opacity-50">
        Connect
      </button>
      {waiting > 0 && <span className="sr-only">{waiting} waiting</span>}
    </form>
  )
}

const field = "h-9 min-w-0 flex-1 rounded-[8px] border-[0.5px] border-border bg-card px-3 font-mono text-[16px] tracking-wider outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/40"
const button = "h-9 shrink-0 cursor-pointer rounded-[8px] px-4 text-[15px] font-medium disabled:cursor-default disabled:opacity-50"
const CLOUD_STATE: Record<Cloud["state"], string> = {
  off: "Signed out", connecting: "Connecting…", connected: "Connected", reconnecting: "Reconnecting…",
  offline: "Offline, trying again", replaced: "In use on another machine",
}

/** Vaultite Cloud: sign in (its /connect page in the browser gives a code to type here), then its state and sign out. */
function CloudSection({ cloud, onDone }: { cloud: Cloud; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [entering, setEntering] = useState(false)
  const [code, setCode] = useState("")
  const run = async (id: string, params: Record<string, unknown> = {}) => {
    setBusy(true)
    try {
      await op<Cloud>(id, params)
      setEntering(false)
      setCode("")
      onDone()
    } catch (e) { notifyError(e) } finally { setBusy(false) }
  }
  // Like the guides' links: the Web viewer when it's on (the desktop app), else the browser.
  const openConnect = () => openWebLink(cloud.connectUrl)
  const signOut = async () => {
    if (!(await confirmDialog({ title: "Sign out of Vaultite Cloud?", body: "Apps connected through its address can't reach your vault until you sign in again.", confirm: "Sign out", danger: true }))) return
    await run("mcp.cloud-sign-out")
  }
  if (cloud.state === "off") {
    return (
      <Section title="Vaultite Cloud">
        <p className="pb-2 text-[15px] leading-[20px] text-muted-foreground">
          {entering ? "Sign in on the page that opened and type the code it shows. Never use a code someone sent you: it would connect this machine to their account."
            : "Gives your vault's MCP server an address of its own on vaultite.app, for Claude and ChatGPT on the web and phone, with no tunnel to set up. This machine keeps it connected."}
        </p>
        {cloud.message && !entering && <p className="pb-2 text-[15px] leading-[20px]">{cloud.message}</p>}
        {entering ? (
          <>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim() && !busy) void run("mcp.cloud-sign-in", { code }) }}>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Code from cloud.vaultite.com" aria-label="Code from Vaultite Cloud"
                autoCapitalize="characters" autoComplete="off" spellCheck={false} autoFocus className={field} data-cloud-code />
              <button type="submit" disabled={!code.trim() || busy} className={`${button} bg-primary text-primary-foreground`} data-cloud-redeem>Connect</button>
            </form>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={openConnect} className={`${button} px-2 text-primary hover:bg-foreground/[0.05]`}>Open the page again</button>
              <button type="button" onClick={() => { setEntering(false); setCode("") }} className={`${button} px-2 text-muted-foreground hover:bg-foreground/[0.05]`}>Cancel</button>
            </div>
          </>
        ) : (
          <button type="button" onClick={() => { openConnect(); setEntering(true) }} className={`${button} bg-primary text-primary-foreground`} data-cloud-sign-in>Sign in</button>
        )}
      </Section>
    )
  }
  return (
    <Section title="Vaultite Cloud">
      <Group>
        <SettingRow label={CLOUD_STATE[cloud.state]} sub={cloud.state === "connected" ? `Signed in as ${cloud.handle}` : cloud.message || `Signed in as ${cloud.handle}`} data-cloud-state={cloud.state}>
          {cloud.state === "replaced" && <button type="button" disabled={busy} onClick={() => void run("mcp.cloud-sign-in")} className="shrink-0 cursor-pointer rounded-[6px] px-2 py-1 text-[14px] text-primary hover:bg-foreground/[0.05]" data-cloud-take-over>Use this machine</button>}
          <button type="button" disabled={busy} onClick={() => void signOut()} className="shrink-0 cursor-pointer rounded-[6px] px-2 py-1 text-[14px] text-destructive hover:bg-foreground/[0.05]" data-cloud-sign-out>Sign out</button>
        </SettingRow>
      </Group>
    </Section>
  )
}

const copyAddress = (url: string) => copyText(url).then(() => notify("Copied the address", { id: "copied" }), (e) => notifyError(e))

type AppId = "claude" | "chatgpt"
/** One thing to do in the app, with what it needs: a value to copy or a page to open. */
type Step = { text: ReactNode; copy?: "name" | "address"; open?: string }
const NAME = "Vaultite"
const B = ({ children }: { children: ReactNode }) => <b className="font-semibold">{children}</b>
/** How to add the address in each app, in the order its screens ask. */
const GUIDES: Record<AppId, { name: string; icon: string; tint?: string; steps: (icon: string) => Step[] }> = {
  claude: {
    name: "Claude", icon: "claude", tint: "var(--orange)",
    steps: () => [
      { text: <>Open Claude's <B>Add custom connector</B></>, open: "https://claude.ai/customize/connectors?modal=add-custom-connector" },
      { text: <>Name it <B>{NAME}</B></>, copy: "name" },
      { text: <>Paste the address as its <B>MCP server URL</B>, then <B>Continue</B></>, copy: "address" },
      { text: <>Keep the defaults, scroll down and choose <B>Add</B></> },
      { text: <>Choose <B>Connect</B>: Vaultite's sign-in page shows a code. Type it below.</> },
      { text: <>It's connected when Vaultite has a check in <B>Connectors</B>, <B>Yours</B></>, open: "https://claude.ai/customize/connectors/yours" },
    ],
  },
  chatgpt: {
    name: "ChatGPT", icon: "openai",
    steps: (icon) => [
      { text: <>Open ChatGPT's <B>Plugins</B>, then <B>Add</B>, <B>Create custom MCP server</B></>, open: "https://chatgpt.com/plugins" },
      { text: <>Name it <B>{NAME}</B></>, copy: "name" },
      { text: <>Paste the address as its <B>Server URL</B></>, copy: "address" },
      { text: <>Add <a className="text-primary" href={icon} target="_blank" rel="noreferrer" data-connector-icon>Vaultite's icon</a> if you like (save it, then choose it as the <B>Icon</B>)</> },
      { text: <>Keep <B>OAuth</B>, tick <B>I understand</B> and choose <B>Create as a plugin</B></> },
      { text: <>Sign in when it asks: Vaultite's sign-in page shows a code. Type it below.</> },
      { text: <>It's connected when Vaultite is in <B>Settings</B>, <B>Plugins</B></>, open: "https://chatgpt.com/settings/plugins-settings" },
    ],
  },
}

function Guide({ id, address }: { id: AppId; address: string }) {
  const g = GUIDES[id]
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (what: "name" | "address") => copyText(what === "name" ? NAME : address)
    .then(() => { setCopied(what); setTimeout(() => setCopied((c) => (c === what ? null : c)), 1500) }, (e) => notifyError(e))
  return (
    <ol className="flex flex-col gap-1 py-3" data-guide={id}>
      {g.steps(address.replace(/\/mcp$/, "/icon.png")).map((s, i) => (
        <li key={i} className="flex min-h-9 items-center gap-3 text-[15px] leading-[20px]">
          <span className="grid size-5.5 shrink-0 place-items-center rounded-full bg-foreground/[0.08] text-[12px] font-semibold">{i + 1}</span>
          <span className="min-w-0 flex-1">{s.text}</span>
          {s.copy && (
            <button type="button" onClick={() => void copy(s.copy!)} className={small} data-guide-copy={s.copy}>
              {copied === s.copy ? <Check className="size-3.5" strokeWidth={2.5} /> : <Copy className="size-3.5" />}{copied === s.copy ? "Copied" : s.copy === "name" ? "Copy name" : "Copy address"}
            </button>
          )}
          {s.open && <a href={s.open} target="_blank" rel="noreferrer" className={small} data-guide-open>Open<ExternalLink className="size-3.5" /></a>}
        </li>
      ))}
    </ol>
  )
}

/** Claude and ChatGPT, each a button that opens its steps. */
function ConnectApp({ address }: { address: string }) {
  const [open, setOpen] = useState<AppId | null>(null)
  return (
    <>
      <div className="flex gap-2 pt-1">
        {(Object.keys(GUIDES) as AppId[]).map((id) => {
          const g = GUIDES[id], Icon: LucideIcon = iconNamed(g.icon) ?? Bot, on = open === id
          return (
            <button key={id} type="button" aria-expanded={on} onClick={() => setOpen(on ? null : id)} data-guide-for={id}
              className={cn("flex h-11 flex-1 cursor-pointer items-center gap-2.5 rounded-[10px] border-[0.5px] px-3 text-[15px] font-medium",
                on ? "border-primary bg-primary/[0.06]" : "border-border hover:bg-foreground/[0.04]")}>
              <Icon className="size-5 shrink-0" style={g.tint ? { color: g.tint } : undefined} />Set up {g.name}
              <ChevronDown className={cn("ml-auto size-4 text-tertiary transition-transform", on && "rotate-180")} strokeWidth={2.5} />
            </button>
          )
        })}
      </div>
      {open && <Guide key={open} id={open} address={address} />}
    </>
  )
}
const small = "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-[6px] border-[0.5px] border-border px-2.5 text-[13px] font-medium hover:bg-foreground/[0.05]"

export function ConnectionsView() {
  const { data, error, reload } = useConnections()
  if (!data) return <div className="mx-auto w-full max-w-[640px] p-4"><Loading error={error} /></div>
  const finishing = data.finishing ?? []
  const disconnect = async (c: Connection) => {
    if (!(await confirmDialog({ title: `Disconnect ${c.name}?`, body: "It can't read or write your vault until you connect it again.", confirm: "Disconnect", danger: true }))) return
    try { await del(`mcp/connections/${encodeURIComponent(c.id)}`); reload() } catch (e) { notifyError(e) }
  }
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 p-4" data-connections>
      <Panel title="Connections" icon={Plug}>
        <div className="flex flex-col gap-4">
          <CloudSection cloud={data.cloud} onDone={reload} />
          {(data.url || data.cloud.url) && (
            <Section title="Connect an app">
              <Group>
                {data.cloud.url && <SettingRow label="Address" sub={<code className="break-all text-[12px]">{data.cloud.url}</code>} chevron={Copy} onClick={() => void copyAddress(data.cloud.url!)} data-cloud-url />}
                {data.url && <SettingRow label={data.cloud.url ? "Your tunnel's address" : "Address"} sub={<code className="break-all text-[12px]">{data.url}</code>} chevron={Copy} onClick={() => void copyAddress(data.url!)} />}
              </Group>
              <ConnectApp address={(data.cloud.url ?? data.url)!} />
              <Connect waiting={data.waiting} onDone={reload} />
            </Section>
          )}
          {(data.url || data.cloud.url || data.connections.length > 0) && (
            <Section title="Connected">
              {data.connections.length || finishing.length ? (
                <Group>
                  {data.connections.map((c) => (
                    <Row key={c.id} title={c.name} meta={`Connected ${fmtAgo(c.created)}${c.used ? `, used ${fmtAgo(c.used)}` : ""}`}
                      right={<button type="button" onClick={() => void disconnect(c)} className="cursor-pointer rounded-[6px] px-2 py-1 text-[14px] text-destructive hover:bg-foreground/[0.05]">Disconnect</button>} />
                  ))}
                  {finishing.map((name, i) => (
                    <Row key={`finishing-${i}`} title={name} meta={<span className="shimmer">Finishing connecting…</span>} aria-busy data-connection-finishing />
                  ))}
                </Group>
              ) : <Empty>No app is connected.</Empty>}
            </Section>
          )}
        </div>
      </Panel>
    </div>
  )
}
