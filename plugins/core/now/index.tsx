import { Compass } from "lucide-react"
import { definePlugin } from "@vaultite"
import "./types"

// Now: the user's Now note (Now.md), drawn as a note with a compass; plugin.ts reads it and says where it is.
export default definePlugin({
  files: { types: ["now"], icon: Compass, tint: "var(--people)" },
})
