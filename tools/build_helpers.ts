// The desktop app's native helpers (the transcriber, dictation's, the screen helper, the permissions addon), built for
// both architectures so a Mac without Xcode's tools has them (npm run app:build), named by their sources' hash.
import path from "node:path"

const { buildHelper } = await import("../plugins/core/audio-recorder/plugin.ts")
const { buildDictation } = await import("../electron/dictation-build.ts")
const { buildScreen } = await import("../electron/screen-build.ts")
const { buildMacPermissions } = await import("../electron/macpermissions-build.ts")
const root = path.join(import.meta.dirname, "..")
const builds: [string, () => Promise<string>][] = [
  ["the transcriber", () => buildHelper(path.join(root, "plugins", "core", "audio-recorder", "bin"), ["arm64", "x86_64"])],
  ["dictation", () => buildDictation(path.join(root, "electron", "bin"), ["arm64", "x86_64"])],
  ["the screen helper", () => buildScreen(path.join(root, "electron", "bin"), ["arm64", "x86_64"])],
  ["the permissions addon", () => buildMacPermissions(path.join(root, "electron", "bin"))],
]
for (const [name, build] of builds) {
  try {
    console.log(`helpers: ${path.relative(process.cwd(), await build())}`)
  } catch (e) {
    console.warn(`helpers: ${name} wasn't built (${(e as Error).message}); the app builds it where it can`)
  }
}
