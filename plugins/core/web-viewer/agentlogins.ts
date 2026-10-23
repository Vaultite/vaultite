// Passwords for agents: the KeePass file (agents.kdbx) the browser fills agents' logins from on this Mac
// (electron/browser/logins.ts), and its password, given here and kept in this Mac's Keychain, never in the vault.
import { choose, notify, notifyError, openView, secretDialog, webPages } from "@vaultite"

type Status = { file: string; entries?: number; free?: number; error?: string } | null
const engine = (name: string, ...args: unknown[]) => Promise.resolve(webPages?.engine?.(name, ...args))
const fileName = (file: string) => file.split("/").pop() ?? file
const count = (n: number, free: number) => `${n} ${n === 1 ? "entry" : "entries"}, ${free} free to use without asking`

async function useFile() {
  const file = (await engine("logins:choose")) as string | null
  if (!file) return
  const given = await secretDialog({ title: `Password of ${fileName(file)}`, confirm: "Use", field: "secret",
    body: "Kept in this Mac's Keychain, never in the vault. The browser fills agents' logins from it; agents never see what's in it." })
  if (!given) return
  try {
    const r = (await engine("logins:set", file, given.value)) as { error?: string; entries?: number; free?: number }
    if (r.error) notify(`Couldn't use ${fileName(file)}: ${r.error}`, { kind: "error" })
    else notify(`Agents can log in with ${fileName(file)}: ${count(r.entries ?? 0, r.free ?? 0)}`, { action: { label: "Passkeys", run: () => openView("agent-passkeys") } })
  } catch (e) { notifyError(e, `Couldn't use ${fileName(file)}`) }
}

/** Set up, change or stop the passwords agents log in with on this Mac. */
export async function passwordsForAgents() {
  let st: Status
  try { st = (await engine("logins:status")) as Status } catch (e) { return notifyError(e, "Couldn't read the passwords for agents") }
  if (!st) return void useFile()
  choose({
    title: "Passwords for agents", placeholder: "Passwords for agents",
    heading: `${fileName(st.file)}: ${st.error ?? count(st.entries ?? 0, st.free ?? 0)}`,
    items: [{ id: "passkeys", label: "Passkeys that approve logins…" }, { id: "file", label: "Use another file…" }, { id: "forget", label: "Stop using it" }],
    onPick: (it) => {
      if (it.id === "passkeys") openView("agent-passkeys")
      else if (it.id === "file") void useFile()
      else void engine("logins:forget").then(() => notify("Agents no longer log in with your passwords on this Mac"), (e) => notifyError(e, "Couldn't stop it"))
    },
  })
}
