import { useCallback } from "react"
import { desktop } from "@/core/desktop"
import { op } from "@/core/http"
import { errorText, notifyError } from "@/core/notify"
import { usePermissions } from "@/core/permissions"
import { Button } from "@/components/Button"
import { Loading, LoadingRows, Panel, SettingRow } from "@/components/kit"
import { ACTION_TEXT, signingText, stateText, STATE_TEXT, type Access, type Permission, type PermissionKind, type PermissionReport, type PermissionState } from "../../../core/permissions.ts"

const DOT: Record<PermissionState, string> = { allowed: "var(--green)", denied: "var(--orange)", "not-asked": "var(--gray)", unknown: "var(--gray)" }
const GROUPS: [PermissionKind, string][] = [["list", "Agents and apps"], ["prompt", "Media and location"], ["on-use", "Asked when used"]]

function State({ state, children }: { state: PermissionState; children?: string }) {
  return (
    <span className="flex w-28 shrink-0 items-center gap-1.5 text-[14px] text-muted-foreground" data-permission-state={state}>
      <span aria-hidden className="size-2 rounded-full" style={{ background: DOT[state] }} />{children ?? STATE_TEXT[state]}
    </span>
  )
}

const stateOf = (a: Access): PermissionState => (a.ok ? "allowed" : a.ok === false ? "denied" : "unknown")

function vaultLine({ app, terminals }: PermissionReport["vault"]) {
  if (app.ok === false) return `The app can't read it: ${app.why}`
  if (terminals.ok === false) return `Its terminals can't read it (${terminals.why}), so agents stop as they start`
  if (terminals.ok === null) return `The app can read it; whether its terminals can is unknown: ${terminals.why}`
  return "The app and its terminals can read it"
}

const read = () => op<PermissionReport>("app.permissions")
const act = (id: string) => desktop!.permission!(id)
const listOf = (r: PermissionReport) => r.mac?.permissions

export function PermissionsPanel() {
  const { report, error, grant, pending } = usePermissions(read, act, listOf)
  const press = useCallback((id: string) => grant(id).catch((e) => notifyError(e, "Couldn't ask macOS")), [grant])
  if (!report) return error ? <Loading error={errorText(error, "Couldn't read the permissions")} /> : <Panel><LoadingRows count={3} /></Panel>
  const { vault, mac } = report
  const vaultState = vault.app.ok === false || vault.terminals.ok === false ? "denied" : stateOf(vault.terminals)
  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div className="hairline">
          <SettingRow label="Vault folder" sub={vaultLine(vault)} data-settings-row="permission-vault">
            {vaultState === "denied" && <Button size="small" onClick={() => void press("vault")}>Open Settings</Button>}
            <State state={vaultState} />
          </SettingRow>
          {mac && (mac.signing.kind === "adhoc" || mac.signing.kind === "unsigned") && (
            <SettingRow label="Signature" sub={signingText(mac.signing)} data-settings-row="permission-signing">
              <State state="denied">Asked again</State>
            </SettingRow>
          )}
        </div>
      </Panel>
      {mac && GROUPS.map(([kind, title]) => (
        <Panel key={kind} title={title}>
          <div className="hairline">
            {mac.permissions.filter((p) => p.kind === kind).map((p) => (
              <SettingRow key={p.id} label={p.name} sub={<Sub p={p} />} data-settings-row={`permission-${p.id}`}>
                {p.action !== "none" && <Button size="small" busy={pending.has(p.id)} onClick={() => void press(p.id)} data-act={p.action}>{ACTION_TEXT[p.action]}</Button>}
                <State state={p.state}>{stateText(p)}</State>
              </SettingRow>
            ))}
          </div>
        </Panel>
      ))}
      <p className="px-1 text-[13px] leading-[18px] text-muted-foreground">
        Programs in Vaultite's terminals ask macOS as Vaultite, so they get what it allows.
        {mac?.permissions.some((p) => p.state === "unknown" && !p.note) && " Unknown: macOS doesn't say until it's been asked."}
      </p>
    </div>
  )
}

function Sub({ p }: { p: Permission }) {
  return <>{p.use}{p.fix && <span className="block text-foreground">{p.fix}</span>}</>
}
