import { Bug } from "lucide-react"
import { definePlugin } from "@vaultite"
import { Recorder } from "./Recorder"
import { reportBug } from "./report"

export default definePlugin({
  commands: [{ id: "recorder:report", name: "Report a bug", icon: Bug, run: reportBug }],
  background: () => <Recorder />,
})
