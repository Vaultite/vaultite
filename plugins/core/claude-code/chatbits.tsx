import { useEffect, useState } from "react"
import { DiffRows, get, textDiff, type DiffLine } from "@vaultite"
import type { Entry } from "./chatlog"
import { type Mode } from "./useChat"

export type Ask = Extract<Entry, { k: "ask" }>
export type Tool = Extract<Entry, { k: "tool" }>
export type Options = { models: { id: string; label: string }[]; efforts: string[]; modes: { id: Mode; label: string }[]; accounts: { id: string; label: string; model?: string; effort: string; mode: Mode }[]
  folders: string[]; vault: string; home: string }

export const TINT = "var(--orange)"
export const STRONG = "chat-strong bg-foreground text-background"

let options: Promise<Options> | null = null
const optionsOf = () => (options ??= get<Options>("claude-code/chat/options").catch((e) => { options = null; throw e }))
export function useOptions() {
  const [o, setO] = useState<Options | null>(null)
  useEffect(() => { let on = true; void optionsOf().then((x) => { if (on) setO(x) }, () => {}); return () => { on = false } }, [])
  return o
}

export const clipLine = (s: string) => { const l = s.replace(/[`*_#>]/g, "").replace(/\s+/g, " ").trim(); return l.length > 60 ? `${l.slice(0, 59).trimEnd()}…` : l }
export const home = (p: string, h = "") => (h && p.startsWith(h) ? `~${p.slice(h.length)}` : p.replace(/^\/Users\/[^/]+/, "~"))
export const base = (p: string) => p.split("/").filter(Boolean).pop() ?? p
export const folderName = (cwd: string, o: Options | null) => (o && cwd === o.vault ? "Vault" : base(cwd))
export function modelLabel(model: string, o: Options | null): string {
  // (a context size Claude Code takes after it, "opus[1m]": Opus 1M)
  const ctx = /^(.+)\[(\w+)\]$/.exec(model)
  if (ctx) return `${modelLabel(ctx[1], o)} ${ctx[2].toUpperCase()}`
  const alias = o?.models.find((m) => m.id === model)
  if (alias) return alias.label
  const parts = model.replace(/^claude-/, "").split("-").filter((p) => !(/^\d+$/.test(p) && p.length === 8))
  const words = parts.filter((p) => !/^\d+$/.test(p)), nums = parts.filter((p) => /^\d+$/.test(p))
  return [...words.map((w) => w[0]?.toUpperCase() + w.slice(1)), nums.join(".")].join(" ").trim() || "Default model"
}
export const EFFORT: Record<string, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" }
export const MODE_SHORT: Partial<Record<Mode, string>> = { default: "Ask", acceptEdits: "Edits", plan: "Plan", auto: "Auto", bypassPermissions: "Bypass" }
export const seconds = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`)

export const str = (v: unknown) => (typeof v === "string" ? v : "")

export function EditDiff({ file, edits }: { file: string; edits: { old_string?: string; new_string?: string }[] }) {
  const [lines, setLines] = useState<DiffLine[] | null>(null)
  useEffect(() => {
    let on = true
    void Promise.all(edits.map((x) => textDiff(x.old_string ?? "", x.new_string ?? "", 3))).then((ds) => { if (on) setLines(ds.flatMap((d, n) => (n ? [{ kind: "gap" as const, text: "", n: 0 }, ...d] : d))) })
    return () => { on = false }
  }, [edits])
  return (
    <div>
      {file && <div className="mb-1 truncate font-mono text-[12px] text-muted-foreground">{file}</div>}
      <div className="overflow-hidden rounded-card border-[0.5px] border-border">
        <div className="max-h-80 overflow-auto overscroll-contain edge-fade-x py-1.5 font-mono text-[12.5px] leading-[19px] select-text">{lines ? <DiffRows lines={lines} /> : null}</div>
      </div>
    </div>
  )
}
