// view:connections: the four AI apps as cards, each a sheet with its steps (signing in to Vaultite Cloud first when needed,
// cloud.ts) and the code field; what's connected (public.ts); the account and addresses last. Polls, faster while connecting.
import { useEffect, useState, type ReactNode } from "react"
import { Bot, Check, ChevronRight, Copy, ExternalLink, Plug, type LucideIcon } from "lucide-react"
import { confirmDialog, copyText, del, detailPath, fmtAgo, get, Group, iconNamed, Loading, notify, notifyError, op, openDetail, openWebLink, Panel, post, Row, Section, SettingRow, SheetHead, Switch } from "@vaultite"

type Connection = { id: string; name: string; created: string; used: string | null }
type Cloud = { state: "off" | "connecting" | "connected" | "reconnecting" | "offline" | "replaced"; handle: string | null; url: string | null; app?: string | null; connectUrl: string; message?: string }
type State = { url: string | null; cloud: Cloud; connect?: { ownerTools: boolean }; connections: Connection[]; waiting: number
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

/** Signing in to Vaultite Cloud: its /connect page in the browser gives a code to type here. */
function CloudSignIn({ cloud, onDone, intro }: { cloud: Cloud; onDone: () => void; intro: string }) {
  const [busy, setBusy] = useState(false)
  const [entering, setEntering] = useState(false)
  const [code, setCode] = useState("")
  const redeem = async () => {
    setBusy(true)
    try { await op<Cloud>("mcp.cloud-sign-in", { code }); setEntering(false); setCode(""); onDone() } catch (e) { notifyError(e) } finally { setBusy(false) }
  }
  // Like the guides' links: the Web viewer when it's on (the desktop app), else the browser.
  const openConnect = () => openWebLink(cloud.connectUrl)
  return (
    <>
      <p className="pb-2 text-[15px] leading-[20px] text-muted-foreground">
        {entering ? "Sign in on the page that opened and type the code it shows. Never use a code someone sent you: it would connect this machine to their account." : intro}
      </p>
      {cloud.message && !entering && <p className="pb-2 text-[15px] leading-[20px]">{cloud.message}</p>}
      {entering ? (
        <>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim() && !busy) void redeem() }}>
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
    </>
  )
}

const CLOUD_INTRO = "Gives your vault an address on vaultite.app, so AI apps on the web and your phone reach it while this machine is on. Free, with no tunnel to set up."

/** Vaultite Cloud, last on the page: signed out, a sign-in; else its state, the addresses and sign out. */
function CloudSection({ data, onDone }: { data: State; onDone: () => void }) {
  const { cloud } = data
  const [busy, setBusy] = useState(false)
  const run = async (id: string) => {
    setBusy(true)
    try { await op<Cloud>(id); onDone() } catch (e) { notifyError(e) } finally { setBusy(false) }
  }
  const signOut = async () => {
    if (!(await confirmDialog({ title: "Sign out of Vaultite Cloud?", body: "Apps connected through its address can't reach your vault until you sign in again.", confirm: "Sign out", danger: true }))) return
    await run("mcp.cloud-sign-out")
  }
  return (
    <Section title="Vaultite Cloud">
      {cloud.state === "off" ? <CloudSignIn cloud={cloud} onDone={onDone} intro={CLOUD_INTRO} /> : (
        <Group>
          <SettingRow label={CLOUD_STATE[cloud.state]} sub={cloud.state === "connected" ? `Signed in as ${cloud.handle}` : cloud.message || `Signed in as ${cloud.handle}`} data-cloud-state={cloud.state}>
            {cloud.state === "replaced" && <button type="button" disabled={busy} onClick={() => void run("mcp.cloud-sign-in")} className="shrink-0 cursor-pointer rounded-[6px] px-2 py-1 text-[14px] text-primary hover:bg-foreground/[0.05]" data-cloud-take-over>Use this machine</button>}
            <button type="button" disabled={busy} onClick={() => void signOut()} className="shrink-0 cursor-pointer rounded-[6px] px-2 py-1 text-[14px] text-destructive hover:bg-foreground/[0.05]" data-cloud-sign-out>Sign out</button>
          </SettingRow>
          {cloud.url && <SettingRow label="MCP address" sub={<code className="break-all text-[12px]">{cloud.url}</code>} chevron={Copy} onClick={() => void copyAddress(cloud.url!)} data-cloud-url />}
        </Group>
      )}
      {data.url && <Group><SettingRow label="Your tunnel's address" sub={<code className="break-all text-[12px]">{data.url}</code>} chevron={Copy} onClick={() => void copyAddress(data.url!)} /></Group>}
    </Section>
  )
}

