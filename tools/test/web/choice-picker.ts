import fs from "node:fs"
import path from "node:path"
import { check } from "../lib.ts"
import { type Any, ROOT, WEB, web } from "./lib.ts"

// ---------- Settings of a few values as palette pickers (web/src/core/choicePicker.ts) ----------
{
  const cp: Any = await web("core/choicePicker.ts")
  let value = "natural", shown: string | null = null
  const toasts: [string, () => void][] = []
  const def = { id: "setting:animation", name: "Animations", options: () => [{ value: "natural", label: "Natural" }, { value: "snappy", label: "Snappy" }, { value: "off", label: "Off" }],
    get: () => value, set: (v: string) => { value = v }, preview: (v: string | null) => { shown = v } }
  const p = cp.choicePicker(def, (text: string, undo: () => void) => toasts.push([text, undo]))
  check("choices: a picker of its values named as Settings names them, the one in use checked",
    p.title === "Animations" && p.placeholder === "Animations…" && p.current === "natural" && p.items.map((i: Any) => i.label).join() === "Natural,Snappy,Off", p)
  p.preview(p.items[2]); const moved = shown; p.preview(null)
  check("choices: moving shows a value for now, saved nowhere; closing goes back", moved === "off" && shown === null && value === "natural", [moved, shown, value])
  p.onPick(p.items[0])
  check("choices: picking the one in use changes nothing, says nothing", value === "natural" && !toasts.length)
  p.onPick(p.items[1])
  check("choices: picking another keeps it, saying so with Undo", value === "snappy" && toasts[0]?.[0] === "Animations: Snappy", toasts)
  toasts[0][1]()
  check("choices: Undo puts back the one before", value === "natural" && cp.choiceLabel(def) === "Natural")
  check("choices: no preview where the setting can't show one", cp.choicePicker({ ...def, preview: undefined }, () => {}).preview === undefined)

  // A plugin's enum (its manifest's), numbers too: the default again takes the key out.
  let data: Record<string, unknown> = {}, over: unknown = "unset"
  const store = { get: () => data, set: (k: Record<string, unknown>) => { data = Object.fromEntries(Object.entries({ ...data, ...k }).filter(([, v]) => v !== null)) }, preview: (k: unknown) => { over = k } }
  const decl = { type: "enum", values: [10, 20, 30], default: 20, label: "Row height", labels: { 10: "Short" }, description: "how tall rows are", preview: true }
  const pc = cp.declChoice({ id: "lists", name: "Lists" }, "height", decl, 20, store)
  check("choices: a plugin's enum, labelled from its manifest, its default in use", pc.id === "setting:lists:height" && pc.get() === "20" && pc.sub() === "How tall rows are"
    && pc.options().map((o: Any) => o.label).join() === "Short,20,30" && pc.plugin.key === "height", [pc.get(), pc.options()])
  pc.set("10"); const set10 = data.height; pc.set("20")
  check("choices: a plugin's value saved as its own type; the default removes the key", set10 === 10 && !("height" in data), [set10, data])
  pc.preview("30"); const prev = JSON.stringify(over); pc.preview(null)
  check("choices: a plugin's enum with preview shows its value for now", prev === '{"height":30}' && over === null, prev)
  data = { height: 99 }
  check("choices: a value the file has that isn't one of them reads as the default", pc.get() === "20", pc.get())
  check("choices: no preview unless the manifest asks", cp.declChoice({ id: "lists", name: "Lists" }, "height", { ...decl, preview: undefined }, 20, store).preview === undefined)
}

{
  // A :has() on the whole page (:root, html, body) is checked again on every DOM change anywhere: typing in a note
  // recalculated 4x the styles with two of them. Which sidebar is there is an attribute App.tsx sets instead.
  const css = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory()
    ? (e.name === "node_modules" ? [] : css(path.join(d, e.name))) : e.name.endsWith(".css") ? [path.join(d, e.name)] : [])
  const pagewide = [WEB, path.join(ROOT, "plugins")].flatMap(css).flatMap((f) =>
    [...fs.readFileSync(f, "utf8").matchAll(/(?:^|[\s,{}(])(?::root|html|body)(?:\[[^\]]*\]|:not\((?!:has)[^)]*\))*:(?:not\(:)?has\(/gm)].map((m) => `${path.relative(ROOT, f)}: ${m[0].trim()}`))
  check("styles: no :has() on the whole page (:root, html, body)", !pagewide.length, pagewide)
}

