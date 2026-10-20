// Connections (public.ts, cloud.ts): AiApps lists the apps, each opening its setup steps or, once connected, its page
// (access, activity, rename, disconnect); RemoteAccess is Vaultite Cloud and the addresses. Polls, faster while connecting.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { Bot, Check, Copy, ExternalLink, Globe, KeyRound, Plug, Plus, type LucideIcon } from "lucide-react"
import { Button, backDetail, confirmDialog, copyText, del, detailPath, Empty, fmtAgo, Group, iconNamed, Loading, LoadingRows, notify, notifyError, op, openDetail, openFile, openView, openWebLink, Panel, patch, plural, post, Row, Section, Segmented, SettingRow, SheetHead, Switch, useEnabled, useKeptCount, useLive } from "@vaultite"

type Access = "read" | "write"
/** `actor`: the name Activity gives what it does. */
type Connection = { id: string; name: string; created: string; used: string | null; access: Access; actor: string }
type Cloud = { state: "off" | "connecting" | "connected" | "reconnecting" | "offline" | "replaced"; handle: string | null; url: string | null; app?: string | null; connectUrl: string; message?: string }
type State = { url: string | null; cloud: Cloud; connect?: { ownerTools: boolean }; connections: Connection[]; waiting: number
  /** The apps whose sign-in page waits for its code. */
  asking?: string[]
  /** Apps let in by their code that haven't finished signing in: a row each, till they're connections. */
  finishing?: string[] }

/** The last answer, for a sheet's title (details' titles are drawn from what's at hand). */
let lastState: State | null = null

// One version for every list and sheet: after a change each asks anew, and a sheet opened later never gets an older answer.
let asked = 0
const askers = new Set<() => void>()
const askAgain = () => { asked++; askers.forEach((f) => f()) }
const onAsk = (f: () => void) => { askers.add(f); return () => { askers.delete(f) } }

function useConnections() {
  const version = useSyncExternalStore(onAsk, () => asked)
  const [fast, setFast] = useState(false)
  const live = useLive<State>("mcp/connections", version, undefined, fast ? 1500 : 5000)
  if (live.data) lastState = live.data
  const connecting = live.data?.cloud.state === "connecting" || !!live.data?.finishing?.length || !!live.data?.waiting
  if (connecting !== fast) setFast(connecting)
  return { ...live, reload: askAgain }
}

