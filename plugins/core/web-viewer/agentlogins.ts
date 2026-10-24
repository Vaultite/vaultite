// Passwords for agents: the KeePass file (agents.kdbx) the browser fills agents' logins from on this computer
// (electron/browser/logins.ts), and its password, given here and kept in its keyring, never in the vault.
import { choose, isMac, notify, notifyError, openView, secretDialog, webPages } from "@vaultite"

/** `held`: no keyring here (Linux without one), so the password is kept only till the app quits; then it's `locked`. */
type Status = { file: string; entries?: number; free?: number; error?: string; held?: boolean; locked?: boolean } | null
const HERE = isMac ? "this Mac" : "this computer"
const engine = (name: string, ...args: unknown[]) => Promise.resolve(webPages?.engine?.(name, ...args))
const fileName = (file: string) => file.split("/").pop() ?? file
const count = (n: number, free: number) => `${n} ${n === 1 ? "entry" : "entries"}, ${free} free to use without asking`

async function useFile(chosen?: string) {
  const file = chosen ?? (await engine("logins:choose")) as string | null
  if (!file) return
  const kept = isMac ? "Kept in this Mac's Keychain" : "Kept in this computer's keyring (with none, only till the app quits)"
  const given = await secretDialog({ title: `Password of ${fileName(file)}`, confirm: "Use", field: "secret",
    body: `${kept}, never in the vault. The browser fills agents' logins from it; agents never see what's in it.` })
  if (!given) return
  try {
    const r = (await engine("logins:set", file, given.value)) as { error?: string; entries?: number; free?: number; held?: boolean }
    if (r.error) notify(`Couldn't use ${fileName(file)}: ${r.error}`, { kind: "error" })
    else notify(`Agents can log in with ${fileName(file)}${r.held ? " till the app quits (no keyring here)" : ""}: ${count(r.entries ?? 0, r.free ?? 0)}`, { action: { label: "Passkeys", run: () => openView("agent-passkeys") } })
  } catch (e) { notifyError(e, `Couldn't use ${fileName(file)}`) }
}

/** Set up, change or stop the passwords agents log in with on this computer. */
export async function passwordsForAgents() {
  let st: Status
  try { st = (await engine("logins:status")) as Status } catch (e) { return notifyError(e, "Couldn't read the passwords for agents") }
  if (!st) return void useFile()
  choose({
    title: "Passwords for agents", placeholder: "Passwords for agents",
    heading: `${fileName(st.file)}: ${st.error ?? count(st.entries ?? 0, st.free ?? 0)}`,
    items: [...(st.locked ? [{ id: "unlock", label: "Type its password…" }] : []), { id: "passkeys", label: "Passkeys that approve logins…" },
      { id: "file", label: "Use another file…" }, { id: "forget", label: "Stop using it" }],
    onPick: (it) => {
      if (it.id === "unlock") void useFile(st.file)
      else if (it.id === "passkeys") openView("agent-passkeys")
      else if (it.id === "file") void useFile()
      else void engine("logins:forget").then(() => notify(`Agents no longer log in with your passwords on ${HERE}`), (e) => notifyError(e, "Couldn't stop it"))
    },
  })
}