{
  // A manifest's "⌥⌘F" reads as Linux and Windows name the keys there, a Mac's as written.
  const { keysText } = await import("../../../web/src/core/platform.ts")
  const off = (t: string) => keysText(t, false)
  check("keys in text: off a Mac, Ctrl, Alt and Shift", off("Find (⌘F), and replace (⌥⌘F); ⇧⌘T") === "Find (Ctrl+F), and replace (Ctrl+Alt+F); Ctrl+Shift+T", off("Find (⌘F), and replace (⌥⌘F); ⇧⌘T"))
  check("keys in text: a key bar's labels", off("⇧tab") === "Shift+tab" && off("⌃C") === "Ctrl+C", [off("⇧tab"), off("⌃C")])
  check("keys in text: a key alone, or before -click", off("hold ⌘. ⌘-click, ⌘ held") === "hold Ctrl. Ctrl-click, Ctrl held" && keysText("⌥⌘F", true) === "⌥⌘F", off("hold ⌘. ⌘-click, ⌘ held"))
}

{
  // Every scheme's ten colours (tab groups, workspaces, labels pick from them) tell apart: CIE76 distance at least 10.
  const { COLORS } = await import("../../../core/colors.ts")
  const lab = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92 })
    const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116)
    const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), y = f(r * 0.2126 + g * 0.7152 + b * 0.0722), z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883)
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
  }
  const files = [path.join(WEB, "index.css"), ...fs.readdirSync(path.join(WEB, "themes")).filter((f) => f.endsWith(".css")).map((f) => path.join(WEB, "themes", f))]
  const alike = files.flatMap((f) => fs.readFileSync(f, "utf8").split(/--red:/).slice(1).flatMap((block, i) => {
    const v = Object.fromEntries(COLORS.map((c) => [c, c === "red" ? /^\s*(#[0-9a-f]{6})/i.exec(block)?.[1] : new RegExp(`--${c}:\\s*(#[0-9a-f]{6})`, "i").exec(block)?.[1]]))
    return COLORS.flatMap((a, j) => COLORS.slice(j + 1).filter((b) => v[a] && v[b] && Math.hypot(...lab(v[a]!).map((x, k) => x - lab(v[b]!)[k])) < 10)
      .map((b) => `${path.basename(f)} #${i + 1}: ${a} ${v[a]} ~ ${b} ${v[b]}`))
  }))
  check("schemes: each one's ten colours tell apart", !alike.length, alike)
}

{
  const { plainError } = await import("../../../core/plainerror.ts")
  const said = (e: unknown) => plainError(e).reason
  const http = (status: number, message: string) => Object.assign(new Error(message), { status })
  check("errors: an exception's text is never the reason, and is a bug kept in Errors",
    [new TypeError("Class extends value undefined is not a constructor or null"), new Error("Cannot read properties of undefined (reading 'x')"),
      http(500, "x.map is not a function"), http(400, "Cannot read properties of undefined (reading 'enabled')"), new Error("the server stopped (exit 1)\nat start (server.ts:3:1)"), "", null]
      .every((e) => said(e) === null && plainError(e).bug))
  check("errors: the details keep the exact text", plainError(new TypeError("Class extends value undefined")).detail.includes("TypeError: Class extends value undefined"))
  check("errors: a system call's code and a lost connection read as what to do, not bugs",
    said(new Error("EACCES: permission denied, open '/a/b'")) === "Vaultite isn't allowed to open it" && said(Object.assign(new Error("x"), { code: "ENOSPC" })) === "the disk is full" &&
    said(new TypeError("Failed to fetch")) === "the server didn't answer" && !plainError(new TypeError("Load failed")).bug)
  check("errors: the server's refusals and the app's own messages are shown as written",
    said(http(409, "A file called Plan already exists.")) === "A file called Plan already exists" && said(http(400, "path: a vault file, like {folder}/{name}.md")) !== null && said(new Error("That isn't a web address")) === "That isn't a web address" &&
    said("Error invoking remote method 'setup:create': Error: The vault needs a name") === "The vault needs a name")
}