/** The code field; in an app's sheet (`as`), the connection takes that app's name, whatever it signs in as. */
function Connect({ waiting, onDone, as }: { waiting: number; onDone: () => void; as?: string }) {
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!code.trim() || busy) return
    setBusy(true)
    try {
      const r = await post<{ name: string }>("mcp/connections", { code, as })
      notify(`${r.name} can now finish connecting`)
      setCode("")
      onDone()
    } catch (e) { notifyError(e) } finally { setBusy(false) }
  }
  return (
    <form className="flex gap-2 py-2" onSubmit={(e) => { e.preventDefault(); void send() }}>
      <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Sign-in code" aria-label="Code from the sign-in page"
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
            <Button look="primary" className="h-9 px-4 md:h-9 md:text-[15px]" type="submit" disabled={!code.trim() || busy} data-cloud-redeem>Connect</Button>
          </form>
          <div className="flex gap-2 pt-1">
            <Button look="quiet" className="h-9 px-2 text-primary md:h-9 md:text-[15px]" onClick={openConnect}>Open the page again</Button>
            <Button look="quiet" className="h-9 px-2 md:h-9 md:text-[15px]" onClick={() => { setEntering(false); setCode("") }}>Cancel</Button>
          </div>
        </>
      ) : (
        <Button look="primary" className="h-9 px-4 md:h-9 md:text-[15px]" onClick={() => { openConnect(); setEntering(true) }} data-cloud-sign-in>Sign in</Button>
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

export type AppId = "claude" | "chatgpt" | "grok-bot" | "muse" | "other"
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
    name: "ChatGPT", icon: "openai", match: /chatgpt|openai/i, sub: "On the web and the phone, once added on the web. Added before? Delete that Vaultite in its Plugins first: ChatGPT can't change an address.",
    steps: (address, icon) => [
      { text: <>Open ChatGPT's <B>Plugins</B>, then <B>Add</B>, <B>Add custom MCP server</B></>, open: "https://chatgpt.com/plugins" },
      { text: <>Name it <B>{NAME}</B></>, copy: { label: "Copy name", value: NAME } },
      { text: <>Paste the address as its <B>Server URL</B></>, copy: { label: "Copy address", value: address } },
      { text: <>Add <a className="text-primary" href={icon} target="_blank" rel="noreferrer" data-connector-icon>Vaultite's icon</a> if you like (save it, then choose it as the <B>Icon</B>)</> },
      { text: <>Keep <B>OAuth</B>, tick <B>I understand</B> and choose <B>Create as a plugin</B></> },
      { text: <>Choose <B>Continue to Vaultite</B>: Vaultite's sign-in page shows a code. Type it below.</> },
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
      { text: <>Choose <B>Authorize</B> on the Vaultite card it posts, then <B>Continue</B>: Vaultite's sign-in page opens in your browser with a code. Type it below.</> },
      { text: <>It's connected when the card says <B>Added</B></> },
      { text: <>For what it finds to land in your inbox, send this too</>, copy: { label: "Copy message", value: RESULTS } },
    ],
  },
  other: {
    name: "Another app", icon: "plug", match: /^$/, sub: "Any app that takes a remote MCP server: streamable HTTP, with OAuth sign-in.",
    steps: (address) => [
      { text: <>In the app, add a remote MCP server (a custom connector) and name it <B>{NAME}</B></>, copy: { label: "Copy name", value: NAME } },
      { text: <>Paste this address as its server URL</>, copy: { label: "Copy address", value: address } },
      { text: <>When it signs in, Vaultite's sign-in page shows a code. Type it below.</> },
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
          {/* (Copy last, so a step's copy buttons line up whether or not it has Open too) */}
          {s.open && <a href={s.open} target="_blank" rel="noreferrer" className={small} data-guide-open>Open<ExternalLink className="size-3.5" /></a>}
          {s.copy && (
            <button type="button" onClick={() => void copy(i, s.copy!.value)} className={small} data-guide-copy>
              {copied === i ? <Check className="size-3.5" strokeWidth={2.5} /> : <Copy className="size-3.5" />}{copied === i ? "Copied" : s.copy.label}
            </button>
          )}
        </li>
      ))}
    </ol>
  )
}

/** The sheet's detail path (`details` in index.tsx): connect-app/<app>. */
export const SETUP_DETAIL = "connect-app"
/** The apps Connections names, in order ("other" is the generic setup). */
export const APPS: AppId[] = ["claude", "chatgpt", "muse", "grok-bot"]
export const setupTitle = (id: string) => (id in GUIDES && id !== "other" ? `Set up ${GUIDES[id as AppId].name}` : "Set up another app")
export const appIcon = (id: AppId): LucideIcon => (id === "other" ? Plug : iconNamed(GUIDES[id].icon) ?? Bot)
/** The connection an app made, by the name it signed in with. */
const connectionOf = (id: AppId, cs: Connection[]) => cs.find((c) => GUIDES[id].match.test(c.name))
/** The known app a connection is, by its name, or null. */
const appOf = (c: Connection) => APPS.find((id) => GUIDES[id].match.test(c.name)) ?? null

/** An app's steps in a sheet: Vaultite Cloud's sign-in first when there's no address yet, then the steps and the code field. */
export function SetupSheet({ id }: { id: AppId }) {
  const { data, error, reload } = useConnections()
  const g = GUIDES[id]
  if (!g) return null
  const address = data ? data.cloud.url ?? data.url : null
  const done = data && id !== "other" && connectionOf(id, data.connections)
  return (
    <div data-setup={id}>
      <SheetHead icon={appIcon(id)} tint={g.tint ?? "var(--foreground)"} kicker="Connections" title={setupTitle(id)} sub={g.sub} />
      {!data ? <Loading error={error} /> : (
        <div className="flex flex-col gap-4">
          {done && <Group><Row title={`${g.name} is connected`} meta={`Connected ${fmtAgo(done.created)}${done.used ? `, used ${fmtAgo(done.used)}` : ""}`} onOpen={() => openDetail(detailPath(CONNECTION_DETAIL, done.id))} data-setup-connected /></Group>}
          {address ? (
            <>
              <Section title="Steps"><Guide id={id} address={address} /></Section>
              <Section title="Code"><Connect waiting={data.waiting} onDone={reload} as={id === "other" ? undefined : g.name} /></Section>
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

/** A blank tab's four apps, small cards: each opens its steps. */
function AppCards() {
  return (
    <div className="grid grid-cols-2 gap-2" data-app-cards>
      {APPS.map((id) => {
        const g = GUIDES[id], Icon = appIcon(id)
        return (
          <button key={id} type="button" onClick={() => openDetail(detailPath(SETUP_DETAIL, id))} data-guide-for={id}
            className="flex h-10 min-w-0 cursor-pointer items-center gap-2 rounded-[10px] border-[0.5px] border-border px-2.5 text-left hover:bg-foreground/[0.04] md:gap-2.5 md:px-3">
            <Icon className="size-5 shrink-0" style={g.tint ? { color: g.tint } : undefined} />
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium" data-app-name>{g.name}</span>
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
      <AppCards />
    </div>
  )
}


const INTRO = "Tell them what happened and it lands in your vault, from the web, their desktop apps and your phone."

/** An app's mark in a list row, on a tile. */
function AppMark({ icon: Icon, tint }: { icon: LucideIcon; tint?: string }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-foreground/[0.06]">
      <Icon className="size-[18px]" style={tint ? { color: tint } : undefined} />
    </span>
  )
}

const usedText = (c: Connection) => [c.used ? `used ${fmtAgo(c.used)}` : null, c.access === "read" ? "read only" : null].filter(Boolean).join(" · ")

/** A sign-in waiting for its code (the toast "wants to connect" opens Connections on it): what it's for and the field. */
function Waiting({ data, onDone }: { data: State; onDone: () => void }) {
  const names = [...new Set(data.asking ?? [])]
  return (
    <div className="rounded-[10px] border-[0.5px] border-primary/40 bg-primary/[0.06] px-3 pt-2.5 pb-1" data-waiting>
      <div className="flex items-center gap-2 text-[15px] font-semibold">
        <KeyRound className="size-4 shrink-0 text-primary" strokeWidth={2.25} />
        {names.length === 1 ? `${names[0]} is waiting for its code` : "An app is waiting for its code"}
      </div>
      <p className="pt-0.5 text-[13px] leading-[18px] text-muted-foreground">Type the code its sign-in page shows. Didn't start a sign-in? Leave it: nothing connects without the code.</p>
      <Connect waiting={data.waiting} onDone={onDone} />
    </div>
  )
}

/** Everything about AI apps: a sign-in waiting for its code, then a row per app (connected: its page; else its steps),
 *  any other app connected, and the generic setup. */
export function AiApps() {
  const { data, error, reload } = useConnections()
  const rows = useKeptCount("mcp:connections", data ? APPS.length + 1 + Math.max(0, data.connections.length - 1) : undefined)
  if (error && !data) return <Loading error={error} />
  const intro = <p className="pb-3 text-[15px] leading-[20px] text-muted-foreground">{INTRO}</p>
  if (!data) return <div aria-busy>{intro}<div className="rounded-[10px] bg-foreground/[0.04] px-3"><LoadingRows count={rows || APPS.length + 1} lead={<span className="skeleton size-8 shrink-0 rounded-[8px]" />} /></div></div>
  // Each known app takes the first connection with its name; the rest are listed by theirs.
  const taken = new Set<string>()
  const known = APPS.map((id) => {
    const c = data.connections.find((x) => !taken.has(x.id) && GUIDES[id].match.test(x.name))
    if (c) taken.add(c.id)
    return { id, c }
  })
  const others = data.connections.filter((c) => !taken.has(c.id))
  const open = (c: Connection) => openDetail(detailPath(CONNECTION_DETAIL, c.id))
  const connectedMeta = (c: Connection) => <><span className="text-[var(--green)]">Connected</span>{usedText(c) && ` · ${usedText(c)}`}</>
  return (
    <div className="flex flex-col gap-3" data-ai-apps>
      {data.waiting > 0 && (data.url || data.cloud.url) && <Waiting data={data} onDone={reload} />}
      {intro}
      <Group>
        <div data-app-list>
          {known.map(({ id, c }) => (
            <Row key={id} lead={<AppMark icon={appIcon(id)} tint={GUIDES[id].tint} />} title={GUIDES[id].name} meta={c ? connectedMeta(c) : "Set up"}
              onOpen={() => (c ? open(c) : openDetail(detailPath(SETUP_DETAIL, id)))} data-guide-for={c ? undefined : id} data-app-row={id} data-connection={c?.id} data-app-connected={c ? true : undefined} />
          ))}
          {others.map((c) => {
            const app = appOf(c)
            return <Row key={c.id} lead={<AppMark icon={app ? appIcon(app) : Bot} tint={app ? GUIDES[app].tint : undefined} />} title={c.name} meta={connectedMeta(c)} onOpen={() => open(c)} data-connection={c.id} data-app-connected />
          })}
          {(data.finishing ?? []).map((name, i) => (
            <Row key={`finishing-${i}`} lead={<AppMark icon={Bot} />} title={name} meta={<span className="shimmer">Finishing connecting…</span>} aria-busy data-connection-finishing />
          ))}
          <Row lead={<AppMark icon={Plus} />} title="Another app" meta="Any app that takes a remote MCP server" onOpen={() => openDetail(detailPath(SETUP_DETAIL, "other"))} data-guide-for="other" />
        </div>
      </Group>
    </div>
  )
}

/** Vaultite Cloud and the addresses this machine is reached at: the whole app from anywhere, MCP's for apps. */
export function RemoteAccess() {
  const { data, error, reload } = useConnections()
  if (!data) return <Loading error={error} />
  return (
    <div className="flex flex-col gap-4" data-remote-access>
      {data.cloud.app && data.cloud.state === "connected" && <AppAddress app={data.cloud.app} ownerTools={!!data.connect?.ownerTools} onDone={reload} />}
      <CloudSection data={data} onDone={reload} />
    </div>
  )
}

/** view:connections: the apps, then remote access, each its own card. */
export function ConnectionsView() {
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 p-4" data-connections>
      <Panel title="AI apps" icon={Plug}><AiApps /></Panel>
      <Panel title="Remote access" icon={Globe}><RemoteAccess /></Panel>
    </div>
  )
}

// ---------- a connected app's page

/** The sheet's detail path (`details` in index.tsx): connection/<grant id>. */
export const CONNECTION_DETAIL = "connection"
export const connectionTitle = (id: string) => lastState?.connections.find((c) => c.id === id)?.name ?? "Connected app"

type Event = { id: string; t: number; last?: number; action: string; text: string; paths?: string[] }
type Gate = { id: string; title: string; gate?: boolean; answer?: string }

/** How many changes of the app's wait for review (the review queue's op), or null without one. */
function useReviewCount(by: string) {
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    let on = true
    op<{ files: unknown[] }>("review.list", { by }).then((r) => { if (on) setN(Array.isArray(r?.files) ? r.files.length : null) }, () => { if (on) setN(null) })
    return () => { on = false }
  }, [by])
  return n
}

function NameField({ c, onDone }: { c: Connection; onDone: () => void }) {
  const [typed, setTyped] = useState<string | null>(null)
  const save = async () => {
    const name = typed?.trim()
    setTyped(null)
    if (!name || name === c.name) return
    try { await patch(`mcp/connections/${encodeURIComponent(c.id)}`, { name }); onDone() } catch (e) { notifyError(e) }
  }
  return (
    <input aria-label="Name" value={typed ?? c.name} onChange={(e) => setTyped(e.target.value)} maxLength={80} spellCheck={false} data-connection-name
      onBlur={() => void save()} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur() } else if (e.key === "Escape") { setTyped(null); e.currentTarget.blur() } }}
      className="h-8 w-full min-w-0 rounded-[7px] border-[0.5px] border-border bg-background px-2 text-[16px] outline-none focus:border-primary sm:w-52 md:h-7 md:text-[14px]" />
  )
}

/** A connected app's page: who it is, what it may do, what it did lately and waits on, its name, and disconnecting it. */
export function ConnectionSheet({ id }: { id: string }) {
  const { data, error, reload } = useConnections()
  const c = data?.connections.find((x) => x.id === id)
  if (!data) return <Loading error={error} />
  if (!c) return (
    <div data-connection-sheet>
      <SheetHead icon={Plug} tint="var(--foreground)" kicker="Connections" title="Not connected" />
      <Empty>This app isn't connected anymore.</Empty>
    </div>
  )
  return <ConnectionPage key={c.id} c={c} onDone={reload} />
}

function ConnectionPage({ c, onDone }: { c: Connection; onDone: () => void }) {
  const app = appOf(c)
  // (what was chosen shows at once; a change that fails goes back)
  const [chosen, setChosen] = useState<Access | null>(null)
  const access = chosen ?? c.access
  const on = useEnabled()
  const activity = useLive<{ events: Event[] }>(on("activity") ? `activity?name=${encodeURIComponent(c.actor)}&limit=12` : null, undefined, undefined, 15_000)
  const inbox = useLive<{ events: Gate[] }>(on("inbox") ? "inbox/events?local=1&limit=200" : null, undefined, undefined, 10_000)
  const gates = (inbox.data?.events ?? []).filter((e) => e.gate && !e.answer && e.title.startsWith(`${c.name} asks to `))
  const review = useReviewCount(c.name)
  const change = async (v: Access) => {
    setChosen(v)
    try { await patch(`mcp/connections/${encodeURIComponent(c.id)}`, { access: v }); onDone() } catch (e) { setChosen(null); notifyError(e) }
  }
  const disconnect = async () => {
    if (!(await confirmDialog({ title: `Disconnect ${c.name}?`, body: "It can't read or write your vault until you connect it again.", confirm: "Disconnect", danger: true }))) return
    try { await del(`mcp/connections/${encodeURIComponent(c.id)}`); notify(`Disconnected ${c.name}`); onDone(); backDetail() } catch (e) { notifyError(e) }
  }
  const events = activity.data?.events ?? []
  return (
    <div className="flex flex-col gap-5" data-connection-sheet={c.id}>
      <SheetHead icon={app ? appIcon(app) : Bot} tint={app ? GUIDES[app].tint ?? "var(--foreground)" : "var(--foreground)"} kicker="Connections" title={c.name}
        sub={`Connected ${fmtAgo(c.created)}${c.used ? ` · last used ${fmtAgo(c.used)}` : ""}`} />
      <Section title="Access">
        <Segmented label="Access" value={access} onChange={(v) => void change(v)} className="w-full sm:w-fit"
          options={[{ value: "write", label: "Read and write" }, { value: "read", label: "Read only" }]} />
        <p className="pt-1.5 text-[13px] leading-[18px] text-muted-foreground" data-access-sub>
          {access === "read" ? "It can search and read your vault; anything it tries to change is refused." : "It can read and change your vault. What could run code on this machine still waits for your yes."}
        </p>
      </Section>
      {(gates.length > 0 || !!review) && (
        <Section title="Waiting for you">
          <Group>
            {gates.map((e) => <Row key={e.id} title={`Asks to ${e.title.slice(`${c.name} asks to `.length)}`} meta="Approve or deny" onOpen={() => openDetail(detailPath("inbox-gate", e.id))} data-connection-gate />)}
            {!!review && <Row title={`Review ${plural(review, "change")}`} meta={`What ${c.name} changed, to keep or undo`} onOpen={() => openView(`review/${encodeURIComponent(c.name)}`)} data-connection-review />}
          </Group>
        </Section>
      )}
      {on("activity") && !activity.error && (
        <Section title="Recent activity">
          {!activity.data ? <div className="rounded-[10px] bg-foreground/[0.04] px-3"><LoadingRows count={3} /></div>
            : !events.length ? <Empty>Nothing yet: what it reads and changes shows here.</Empty>
            : <Group>{events.map((e) => {
              const file = e.paths?.find((p) => !p.startsWith(".vaultite/"))
              return <Row key={e.id} title={e.text} meta={fmtAgo(e.last ?? e.t)} onOpen={file ? () => openFile(file) : undefined} data-connection-event />
            })}</Group>}
        </Section>
      )}
      <Group>
        <SettingRow stack label="Name" sub="What Connections and Activity call it">
          <NameField c={c} onDone={onDone} />
        </SettingRow>
      </Group>
      <Group>
        <button type="button" onClick={() => void disconnect()} className="flex min-h-11 w-full cursor-pointer items-center text-left text-[15px] text-destructive" data-connection-disconnect>
          Disconnect {c.name}
        </button>
      </Group>
    </div>
  )
}
