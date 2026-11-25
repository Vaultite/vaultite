import { useRef, useState, type ReactNode } from "react"
import { ArrowRight, FingerprintPattern, KeyRound, Lock, LockKeyhole } from "lucide-react"
import { Button, capitalize, cn, notifyError, useBusy } from "@vaultite"
import { call, chooseFile, fileName, refresh } from "./store"
import type { Status } from "./types"

const field = "h-11 w-full min-w-0 rounded-control border-[0.5px] border-border bg-card px-3 text-[16px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/40 md:h-8 md:text-[13px]"

function Centered({ icon: Icon, title, children }: { icon: typeof Lock; title: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[340px] flex-col items-center px-4 pt-[12vh] pb-10 text-center">
      <span className="mb-4 grid size-16 place-items-center rounded-full bg-foreground/[0.06] text-muted-foreground"><Icon className="size-7" strokeWidth={1.75} /></span>
      <h2 className="mb-1 text-[20px] leading-[26px] font-semibold break-all">{title}</h2>
      {children}
    </div>
  )
}

export function Setup() {
  return (
    <div className="h-full overflow-y-auto" data-passwords-setup>
      <Centered icon={KeyRound} title="Your passwords">
        <p className="mb-5 text-[15px] leading-[20px] text-muted-foreground md:text-[13px] md:leading-[18px]">Open your KeePass file, the one KeePassXC or Strongbox opens, to use its passwords here.</p>
        <Button look="primary" onClick={() => void chooseFile()} data-passwords-choose>Choose your KeePass file…</Button>
      </Centered>
    </div>
  )
}

export function LockScreen({ status }: { status: NonNullable<Status> }) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, run] = useBusy()
  const input = useRef<HTMLInputElement>(null)
  const unlock = (given?: string) => void run(async () => {
    try {
      const r = await call("unlock", given)
      if (r?.error) { setError(capitalize(r.error)); if (given) input.current?.select(); return }
      setPassword(""); setError("")
      await refresh()
    } catch (e) { notifyError(e, "Couldn't unlock your passwords") }
  })
  const name = fileName(status.file)
  if (status.error) return (
    <Centered icon={LockKeyhole} title={name}>
      <p className="mb-5 text-[15px] leading-[20px] text-muted-foreground md:text-[13px] md:leading-[18px]" data-passwords-error>{capitalize(status.error)}.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => void chooseFile(status.file)}>Type its password…</Button>
        <Button look="quiet" onClick={() => void chooseFile()}>Use another file…</Button>
      </div>
    </Centered>
  )
  return (
    <Centered icon={LockKeyhole} title={name}>
      <p className="mb-5 text-[15px] text-muted-foreground md:text-[13px]">Locked</p>
      <div className="flex w-full flex-col gap-3" data-passwords-lock>
        {status.touchId && (
          <Button look="primary" className="w-full" busy={busy && !password} onClick={() => unlock()} data-passwords-touchid>
            <FingerprintPattern className="size-4" strokeWidth={2} />Unlock with Touch ID
          </Button>
        )}
        <form className="relative" onSubmit={(e) => { e.preventDefault(); if (password) unlock(password) }}>
          <input ref={input} type="password" value={password} autoFocus={!status.touchId} autoComplete="off" spellCheck={false}
            placeholder={status.touchId ? "Or type its password" : "Password"} aria-label="Password" aria-invalid={!!error || undefined}
            onChange={(e) => { setPassword(e.target.value); setError("") }} className={cn(field, "pr-10")} data-passwords-password />
          <button type="submit" aria-label="Unlock" data-tip="Unlock" disabled={!password || busy}
            className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-40 md:size-6">
            <ArrowRight className="size-4" strokeWidth={2.25} />
          </button>
        </form>
        {error && <p className="-mt-1 text-[13px] text-[var(--red)]" role="alert" data-passwords-unlock-error>{error}</p>}
      </div>
      <Button look="quiet" size="small" className="mt-6" onClick={() => void chooseFile()}>Use another file…</Button>
    </Centered>
  )
}
