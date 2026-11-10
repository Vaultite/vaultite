// Settings > About's Running: what the server runs (its commit, copied with a tap), whether this window runs the same
// build, the server's updates when it follows a branch, and the desktop app's own (app.version, vau version's op).
import { useEffect, useState } from "react"
import { Copy } from "lucide-react"
import { BUILD, PAGE_STAMP, useServedBuild } from "@/core/builds"
import { fmtAgo } from "@/core/data"
import { desktop as desktopApp } from "@/core/desktop"
import { op } from "@/core/http"
import { notify } from "@/core/notify"
import { phoneApp } from "@/core/phoneapp"
import { copyText } from "@/core/richmd"
import { Button } from "@/components/Button"
import { Group, Section, SettingRow } from "@/components/kit"
import { capitalize } from "@/lib/utils"

type Version = {
  commit: string | null; subject?: string; at?: number
  web?: { entry: string | null; commit: string | null }
  updates: { branch: string | null; state: "off" | "current" | "waiting" | "updating" | "failed"; why: string; checked: number | null
    last?: { from: string; to: string; at: number; elsewhere?: string[] }; error?: { message: string } }
  app: null | "unknown" | { mode: "automatic" | "notify" | "off"; available: boolean; ready: string | null; doing: string | null; commit?: string | null
    /** A Vaultite Dev instance's worktree (electron/devroot.ts). */
    worktree?: { worktree: string; branch: string; commit: string; dirty: boolean }
    /** Main's updates through its code store (electron/storehost.ts): how the one ready goes in, and the root it runs. */
    store?: { state: string; why: string }; how?: "install" | "relaunch"; behind?: string
    root?: { from: string; commit: string | null; fellBack?: { commit: string | null; why: string } } }
  /** Each process and whether it runs older code (core/running.ts). */
  processes?: { id: string; label: string; commit: string | null; stale: boolean | null; first?: string; why?: string }[]
}
/** Where a launch's code came from, as the shell says (electron/shell/roots.mjs). */
const FROM: Record<string, string> = { current: "from its code store", good: "from its code store (the last that started)", bundle: "its own bundle", checkout: "this checkout", dev: "a worktree" }

const short = (sha: string) => sha.slice(0, 7)
const STATE = { current: "Up to date", waiting: "Waiting", updating: "Updating", failed: "Failed", off: "Off" } as const
const copy = (sha: string) => copyText(sha).then((ok) => { if (ok) notify("Copied the commit", { id: "copied" }); else notify("Couldn't copy it", { kind: "error" }) })
const here = desktopApp ? "This window" : phoneApp ? "This app" : "This page"

/** A commit, short, in the row's value; a tap copies it whole. */
const Hash = ({ sha }: { sha: string }) => <span className="font-mono tabular-nums">{short(sha)}</span>

/** The server's version, asked again when it serves another build, now and then while shown (its updates move on). */
function useVersion() {
  const served = useServedBuild()
  const [v, setV] = useState<Version | null>(null)
  useEffect(() => {
    let live = true
    const ask = () => { if (!document.hidden) op<Version>("app.version").then((r) => { if (live) setV(r) }, () => {}) }
    ask()
    const timer = setInterval(ask, 30_000)
    document.addEventListener("visibilitychange", ask)
    return () => { live = false; clearInterval(timer); document.removeEventListener("visibilitychange", ask) }
  }, [served])
  return v
}

export function Running() {
  const v = useVersion()
  const served = useServedBuild()
  if (!v?.commit) return null
  const u = v.updates, app = v.app && v.app !== "unknown" && desktopApp ? v.app : null
  // (this window's build: the one the server serves, or an older one it reloads out of when it's away)
  const behind = !!BUILD && !!served && served !== BUILD
  const mine = PAGE_STAMP?.commit
  const last = u.last ? `last update ${fmtAgo(u.last.at)}${u.last.elsewhere?.length ? ` (CI red on it elsewhere: ${u.last.elsewhere.join(", ")})` : ""}` : ""
  return (
    <Section title="Running" className="mt-6">
      <Group>
        <SettingRow label="Server" value={<Hash sha={v.commit} />} onClick={() => void copy(v.commit!)} chevron={Copy} data-settings-row="running"
          sub={[v.subject, v.at && fmtAgo(v.at)].filter(Boolean).join(" · ") || undefined} />
        {BUILD && served && (
          <SettingRow label={here} data-settings-row="running-here" value={behind ? undefined : "Up to date"}
            sub={behind ? `An older build${mine ? ` (${short(mine)})` : ""}: it updates by itself while you're away` : undefined}>
            {behind && <Button size="small" onClick={() => location.reload()}>Reload</Button>}
          </SettingRow>
        )}
        {u.branch && (
          <SettingRow label="Server updates" data-settings-row="running-updates" value={<span className={u.state === "failed" ? "text-[var(--red)]" : undefined}>{STATE[u.state]}</span>}
            sub={[capitalize(u.state === "failed" && u.error ? u.error.message : u.why), u.state !== "failed" && last].filter(Boolean).join(" · ")} />
        )}
        {app && (app.commit || app.doing || app.ready) && (
          <SettingRow label="App" data-settings-row="running-app" value={app.commit ? <Hash sha={app.commit} /> : undefined}
            onClick={app.commit ? () => void copy(app.commit!) : undefined} chevron={app.commit ? Copy : null}
            sub={app.worktree ? [`${app.worktree.branch} in ${app.worktree.worktree}`, app.worktree.dirty && "uncommitted changes", app.ready && `${app.ready}: relaunch to run them`].filter(Boolean).join(" · ")
              : app.doing ?? (app.ready ? `${short(app.ready)} is ready: ${app.how === "relaunch" ? "relaunch to run it, a couple of seconds" : "restart to update"}` : app.mode === "off" ? "Updates off" : "No update waiting")} />
        )}
        {app?.root && app.store && (
          <SettingRow label="App's code" data-settings-row="running-root" value={app.root.commit ? <Hash sha={app.root.commit} /> : undefined}
            sub={capitalize(FROM[app.root.from] ?? app.root.from) + (app.root.fellBack ? `: ${app.root.fellBack.commit ? short(app.root.fellBack.commit) : "the newest"} didn't start (${app.root.fellBack.why})` : "")} />
        )}
        {(v.processes ?? []).filter((p) => p.id !== "server" || p.stale).map((p) => {
          // (the app's own word, from its store's plan, when its server runs a root older than the one it waits to relaunch onto)
          const behind = (p.id === "desktop" || p.id === "helper") && app?.behind
          const stale = behind ? true : p.stale
          return (
            <SettingRow key={p.id} label={p.label} data-settings-row={`running-process-${p.id}`}
              value={stale === null ? "Can't say" : stale ? <span className="text-[var(--orange)]">Older code</span> : "Current"}
              sub={behind ? `Runs older code: ${behind}, so a relaunch runs it` : stale ? `Runs older code: ${p.first} changed${p.id === "desktop" || p.id === "helper" ? ", so a relaunch runs it" : ""}`
                : stale === null ? capitalize(p.why ?? "") : undefined} />
          )
        })}
      </Group>
    </Section>
  )
}
