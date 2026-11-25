import { followLink, getStore, linkClick, openFile, openOutside, openWebLink, splitMachine } from "@vaultite"
import type { LinkAction } from "./vt/links"

const filePath = (uri: string) => {
  try {
    const path = decodeURIComponent(new URL(uri).pathname)
    return /^\/[a-z]:\//i.test(path) ? path.slice(1) : path
  } catch { return null }
}

function fileAction(uri: string, machine: string): LinkAction | null {
  const path = filePath(uri), s = getStore()
  if (!path || !s || machine) return null
  const root = `${s.vault.path.replace(/\\/g, "/").replace(/\/+$/, "")}/`
  if (!path.startsWith(root)) return { open: () => void openOutside(path) }
  const rel = path.slice(root.length)
  return { open: (e) => openFile(rel, { newTab: linkClick(e).newTab }), target: { wiki: rel } }
}

export function linkAction(uri: string, terminal: string): LinkAction | null {
  if (/^https?:/i.test(uri)) return { open: (e) => openWebLink(uri, linkClick(e)), target: { url: uri } }
  if (/^mailto:/i.test(uri)) return { open: () => { const s = getStore(); if (s) void followLink(s, { url: uri }, false) }, target: { url: uri } }
  return /^file:/i.test(uri) ? fileAction(uri, splitMachine(terminal)[1]) : null
}
