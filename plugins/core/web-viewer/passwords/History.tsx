import { useEffect, useState } from "react"
import { ChevronRight, Copy, Eye, EyeOff, RotateCcw } from "lucide-react"
import { Button, capitalize, cn, dateText, Foldable, Group, notify } from "@vaultite"
import { andList } from "../loginsets"
import { attempt } from "./actions"
import { DAY } from "./look"
import { Act, ColoredPassword, Field } from "./parts"
import { call, copyPassword, copyText } from "./store"
import type { Full, Past, Version } from "./types"

export function History({ e }: { e: Full }) {
  const [open, setOpen] = useState<number | null>(null)
  if (!e.history.length) return null
  return (
    <Foldable title="History" count={e.history.length} keep="passwords.history" dflt={false} data-password-history>
      {e.history.map((p) => <PastRow key={p.at} id={e.id} p={p} open={open === p.at} toggle={() => setOpen(open === p.at ? null : p.at)} />)}
    </Foldable>
  )
}

const whatChanged = (p: Past) => (p.changed.length ? `${capitalize(andList(p.changed))} changed` : "Saved with no changes")

const SHOWN = ["title", "username", "password", "website", "notes"]

function PastRow({ id, p, open, toggle }: { id: string; p: Past; open: boolean; toggle: () => void }) {
  return (
    <div>
      <button type="button" data-keyrow aria-expanded={open} onClick={toggle} data-password-past={p.at}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-control px-1.5 text-left hover:bg-foreground/[0.04] md:min-h-8">
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} strokeWidth={2.5} />
        <span className="min-w-0 flex-1 truncate text-[15px] md:text-[13px]">{whatChanged(p)}</span>
        <span className="shrink-0 text-[13px] text-tertiary tabular-nums md:text-[12px]">{dateText(p.until, DAY)}</span>
      </button>
      {open && <Was id={id} p={p} />}
    </div>
  )
}

function Was({ id, p }: { id: string; p: Past }) {
  const at = p.at, had = (what: string) => p.changed.includes(what)
  const [v, setV] = useState<Version | null>(null)
  const [password, setPassword] = useState<string | null>(null)
  useEffect(() => {
    let stop = false
    void attempt(async () => { const got = await call("version", id, at); if (!stop) setV(got) }, "Couldn't read that version")
    return () => { stop = true }
  }, [id, at])
  if (!v) return null
  const reveal = () => (password === null ? void attempt(async () => setPassword(await call("password", id, at)), "Couldn't read that password") : setPassword(null))
  const restore = () => void attempt(async () => { await call("restore", { id, at }); notify("Restored that version: the one it replaced is in its history") }, "Couldn't restore that version")
  return (
    <div className="mt-1 mb-3 ml-5 flex flex-col gap-2" data-password-version>
      {SHOWN.some(had) && <Group>
        {had("title") && <Field label="Title" value={v.title} />}
        {had("username") && <Field label="Username" value={v.username} actions={<Act icon={Copy} label="Copy that username" run={() => void copyText(v.username, "username")} />} />}
        {had("password") && v.password && <Field label="Password" mono={password !== null} value={password === null ? "•".repeat(12) : <ColoredPassword text={password} />} actions={<>
          <Act icon={password === null ? Eye : EyeOff} label={password === null ? "Show that password" : "Hide that password"} run={reveal} />
          <Act icon={Copy} label="Copy that password" run={() => void copyPassword(id, at)} />
        </>} />}
        {had("website") && v.urls.map((u) => <Field key={u} label="Website" value={u} />)}
        {had("notes") && <Field label="Notes" value={<span className="whitespace-pre-wrap">{v.notes}</span>} />}
      </Group>}
      <Button size="small" className="self-start" onClick={restore} data-password-restore><RotateCcw className="size-3.5" />Restore this version</Button>
    </div>
  )
}
