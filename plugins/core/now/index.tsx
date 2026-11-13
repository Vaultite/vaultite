import { Compass } from "lucide-react"
import { definePlugin } from "@vaultite"
import "./types"

export default definePlugin({
  files: { types: ["now"], icon: Compass, tint: "var(--people)" },
})
