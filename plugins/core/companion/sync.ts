import type { Vault } from "../../../core/vault.ts"
import "./pageops.ts"
import { plugin } from "./self.ts"
import { mode, ownName } from "./settings.ts"
import { agents, seen, broadcast, snapshot, offers, key, setAgent } from "./state.ts"
import { loadAll } from "./comments.ts"
import { session, sessions, running, isChat, stop } from "./alwayson.ts"
import { chat, chatOptions } from "./chat.ts"
import { lane } from "./lane.ts"
import { hearChats } from "./chatturns.ts"

async function rejoin() {
  hearChats()
  lane().serve()
  for (const x of sessions()) {
    if (isChat(x.id)) { const s = session(x.name); if (s) chat()?.serve(s.id, chatOptions(s.name, s)) }
    if (agents.has(key(x.name)) || !(await running(x.id).catch(() => false))) continue
    seen.set(key(x.name), Date.now())
    setAgent(x.name, {})
  }
}

export let loadedFor: Vault | null = null
let lastSaid = ""
plugin.onSync((vault) => {
  if (loadedFor !== vault) {
    loadedFor = vault
    loadAll(true)
    void rejoin(); setTimeout(() => void rejoin(), 5000).unref?.()
  }
  const now = JSON.stringify([mode(), ownName(), offers()])
  if (now === lastSaid) return
  if (lastSaid && mode() === "off") void stop(undefined, true).catch(() => {})
  lastSaid = now
  broadcast(snapshot())
})
