// The desktop app's native helpers, built so a Mac without Xcode's tools has them (npm run app:build): the transcriber
// and dictation's, both architectures, named by their sources' hash. Without the tools it says so and goes on.
import path from "node:path"

const { buildHelper } = await import("../plugins/core/audio-recorder/plugin.ts")
const { buildDictation } = await import("../electron/dictation-build.ts")
const root = path.join(import.meta.dirname, "..")
const builds: [string, () => Promise<string>][] = [
  ["the transcriber", () => buildHelper(path.join(root, "plugins", "core", "audio-recorder", "bin"), ["arm64", "x86_64"])],
  ["dictation", () => buildDictation(path.join(root, "electron", "bin"), ["arm64", "x86_64"])],
]
for (const [name, build] of builds) {
  try {
    console.log(`helpers: ${path.relative(process.cwd(), await build())}`)
  } catch (e) {
    console.warn(`helpers: ${name} wasn't built (${(e as Error).message}); the app builds it where it can`)
  }
}
