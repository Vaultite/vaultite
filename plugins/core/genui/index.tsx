// Live answers: ```genui fences (ChatGPT's Intelligent UI, run sandboxed and drawn with the app's components) and
// ```chart fences.
import { definePlugin } from "@vaultite"
import "./genui.css"
import { GenUiFence } from "./GenUi"
import { ChartFence } from "./ChartFence"

export default definePlugin({
  fences: { genui: (ctx) => <GenUiFence {...ctx} />, chart: (ctx) => <ChartFence {...ctx} /> },
})
