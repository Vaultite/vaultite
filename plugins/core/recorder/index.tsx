// Bug recorder: records while it's on (record.ts), and Report a bug saves the last minutes as a note (report.ts).
import { Bug } from "lucide-react"
import { definePlugin } from "@vaultite"
import { Recorder } from "./Recorder"
import { reportBug } from "./report"

export default definePlugin({
  commands: [{ id: "recorder:report", name: "Report a bug", icon: Bug, run: reportBug }],
  background: () => <Recorder />,
})
