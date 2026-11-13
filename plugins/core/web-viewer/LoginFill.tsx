import { useEffect, useState } from "react"
import { KeyRound } from "lucide-react"
import { cell, choose, menuBelow, notify, notifyError, secretDialog, webPages } from "@vaultite"

type Login = { id: string; title: string; username: string; otp: boolean }
const engine = (name: string, ...args: unknown[]) => Promise.resolve(webPages?.engine?.(name, ...args))
const forms = cell(new Set<number>())
const changes = cell(0)
export const hasLoginForm = (id: number) => !!id && forms.get().has(id)
const nameOf = (l: Login) => l.title || l.username || "this login"

const loginsFor = (id: number) => engine("passwords:fill-list", id) as Promise<Login[] | null>

async function unlock(): Promise<boolean> {
  const st = await engine("passwords:status") as { touchId?: boolean } | null
  if (!st) return false
  if (st.touchId && (await engine("passwords:unlock") as { ok?: boolean })?.ok) return true
  const given = await secretDialog({ title: "Unlock your passwords", confirm: "Unlock", field: "secret",
    body: "Type the password of your passwords file. It stays on this computer." })
  if (!given) return false
  const r = await engine("passwords:unlock", given.value) as { ok?: boolean; error?: string }
  if (r?.ok) return true
  notify(`Couldn't unlock your passwords${r?.error ? `: ${r.error}` : ""}`, { kind: "error" })
  return false
}

async function fill(id: number, l: Login) {
  try {
    let r = await engine("passwords:fill", id, l.id) as { locked?: boolean } | null
    if (r?.locked) {
      if (!await unlock()) return
      r = await engine("passwords:fill", id, l.id) as { locked?: boolean } | null
      if (r?.locked) return
    }
    void webPages?.go(id, "focus")
  } catch (e) { notifyError(e, `Couldn't fill ${nameOf(l)}`) }
}

export async function fillLoginIn(id: number) {
  let list: Login[] | null
  try { list = await loginsFor(id) } catch (e) { return void notifyError(e, "Couldn't read your passwords") }
  if (!list) return void notify("No passwords file is set up on this computer")
  if (!list.length) return void notify("Your passwords have no login for this site")
  if (list.length === 1) return fill(id, list[0])
  choose({ title: "Fill login", placeholder: "Login", items: list.map((l) => ({ id: l.id, label: nameOf(l), detail: l.title ? l.username : undefined })),
    onPick: (it) => { const l = list.find((x) => x.id === it.id); if (l) void fill(id, l) } })
}

function offered(m: Record<string, unknown>) {
  const site = String(m.site ?? ""), user = String(m.username ?? ""), update = m.kind === "update"
  notify(update ? `Update your password for ${user ? `${user} on ` : ""}${site}?` : `Save your login for ${site}${user ? ` (${user})` : ""} to your passwords?`, {
    id: `passwords-offer-${String(m.offer)}`, duration: 20_000,
    action: { label: update ? "Update password" : "Save", run: async () => {
      await engine("passwords:save-offer", m.offer)
      notify(update ? "Updated in your passwords" : "Saved to your passwords")
    } },
  })
}

export function watchLogins() {
  if (!webPages?.engine) return
  void engine("passwords:forms").then((ids) => { if (Array.isArray(ids)) forms.set(new Set(ids.filter((x): x is number => typeof x === "number"))) }, () => {})
  return webPages.on((m) => {
    if (m.type === "engine:passwords:form" && typeof m.id === "number") {
      const id = m.id, on = m.on === true
      if (forms.get().has(id) !== on) forms.update((s) => { const next = new Set(s); if (on) next.add(id); else next.delete(id); return next })
    } else if (m.type === "engine:passwords:changed") changes.update((n) => n + 1)
    else if (m.type === "engine:passwords:offer" && typeof m.offer === "string") offered(m)
  })
}

export function LoginButton({ id, url }: { id: number; url: string }) {
  const form = forms.use((s) => s.has(id))
  const version = changes.use()
  const [logins, setLogins] = useState<Login[] | null>(null)
  useEffect(() => {
    if (!form) return setLogins(null)
    let gone = false
    loginsFor(id).then((l) => { if (!gone) setLogins(l) }, () => { if (!gone) setLogins(null) })
    return () => { gone = true }
  }, [id, url, form, version])
  if (!form || !logins?.length) return null
  return (
    <button type="button" aria-label="Fill login" aria-haspopup="menu" data-tip="Fill login" data-web-login
      onClick={(e) => menuBelow(e, logins.map((l) => ({ label: nameOf(l), hint: l.title ? l.username : undefined, run: () => void fill(id, l) })))}
      className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground">
      <KeyRound className="size-3.5" strokeWidth={2} />
    </button>
  )
}
