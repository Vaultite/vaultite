// Settings > Permissions (the desktop app on a Mac): what macOS lets Vaultite do, as app.permissions reads it (core/
// coreops/permissions.ts), each with its way to allow it. Read again when the window comes back from System Settings.
import { useCallback, useEffect, useState } from "react"
import { desktop } from "@/core/desktop"
import { op } from "@/core/http"
import { errorText, notifyError } from "@/core/notify"
import { Button } from "@/components/Button"
import { Loading, LoadingRows, Panel, SettingRow } from "@/components/kit"
import { keepsPermissions, signingText, STATE_TEXT, type Access, type Permission, type PermissionReport, type PermissionState } from "../../../core/permissions.ts"

const DOT: Record<PermissionState, string> = { allowed: "var(--green)", denied: "var(--orange)", "not-asked": "var(--gray)", unknown: "var(--gray)" }
const ACTION: Record<Permission["action"], string> = { ask: "Allow…", check: "Check", settings: "Open Settings" }

function State({ state, children }: { state: PermissionState; children?: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[14px] text-muted-foreground" data-permission-state={state}>
      <span aria-hidden className="size-2 rounded-full" style={{ background: DOT[state] }} />{children ?? STATE_TEXT[state]}
    </span>
  )
}

const stateOf = (a: Access): PermissionState => (a.ok ? "allowed" : a.ok === false ? "denied" : "unknown")

/** The vault folder: the app's read and a new terminal's (its keeper outlives the app, so macOS may treat it apart). */
function vaultLine({ app, terminals }: PermissionReport["vault"]) {
  if (app.ok === false) return `The app can't read it: ${app.why}`
  if (terminals.ok === false) return `Its terminals can't read it (${terminals.why}), so agents stop as they start`
  if (terminals.ok === null) return `The app can read it; whether its terminals can is unknown: ${terminals.why}`
  return "The app and its terminals can read it"
}

export function PermissionsPanel() {
  const [report, setReport] = useState<PermissionReport | null>(null)
  const [error, setError] = useState("")
  const read = useCallback(() => op<PermissionReport>("app.permissions").then((r) => { setReport(r); setError("") }, (e) => setError(errorText(e, "Couldn't read the permissions"))), [])
  useEffect(() => {
    void read()
    // (back from System Settings: what changed there shows)
    const back = () => { if (document.visibilityState === "visible") void read() }
    window.addEventListener("focus", back)
    document.addEventListener("visibilitychange", back)
    return () => { window.removeEventListener("focus", back); document.removeEventListener("visibilitychange", back) }
  }, [read])
  const act = (id: string) => desktop!.permission!(id).then(read, (e) => notifyError(e, "Couldn't ask macOS"))
  if (!report) return error ? <Loading error={error} /> : <Panel><LoadingRows count={3} /></Panel>
  const { vault, mac } = report
  const vaultState = vault.app.ok === false || vault.terminals.ok === false ? "denied" : stateOf(vault.terminals)
  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div className="hairline">
          <SettingRow label="Vault folder" sub={vaultLine(vault)} data-settings-row="permission-vault">
            <State state={vaultState} />
            {vaultState === "denied" && <Button size="small" onClick={() => void act("vault")}>Open Settings</Button>}
          </SettingRow>
          {mac && (
            <SettingRow label="Signature" sub={signingText(mac.signing)} data-settings-row="permission-signing">
              {mac.signing.kind === "source" ? <State state="unknown">From source</State>
                : <State state={keepsPermissions(mac.signing) ? "allowed" : "denied"}>{keepsPermissions(mac.signing) ? "Kept" : "Asked again"}</State>}
            </SettingRow>
          )}
        </div>
      </Panel>
      {mac && (
        <Panel>
          <div className="hairline">
            {mac.permissions.map((p) => (
              <SettingRow key={p.id} label={p.name} sub={p.use} data-settings-row={`permission-${p.id}`}>
                <State state={p.state} />
                {p.state !== "allowed" && <Button size="small" onClick={() => void act(p.id)}>{ACTION[p.action]}</Button>}
              </SettingRow>
            ))}
          </div>
        </Panel>
      )}
      <p className="px-1 text-[13px] leading-[18px] text-muted-foreground">
        Programs in Vaultite's terminals ask macOS as Vaultite, so they get what it allows. Unknown: macOS doesn't say without asking.
      </p>
    </div>
  )
}
