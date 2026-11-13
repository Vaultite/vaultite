import { check, section } from "../lib.ts"
import { same } from "./lib.ts"

await section("the app's commands read from source", async () => {
  const { commandList } = await import("../../../core/appsource.ts")
  const all = new Map(commandList([]).map((c) => [c.id, c]))
  const keys = (id: string) => all.get(id)?.keys
  check("a command's keys are its keys: not its label or words, each once across an isMac ternary",
    same(keys("tab:close"), ["Mod+W"]) && same(keys("tab:close-focused"), ["Backspace", "Delete"]) && same(keys("focus:menu"), ["Shift+F10"])
      && same(keys("split:close"), ["Mod+Alt+Shift+W"]) && same(keys("tab:search"), ["Mod+Shift+A"]) && same(keys("file:actions"), ["Mod+.", "Alt+Enter"]),
    ["tab:close", "tab:close-focused", "focus:menu", "split:close", "tab:search", "file:actions"].map((id) => [id, keys(id)]))
  check("a desktop-only key is noted, and a chord's escaped backslash is read", all.get("tab:close")?.note === "desktop app only"
    && same(keys("terminal:leave"), ["Ctrl+\\ Ctrl+N"]), [all.get("tab:close"), keys("terminal:leave")])
  const odd = [...all.values()].flatMap((c) => c.keys.filter((k) => !/^\S+( \S+)?$/.test(k)).map((k) => `${c.id}: ${k}`))
  check("no command's keys hold prose", !odd.length, odd)
})
