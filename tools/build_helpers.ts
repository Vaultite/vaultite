// The desktop app's native helpers, built so a Mac without Xcode's tools has them (npm run app:build): the Audio recorder's
// transcriber into its plugin's bin/, named for its source's hash, one file for Apple silicon and Intel. Without the
// tools it says so and goes on.
import path from "node:path"

const { buildHelper } = await import("../plugins/core/audio-recorder/plugin.ts")
const dir = path.join(import.meta.dirname, "..", "plugins", "core", "audio-recorder", "bin")
try {
  console.log(`helpers: ${path.relative(process.cwd(), await buildHelper(dir, ["arm64", "x86_64"]))}`)
} catch (e) {
  console.warn(`helpers: the transcriber wasn't built (${(e as Error).message}); the app builds it where it can`)
}
