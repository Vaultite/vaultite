import { Bot, CircleCheck, Pin } from "lucide-react"
import { definePlugin } from "@vaultite"
import { AgentsPanel, AgentsView } from "./AgentsPanel"
import { currentRun, marksNow, pin, settleAndNext } from "./marks"

const onScreen = () => !!currentRun()

export default definePlugin({
  views: { agents: { icon: Bot, title: () => "Agents", render: () => <AgentsView /> } },
  sidebar: { agents: { title: "Agents", names: ["agents", "sessions", "coding agents", "where agents run"], heading: false, side: "right", sort: 29, view: "agents",
    render: (ctx) => <AgentsPanel open={ctx.open} tab={ctx.tab} /> } },
  commands: [
    { id: "agents:pin", name: "Pin current session", nameWhenOn: "Unpin current session", keys: ["Mod+Shift+P"], when: onScreen,
      on: () => { const r = currentRun(); return !!r && !!marksNow()[r.id]?.pinned }, run: () => { const r = currentRun(); if (r) pin(r) }, icon: Pin },
    { id: "agents:settle-next", name: "Settle current session and go to the next", keys: ["Mod+Shift+S"], when: onScreen, run: () => settleAndNext(), icon: CircleCheck },
  ],
})
