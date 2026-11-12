import type { ReactNode } from "react"
import { Blocks, Code, FileText, Files, FolderOpen, Loader, Radio, Settings2, SlidersHorizontal, SquareCheck, TableProperties } from "lucide-react"
import { openMenu, replaceMenu, type MenuItem } from "@/components/ContextMenu"
import { canReveal, openOnComputer } from "@/components/FileActions"
import { editAt } from "@/core/anchors"
import { get } from "@/core/http"
import { folderOf, isReadOnly, openFile, stem } from "@/core/files"
import { openPluginSettings } from "@/core/pluginSettings"
import { blockFor } from "@/core/plugins"
import { parseOptions } from "../../../core/blocks.ts"
import { showLabel } from "@/core/platform"
import { getPrefs } from "@/core/prefs"
import { revealProperties } from "@/core/viewstate"
import type { BlockEdit } from "@/editor/livePreview"
import { capitalize } from "@/lib/utils"

type Source =
  | { kind: "file"; path: string }
  | { kind: "files"; collection: string; type: string; paths: string[] }
  | { kind: "settings"; plugin: string; label: string; path: string }
  | { kind: "live"; plugin: string; label: string; folders: { path: string; label: string }[] }
type Sources = { name: string; path: string; line: number | null; sources: Source[] }

export type BlockRef = { name: string; text: string; path: string; nth?: number; edit?: BlockEdit; options?: () => void; showing?: boolean; el?: HTMLElement }

const SHOWN = 8

const fileItem = (path: string): MenuItem => ({ label: stem(path), icon: FileText, hint: folderOf(path) || undefined, run: () => openFile(path) })

function sourceItems(found: Sources | Error | null, here: string): MenuItem[] {
  if (found === null) return [{ label: "Finding where its data comes from…", icon: Loader, caption: true, run: () => {} }]
  if (found instanceof Error) return [{ label: `Couldn't find where its data comes from: ${found.message}`, caption: true, run: () => {} }]
  const files = found.sources.flatMap((s) => (s.kind === "file" ? [s.path] : []))
  const out: MenuItem[] = files.slice(0, SHOWN).map((f) => f === here
    ? { label: "This file's properties", icon: TableProperties, run: () => revealProperties(f) } : fileItem(f))
  if (files.length > SHOWN) out.push({ label: `${files.length - SHOWN} more`, icon: Files, run: () => {}, items: files.slice(SHOWN).map(fileItem) })
  for (const s of found.sources) {
    if (s.kind === "files") out.push({ label: capitalize(s.collection), icon: Files, hint: `${s.paths.length}`, run: () => {}, items: s.paths.map(fileItem) })
    else if (s.kind === "settings") out.push({ label: s.label, icon: Settings2, run: () => openPluginSettings(s.plugin) })
  }
  for (const s of found.sources) {
    if (s.kind !== "live") continue
    out.push({ label: `Live: ${s.label}`, icon: Radio, caption: true, run: () => {} })
    if (canReveal()) for (const f of s.folders ?? []) out.push({ label: f.label, icon: FolderOpen, hint: showLabel, run: () => void openOnComputer(f.path) })
  }
  return out.length ? out : [{ label: "It reads no files.", caption: true, run: () => {} }]
}

export function openBlockMenu(at: { x: number; y: number }, b: BlockRef) {
  const { name, text, path, edit } = b
  const { plugin, decl } = blockFor(name, getPrefs().disabled, parseOptions(text).options)
  const fence = name.startsWith("```")
  const what = fence ? `A ${name.slice(3)} block` : `The ${name} block`
  const head: MenuItem = { label: `${what}${plugin ? ` (${plugin.name})` : ""}${decl?.description ? `: ${decl.description}` : ""}`, icon: Blocks, caption: true, run: () => {} }
  let line: number | null = null
  const toSource = () => {
    if (edit?.source) return edit.source()
    if (line === null) return openFile(path)
    const y = b.el ? topOf(b.el) : null
    editAt(path, line + 1, y === null ? {} : { from: { line, y } })
  }
  const tail = (): MenuItem[] => b.showing ? [{ label: "Done", icon: SquareCheck, run: () => edit?.done() }] : [
    ...(decl?.options && Object.keys(decl.options).length && path && !isReadOnly(path)
      ? [{ label: "Options", icon: SlidersHorizontal, run: () => (b.options ? b.options() : toSource()) }] : []),
    ...(path ? [{ label: "Edit source", icon: Code, run: toSource }] : []),
  ]
  const build = (found: Sources | Error | null): MenuItem[] => {
    const rows = sourceItems(found, path), end = tail()
    return [head, { ...rows[0], sep: true }, ...rows.slice(1), ...end.map((x, i) => (i ? x : { ...x, sep: true }))]
  }
  if (!path) { openMenu(at, [head, ...tail()]); return }
  const first = build(null)
  openMenu(at, first)
  const nth = b.nth ?? edit?.nth()
  const q = new URLSearchParams({ path, name, text, ...(nth !== undefined ? { nth: String(nth) } : {}) })
  get<Sources>(`blocks/sources?${q}`).then(
    (s) => { line = s.line; replaceMenu(first, build(s)) },
    (e) => replaceMenu(first, build(e instanceof Error ? e : new Error(String(e)))),
  )
}

function topOf(el: HTMLElement): number | null {
  const tops = [...el.children].map((c) => c.getBoundingClientRect()).filter((r) => r.height).map((r) => r.top)
  return el.isConnected && tops.length ? Math.min(...tops) : null
}

export function BlockSource({ menu, name, children }: { menu: (at: { x: number; y: number }, el: HTMLElement) => void; name: string; children: ReactNode }) {
  return (
    <div className="contents" data-block={name} data-hold-menu
      onContextMenu={(e) => {
        if (e.defaultPrevented) return
        e.preventDefault(); e.stopPropagation(); menu({ x: e.clientX, y: e.clientY }, e.currentTarget)
      }}>
      {children}
    </div>
  )
}
