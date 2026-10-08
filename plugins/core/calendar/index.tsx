import { CalendarDays } from "lucide-react"
import { definePlugin, today } from "@vaultite"
import { AgendaPanel } from "./Agenda"

export default definePlugin({
  icon: CalendarDays,
  // ```block-agenda: today's and the coming days' events (on Today).
  blocks: { agenda: () => <AgendaPanel /> },
  preview: "today",
  mockLive: () => {
    const t = today()
    return {
      calendar: { configured: true, events: [
        { calendar: "Personal", title: "Yoga", location: "", start: `${t}T18:00:00`, end: `${t}T19:30:00`, all_day: false },
        { calendar: "Personal", title: "Call with Alex", location: "", start: `${t}T21:00:00`, end: `${t}T21:30:00`, all_day: false },
      ] },
    }
  },
})
