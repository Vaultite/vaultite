// The iPhone app's first screen, served from its own files: which Vaultite server to open. It opens the last one after
// checking it answers, else stays here saying why rather than a blank page (?pick: Switch server…).
import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { Ellipsis, LoaderCircle, Server as ServerIcon } from "lucide-react"
import "./index.css"
import { ContextMenus, menuBelow } from "@/components/ContextMenu"
import { phoneApp, type Server } from "@/core/phoneapp"
import { cn } from "@/lib/utils"

// Light or dark like the system (the vaults' own settings are theirs).
const dark = matchMedia("(prefers-color-scheme: dark)")
const theme = () => document.documentElement.classList.toggle("dark", dark.matches)
theme()
dark.addEventListener("change", theme)

/** What was typed, as a server's address: https unless it says, no path. Null when it isn't one. */
function serverUrl(typed: string): string | null {
  const t = typed.trim()
  if (!t) return null
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(t) ? t : `https://${t}`)
    if (!/^https?:$/.test(u.protocol) || !u.hostname) return null
    return u.origin
  } catch { return null }
}

/** A server's name: its machine's (the host's first part: "studio" of studio.tailnet.ts.net). */
const nameOf = (url: string) => new URL(url).hostname.split(".")[0]

function Phone() {
  const [servers, setServers] = useState<Server[] | null>(null)
  /** The server being opened, and why the last one didn't. */
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<{ url: string; text: string } | null>(null)
  const [typed, setTyped] = useState("")

  const open = async (url: string) => {
    setOpening(url); setError(null)
    const r = await phoneApp!.probe({ url }).catch((e: Error) => ({ ok: false, error: e.message }))
    if (r.ok) {
      // (opened, this page is gone; still here a while later, its load failed: the buttons come back)
      setTimeout(() => { setOpening(null); setError({ url, text: "It answered, but its page didn't load" }) }, 15_000)
      return phoneApp!.open({ url }).catch((e: Error) => { setOpening(null); setError({ url, text: e.message }) })
    }
    setOpening(null)
    setError({ url, text: r.error || "It didn't answer" })
  }

  useEffect(() => {
    if (!phoneApp) return
    phoneApp.servers().then((r) => {
      setServers(r.servers)
      const q = new URLSearchParams(location.search), pick = q.has("pick"), failed = q.get("failed")
      // (sent back by the app because a server's page didn't load: why, and no opening it again on its own, or a server
      // that answers its check but not its page would go round and round)
      if (failed) return setError({ url: failed, text: `Its page didn't load: ${(q.get("why") || "no answer").replace(/\.$/, "")}` })
      if (r.last && !pick && r.servers.some((s) => s.url === r.last)) open(r.last)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = (list: Server[]) => { setServers(list); return phoneApp!.setServers({ servers: list }) }
  const add = async () => {
    const url = serverUrl(typed)
    if (!url) return setError({ url: "", text: "That isn't a web address" })
    if (!servers!.some((s) => s.url === url)) await save([...servers!, { url, name: nameOf(url) }])
    setTyped("")
    open(url)
  }

  if (!phoneApp) return <p className="p-6 text-[17px] text-muted-foreground">This page is the iPhone app's.</p>
  return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col gap-6 px-4 pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),16px)]">
      <div className="flex flex-col items-center gap-2 pt-10 pb-2">
        <img src="icon.svg" alt="" className="size-16" />
        <h1 className="text-[22px] font-semibold">Vaultite</h1>
      </div>

      {servers && !!servers.length && (
        <section aria-label="Servers" className="flex flex-col">
          <h2 className="px-4 pb-1.5 text-[13px] text-muted-foreground">Servers</h2>
          <div className="overflow-hidden rounded-[10px] bg-card">
            {servers.map((s, i) => (
              <div key={s.url} className={cn("flex items-center", i > 0 && "border-t-[0.5px] border-border")}>
                <button type="button" disabled={!!opening} onClick={() => open(s.url)}
                  className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 py-2 pl-4 text-left active:bg-foreground/[0.06]">
                  <ServerIcon className="size-5 shrink-0 text-muted-foreground" strokeWidth={2} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[17px]">{s.name}</span>
                    <span className="truncate text-[13px] text-muted-foreground">{new URL(s.url).host}</span>
                    {error?.url === s.url && <span role="alert" className="text-[13px] text-destructive">{error.text}. Is Tailscale on and the server awake?</span>}
                  </span>
                  {opening === s.url && <LoaderCircle className="size-5 shrink-0 animate-spin text-muted-foreground" strokeWidth={2} />}
                </button>
                <button type="button" aria-label={`More for ${s.name}`}
                  onClick={(e) => menuBelow(e, [{ label: "Remove", run: () => { save(servers.filter((x) => x.url !== s.url)) } }])}
                  className="grid size-11 shrink-0 cursor-pointer place-items-center text-muted-foreground active:bg-foreground/[0.06]">
                  <Ellipsis className="size-5" strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {servers && (
        <section aria-label="Add a server" className="flex flex-col">
          <h2 className="px-4 pb-1.5 text-[13px] text-muted-foreground">Add a server</h2>
          <form onSubmit={(e) => { e.preventDefault(); add() }} className="flex items-center gap-2 rounded-[10px] bg-card p-1.5 pl-4">
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="my-server.tailnet.ts.net:8447" aria-label="Server address"
              type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              className="h-9 min-w-0 flex-1 bg-transparent text-[17px] outline-none" />
            <button type="submit" disabled={!typed.trim() || !!opening}
              className="h-9 shrink-0 cursor-pointer rounded-[8px] bg-primary px-4 text-[17px] font-medium text-primary-foreground disabled:opacity-50">
              Add
            </button>
          </form>
          {error && !error.url && <p role="alert" className="px-4 pt-1.5 text-[13px] text-destructive">{error.text}</p>}
          <p className="px-4 pt-1.5 text-[13px] text-muted-foreground">
            Vaultite runs on your machine. Serve it on your tailnet (Tailscale Serve), turn on Tailscale on this iPhone, and add its address.
          </p>
        </section>
      )}
    </main>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Phone />
    <ContextMenus />
  </StrictMode>,
)
