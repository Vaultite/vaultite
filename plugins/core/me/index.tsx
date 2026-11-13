import { User } from "lucide-react"
import { definePlugin } from "@vaultite"
import "./types"

export default definePlugin({
  files: { types: ["me"], icon: User, tint: "var(--people)" },
})
