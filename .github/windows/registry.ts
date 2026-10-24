// Set up's PATH on the real registry, once: adds a folder, checks a new process reads it and its kind is kept, then puts
// the user's PATH back exactly as it was.
import { execFileSync } from "node:child_process"
import * as S from "../../electron/setup.ts"
const was = S.registryPath.read(), dir = "C:\\vaultite-ci\\bin"
try {
  const added = S.addToPath(S.registryPath, dir)
  const now = S.registryPath.read()!
  const fresh = execFileSync("powershell.exe", ["-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('Path', 'User')"], { encoding: "utf8" })
  console.log(added && now.value.endsWith(`;${dir}`) && fresh.includes(dir) ? "added" : "NOT added",
    "kept", now.expand === (was ? was.expand : true) ? (now.expand ? "ExpandString" : "String") : "CHANGED", `(${was?.value.length} chars before)`)
  console.log("again adds nothing:", !S.addToPath(S.registryPath, dir))
} finally {
  if (was) S.registryPath.write(was.value, was.expand)
  else execFileSync("reg", ["delete", "HKCU\\Environment", "/v", "Path", "/f"])
  const back = S.registryPath.read()
  console.log(JSON.stringify(back) === JSON.stringify(was) ? "restored" : `NOT restored ${JSON.stringify([was, back])}`)
}
