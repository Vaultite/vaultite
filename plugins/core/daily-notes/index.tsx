import { definePlugin, notifyError, op, openFile, today } from "@vaultite"

export default definePlugin({
  // Today's note, made when there's none yet where daily notes go, named and filled as the settings say (daily-note.open).
  commands: [{
    id: "daily-notes:today", name: "Open today's daily note",
    run: async () => {
      try { openFile((await op<{ path: string }>("daily-note.open", { date: today() })).path) } catch (e) { notifyError(e, "Couldn't open today's daily note") }
    },
    label: "Daily note",
  }],
})