/** Connect: the whole app at the handle's address, for its owner, while this Mac is on. */
function AppAddress({ app, ownerTools, onDone }: { app: string; ownerTools: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const turn = async (on: boolean) => {
    setBusy(true)
    try { await post("mcp/connect", { ownerTools: on }); onDone() } catch (e) { notifyError(e) } finally { setBusy(false) }
  }
  return (
    <Section title="Open from anywhere">
      <p className="pb-2 text-[15px] leading-[20px]" data-connect-app>
        Your phone and any browser can now reach this Mac's Vaultite at this address while the Mac is on. Sign in there with your Vaultite account.
      </p>
      <Group>
        <SettingRow label="Address" sub={<code className="break-all text-[12px]">{app}</code>} chevron={ExternalLink} onClick={() => openWebLink(app)} data-connect-url />
        <SettingRow label="Terminals and coding agents" sub="Off: over this address the app doesn't run anything on this Mac">
          <Switch on={ownerTools} onChange={(on) => void turn(on)} label="Terminals and coding agents over this address" disabled={busy} />
        </SettingRow>
      </Group>
    </Section>
  )
}

const copyAddress = (url: string) => copyText(url).then(() => notify("Copied the address", { id: "copied" }), (e) => notifyError(e))

export type AppId = "claude" | "chatgpt" | "grok-bot" | "muse"
/** One thing to do in the app, with what it needs: a text to copy or a page to open. */
type Step = { text: ReactNode; copy?: { label: string; value: string }; open?: string }
const NAME = "Vaultite"
const B = ({ children }: { children: ReactNode }) => <b className="font-semibold">{children}</b>
const RESULTS = "When you finish a task, save the result to my Vaultite inbox with inbox_add."
/** How to add the address in each app, in the order its screens ask. Grok Bot and Muse add it when asked in a chat. */
const GUIDES: Record<AppId, { name: string; icon: string; tint?: string; sub: string; match: RegExp; steps: (address: string, icon: string) => Step[] }> = {
  claude: {
    name: "Claude", icon: "claude", tint: "var(--orange)", match: /claude|anthropic/i, sub: "On the web, the desktop app and the phone, once added on the web.",
    steps: (address) => [
      { text: <>Open Claude's <B>Add custom connector</B></>, open: "https://claude.ai/customize/connectors?modal=add-custom-connector" },
      { text: <>Name it <B>{NAME}</B></>, copy: { label: "Copy name", value: NAME } },
      { text: <>Paste the address as its <B>MCP server URL</B>, then <B>Continue</B></>, copy: { label: "Copy address", value: address } },
      { text: <>Keep the defaults, scroll down and choose <B>Add</B></> },
      { text: <>Choose <B>Connect</B>: Vaultite's sign-in page shows a code. Type it below.</> },
      { text: <>It's connected when Vaultite shows <B>Connected</B> in <B>Customize</B>, <B>Connectors</B>, <B>Yours</B></>, open: "https://claude.ai/customize/connectors/yours" },
    ],
  },
  chatgpt: {
    name: "ChatGPT", icon: "openai", match: /chatgpt|openai/i, sub: "On the web and the phone, once added on the web.",
    steps: (address, icon) => [
      { text: <>Open ChatGPT's <B>Plugins</B>, then <B>Add</B>, <B>Add custom MCP server</B></>, open: "https://chatgpt.com/plugins" },
      { text: <>Name it <B>{NAME}</B></>, copy: { label: "Copy name", value: NAME } },
      { text: <>Paste the address as its <B>Server URL</B></>, copy: { label: "Copy address", value: address } },
      { text: <>Add <a className="text-primary" href={icon} target="_blank" rel="noreferrer" data-connector-icon>Vaultite's icon</a> if you like (save it, then choose it as the <B>Icon</B>)</> },
      { text: <>Keep <B>OAuth</B>, tick <B>I understand</B> and choose <B>Create as a plugin</B></> },
      { text: <>Sign in when it asks: Vaultite's sign-in page shows a code. Type it below.</> },
      { text: <>It's connected when Vaultite is in <B>Settings</B>, <B>Plugins</B></>, open: "https://chatgpt.com/settings/plugins-settings" },
    ],
  },
  muse: {
    name: "Muse", icon: "muse", tint: "var(--blue)", match: /muse/i, sub: "On the web, the phone and WhatsApp.",
    steps: (address) => [
      { text: <>In Muse, send this in a chat</>, copy: { label: "Copy message", value: `Add a custom connector called ${NAME}: a remote MCP server at ${address} (streamable HTTP, OAuth).` }, open: "https://muse.ai" },
      { text: <>Choose <B>Connect</B> on the Vaultite card it posts, then <B>Connect</B> again: Vaultite's sign-in page shows a code. Type it below.</> },
      { text: <>Muse asks before each request to your vault: <B>Always allow</B> stops the questions</> },
      { text: <>For what it finds to land in your inbox, send this too</>, copy: { label: "Copy message", value: RESULTS } },
    ],
  },
  "grok-bot": {
    name: "Grok Bot", icon: "grok-bot", match: /grok/i, sub: "Every bot on your account gets it.",
    steps: (address) => [
      { text: <>Open the Grok Bot app and send this in a chat</>, copy: { label: "Copy message", value: `Add a custom MCP server called ${NAME} at ${address}` } },
      { text: <>Choose <B>Add it</B> when it shows the name and address</> },
      { text: <>Choose <B>Authorize</B> on the card it posts: Vaultite's sign-in page shows a code. Type it below.</> },
      { text: <>For what it finds to land in your inbox, send this too</>, copy: { label: "Copy message", value: RESULTS } },
    ],
  },
}

function Guide({ id, address }: { id: AppId; address: string }) {
  const [copied, setCopied] = useState<number | null>(null)
  const copy = (i: number, value: string) => copyText(value)
    .then(() => { setCopied(i); setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500) }, (e) => notifyError(e))
  return (
    <ol className="flex flex-col gap-1" data-guide={id}>
      {GUIDES[id].steps(address, address.replace(/\/mcp$/, "/icon.png")).map((s, i) => (
        <li key={i} className="flex min-h-9 items-center gap-3 text-[15px] leading-[20px]">
          <span className="grid size-5.5 shrink-0 place-items-center rounded-full bg-foreground/[0.08] text-[12px] font-semibold">{i + 1}</span>
          <span className="min-w-0 flex-1">{s.text}</span>
          {s.copy && (
            <button type="button" onClick={() => void copy(i, s.copy!.value)} className={small} data-guide-copy>
              {copied === i ? <Check className="size-3.5" strokeWidth={2.5} /> : <Copy className="size-3.5" />}{copied === i ? "Copied" : s.copy.label}
            </button>
          )}
          {s.open && <a href={s.open} target="_blank" rel="noreferrer" className={small} data-guide-open>Open<ExternalLink className="size-3.5" /></a>}
        </li>
      ))}
    </ol>
  )
}

/** The sheet's detail path (`details` in index.tsx): connect-app/<app>. */
export const SETUP_DETAIL = "connect-app"
export const APPS = Object.keys(GUIDES) as AppId[]
export const setupTitle = (id: string) => (id in GUIDES ? `Set up ${GUIDES[id as AppId].name}` : "Set up an app")
export const appIcon = (id: AppId): LucideIcon => iconNamed(GUIDES[id].icon) ?? Bot
/** The connection an app made, by the name it signed in with. */
const connectionOf = (id: AppId, cs: Connection[]) => cs.find((c) => GUIDES[id].match.test(c.name))

/** An app's steps in a sheet: Vaultite Cloud's sign-in first when there's no address yet, then the steps and the code field. */
export function SetupSheet({ id }: { id: AppId }) {
  const { data, error, reload } = useConnections()
  const g = GUIDES[id]
  if (!g) return null
  const address = data ? data.cloud.url ?? data.url : null
  const done = data && connectionOf(id, data.connections)
  return (
    <div data-setup={id}>
      <SheetHead icon={appIcon(id)} tint={g.tint ?? "var(--foreground)"} kicker="Connections" title={setupTitle(id)} sub={g.sub} />
      {!data ? <Loading error={error} /> : (
        <div className="flex flex-col gap-4">
          {done && <Group><Row title={`${g.name} is connected`} meta={`Connected ${fmtAgo(done.created)}${done.used ? `, used ${fmtAgo(done.used)}` : ""}`} data-setup-connected /></Group>}
          {address ? (
            <>
              <Section title="Steps"><Guide id={id} address={address} /></Section>
              <Section title="Code"><Connect waiting={data.waiting} onDone={reload} /></Section>
              {!!data.finishing?.length && (
                <Group>{data.finishing.map((name, i) => <Row key={i} title={name} meta={<span className="shimmer">Finishing connecting…</span>} aria-busy data-connection-finishing />)}</Group>
              )}
            </>
          ) : (
            <Section title="First, an address for your vault">
              <CloudSignIn cloud={data.cloud} onDone={reload} intro={`${g.name} reaches your vault at an address on vaultite.app. Sign in to Vaultite Cloud (free) to get yours, then come back here for ${g.name}'s steps.`} />
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

/** The four apps as cards: each says whether it's connected and opens its steps. */
export function AppCards({ connections, size = "md" }: { connections: Connection[]; size?: "sm" | "md" }) {
  return (
    <div className="grid grid-cols-2 gap-2" data-app-cards>
      {APPS.map((id) => {
        const g = GUIDES[id], Icon = appIcon(id), on = !!connectionOf(id, connections)
        return (
          <button key={id} type="button" onClick={() => openDetail(detailPath(SETUP_DETAIL, id))} data-guide-for={id} data-app-connected={on || undefined}
            className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-[10px] border-[0.5px] border-border px-2.5 text-left md:gap-2.5 md:px-3 hover:bg-foreground/[0.04] ${size === "sm" ? "h-10" : "h-14"}`}>
            <Icon className="size-5 shrink-0" style={g.tint ? { color: g.tint } : undefined} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium" data-app-name>{g.name}</span>
              {size === "md" && <span className={`block truncate text-[13px] ${on ? "text-[var(--green)]" : "text-muted-foreground"}`}>{on ? "Connected" : "Set up"}</span>}
            </span>
            {on ? <Check className="size-4 shrink-0 text-[var(--green)]" strokeWidth={2.5} /> : <ChevronRight className="size-4 shrink-0 text-tertiary max-md:hidden" strokeWidth={2.5} />}
          </button>
        )
      })}
    </div>
  )
}
const small = "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-[6px] border-[0.5px] border-border px-2.5 text-[13px] font-medium hover:bg-foreground/[0.05]"

/** A blank tab's section until an app is connected: the cards, small. */
export function ConnectSection() {
  const { data } = useConnections()
  if (!data || data.connections.length) return null
  return (
    <div className="flex flex-col gap-1.5 pb-2" data-newtab-connect>
      <div className="pl-1.5 text-[12px] font-semibold text-muted-foreground">Connect your AI</div>
      <AppCards connections={[]} size="sm" />
    </div>
  )
}

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
          <Section title="AI apps">
            <p className="pb-3 text-[15px] leading-[20px] text-muted-foreground">Tell them what happened and it lands in your vault, from the web, their desktop apps and your phone.</p>
            <AppCards connections={data.connections} />
            {(data.url || data.cloud.url) && <Connect waiting={data.waiting} onDone={reload} />}
          </Section>
          {(data.connections.length > 0 || finishing.length > 0) && (
            <Section title="Connected">
              <Group>
                {data.connections.map((c) => (
                  <Row key={c.id} title={c.name} meta={`Connected ${fmtAgo(c.created)}${c.used ? `, used ${fmtAgo(c.used)}` : ""}`}
                    right={<button type="button" onClick={() => void disconnect(c)} className="cursor-pointer rounded-[6px] px-2 py-1 text-[14px] text-destructive hover:bg-foreground/[0.05]">Disconnect</button>} />
                ))}
                {finishing.map((name, i) => (
                  <Row key={`finishing-${i}`} title={name} meta={<span className="shimmer">Finishing connecting…</span>} aria-busy data-connection-finishing />
                ))}
              </Group>
            </Section>
          )}
          {data.cloud.app && data.cloud.state === "connected" && <AppAddress app={data.cloud.app} ownerTools={!!data.connect?.ownerTools} onDone={reload} />}
          <CloudSection data={data} onDone={reload} />
        </div>
      </Panel>
    </div>
  )
}
