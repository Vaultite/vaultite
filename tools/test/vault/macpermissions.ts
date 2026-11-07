import { execFileSync } from "node:child_process"
import path from "node:path"
import type { VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { check, tmp } = $
  // macOS's permissions (core/permissions.ts): a button only where it does something, and System Settings' macOS 13 links.
  {
    const { PERMISSIONS, actionOf, paneUrl } = await import("../../../core/permissions.ts")
    const def = (id: string) => PERMISSIONS.find((d) => d.id === id)!
    check("permissions: a list's Allow drags the app in; a prompt asks, then opens Settings after a no",
      actionOf(def("accessibility"), "denied") === "drag" && actionOf(def("full-disk"), "denied") === "drag" && actionOf(def("input"), "not-asked") === "drag" &&
      actionOf(def("camera"), "not-asked") === "ask" && actionOf(def("location"), "not-asked") === "ask" && actionOf(def("location"), "denied") === "settings" &&
      actionOf(def("microphone"), "allowed") === "none" && actionOf(def("screen"), "allowed") === "none")
    check("permissions: what macOS asks on first use has no button before it asked; a folder can be read to find out",
      actionOf(def("automation"), "unknown") === "none" && actionOf(def("documents"), "unknown") === "check" && actionOf(def("documents"), "denied") === "settings")
    check("permissions: links to Privacy & Security's panes in macOS 13's form",
      paneUrl("Privacy_AllFiles") === "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles" &&
      PERMISSIONS.every((d) => d.pane.startsWith("Privacy_")))
  }
  // The addon (electron/macpermissions.m), built and loaded in plain Node: it reads without asking, finds System Settings'
  // window from the window server, and places the drag panel by it. Nothing is shown and nothing asks.
  let tools = process.platform === "darwin"
  try { if (tools) execFileSync("/usr/bin/xcode-select", ["-p"], { stdio: "ignore" }) } catch { tools = false }
  if (tools) {
    const { buildMacAddon, loadMacAddon } = await import("../../../electron/macaddons.ts")
    const mac = loadMacAddon(await buildMacAddon("macpermissions", path.join(tmp, "macpermissions")))
    const frame = mac.call({ cmd: "frame" }).settings as { width: number } | null
    check("macpermissions: System Settings' window, or none, without a permission", frame === null || frame.width > 320, frame)
    check("macpermissions: Input monitoring read without asking", ["allowed", "denied", "not-asked"].includes(mac.call({ cmd: "input" }).state as string))
    check("macpermissions: no panel until one is shown", mac.call({ cmd: "panel" }).open === false)
    const screen = { x: 0, y: 0, width: 1512, height: 944 }
    const under = mac.call({ cmd: "place", settings: { x: 100, y: 300, width: 715, height: 600 }, visible: screen })
    const low = mac.call({ cmd: "place", settings: { x: 100, y: 20, width: 715, height: 600 }, visible: screen })
    const edge = mac.call({ cmd: "place", settings: { x: 1300, y: 300, width: 715, height: 600 }, visible: screen })
    check("macpermissions: the panel goes under the window, centred under its list",
      under.y === 300 - 10 - (under.height as number) && Math.abs((under.x as number) + (under.width as number) / 2 - (100 + 215 + (715 - 215) / 2)) <= 1, under)
    check("macpermissions: with no room below, inside the window's bottom; never off the screen",
      low.y === 40 && (edge.x as number) + (edge.width as number) <= 1512 - 10, [low, edge])
    let threw = ""
    try { mac.call({ cmd: "nope" }) } catch (e) { threw = (e as Error).message }
    check("macpermissions: an unknown command says so", threw.includes("no command"), threw)
    // The gestures addon (electron/gestures.m): which windows' pinches go to the page under them, by window number.
    const gestures = loadMacAddon(await buildMacAddon("gestures", path.join(tmp, "gestures")))
    const passing = [gestures.call({ cmd: "pass", window: 41, on: true }), gestures.call({ cmd: "pass", window: 42, on: true }), gestures.call({ cmd: "pass", window: 41, on: false })]
    check("gestures: windows passing pinches on, then off", passing.map((r) => r.passing).join() === "1,2,1", passing)
    let bare = ""
    try { gestures.call({ cmd: "pass", on: true }) } catch (e) { bare = (e as Error).message }
    check("gestures: a pass names its window", bare.includes("window"), bare)
    // The menus addon (electron/menus.m): the menu bar menu's section headers drawn bold, on from then on.
    const menus = loadMacAddon(await buildMacAddon("menus", path.join(tmp, "menus")))
    const bold = [menus.call({ cmd: "boldHeaders" }), menus.call({ cmd: "boldHeaders" })]
    check("menus: bold headers on, twice the same", bold.every((r) => r.on === true), bold)
  }
}
