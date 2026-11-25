import { z } from "zod"
import { AppWindow } from "./appwindow.ts"
import { nicknameAt, saveNicknameAt } from "../core/nickname.ts"
import { nicknameText, nicknameTyped } from "../core/vaultname.ts"
import type { Call } from "./host.ts"
import { sandboxPath } from "./sandbox.ts"
import { writeAtomic } from "./setup.ts"
import { homeChanged, kept, popouts, wins } from "./servers.ts"
import { buildMenu, find, type Known, save } from "./vaultlist.ts"
import { manager, titleOf } from "./vaultwindow.ts"

export async function learn(vs: Known[]) {
  const now = await Promise.all(vs.map((v) => nicknameAt(v.path)))
  take(vs.flatMap((v, i): [Known, string][] => { const n = now[i]; return n === null ? [] : [[v, n]] }))
}

function take(heard: [Known, string][]) {
  const changed = heard.filter(([v, n]) => n !== (v.nickname ?? ""))
  if (!changed.length) return
  for (const [v, n] of changed) { if (n) v.nickname = n; else delete v.nickname }
  save()
  buildMenu()
  homeChanged()
  for (const w of wins.values()) tell(w.win, titleOf(w.vault.path))
  for (const [page, w] of popouts) tell(AppWindow.fromWebContents(page), titleOf(w.vault.path))
  tell(manager)
}

function tell(win: AppWindow | null, title?: string) {
  if (!win || win.isDestroyed()) return
  if (title) win.setTitle(title)
  win.webContents.send("vaultite", { type: "vaults" })
}

const Said = z.tuple([z.string()])
export function heardNickname(v: Known, m: Call) {
  const said = Said.safeParse(m.args)
  if (said.success) take([[v, nicknameText(said.data[0])]])
}

export async function setNickname(p: string, typed: string) {
  const v = find(p)
  if (!v || p === sandboxPath()) throw new Error("that vault has no nickname to set")
  const nickname = nicknameTyped(typed, p), port = wins.get(p)?.port ?? kept.get(p)?.port
  if (port) await patchServed(port, nickname); else await saveNicknameAt(p, nickname, writeAtomic)
  take([[v, nickname ?? ""]])
}

async function patchServed(port: number, name: string | null) {
  const r = await fetch(`http://127.0.0.1:${port}/api/config/vault`, { method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }), signal: AbortSignal.timeout(10_000) })
  if (!r.ok) throw new Error(`the vault's server answered ${r.status}`)
}
