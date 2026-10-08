import { User } from "lucide-react"
import { definePlugin } from "@vaultite"
import "./types"

// Me: the user's own file (ME.md), drawn as a note with a person's icon; plugin.ts reads it and says where it is.
export default definePlugin({
  icon: User,
  files: { types: ["me"], icon: User, tint: "var(--people)" },
})
