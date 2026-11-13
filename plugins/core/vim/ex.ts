import { notify, openFile, openInSplit, resolver, runCommandById, runCommandNamed, type Store } from "@vaultite"
import { showHelp } from "./app"
import { openVimrc } from "./vimrc"

let store: Store | null = null
export const setExStore = (s: Store) => { store = s }

function fileNamed(name: string) {
  if (!store) return null
  const t = resolver(store)(name.trim())
  return t?.file ?? null
}

function open(name: string, how: "here" | "tab" | "right" | "down") {
  if (!name) {
    if (how === "right") return runCommandById("split:right")
    if (how === "down") return runCommandById("split:down")
    if (how === "tab") return runCommandById("tab:new")
    return runCommandById("switcher:open")
  }
  const file = fileNamed(name)
  if (!file) return notify(`No file named ${name}`, { kind: "error" })
  if (how === "right" || how === "down") return openInSplit(`file:${file}`, how === "down" ? "bottom" : "right")
  openFile(file, { newTab: how === "tab" })
}

function command(arg: string) {
  const want = arg.trim()
  if (!want) return runCommandById("palette:open")
  if (!runCommandNamed(want)) notify(`No command ${want}`, { kind: "error" })
}

const quit = () => { if (!runCommandById("pane:close")) runCommandById("tab:close") }

export type Ex = { name: string; short: string; usage: string; help: string; run: (arg: string, bang: boolean) => void }

export const EX: Ex[] = [
  { name: "edit", short: "e", usage: ":e [name]", help: "Open a file by name, or the quick switcher", run: (a) => open(a, "here") },
  { name: "tabedit", short: "tabe", usage: ":tabe [name]", help: "Open a file in a new tab", run: (a) => open(a, "tab") },
  { name: "tabnew", short: "tabnew", usage: ":tabnew [name]", help: "Open a file in a new tab", run: (a) => open(a, "tab") },
  { name: "split", short: "sp", usage: ":sp [name]", help: "Split down, with a file", run: (a) => open(a, "down") },
  { name: "vsplit", short: "vs", usage: ":vs [name]", help: "Split right, with a file", run: (a) => open(a, "right") },
  { name: "new", short: "new", usage: ":new", help: "Create a new note", run: () => runCommandById("file:new") },
  { name: "quit", short: "q", usage: ":q", help: "Close the pane, or its tab", run: quit },
  { name: "wq", short: "wq", usage: ":wq", help: "Close the pane, or its tab (files save as you type)", run: quit },
  { name: "xit", short: "x", usage: ":x", help: "Close the pane, or its tab (files save as you type)", run: quit },
  { name: "write", short: "w", usage: ":w", help: "Nothing to do: files save as you type", run: () => {} },
  { name: "only", short: "on", usage: ":only", help: "Close the other tabs", run: () => runCommandById("tab:close-others") },
  { name: "bnext", short: "bn", usage: ":bn", help: "Go to the next tab", run: () => runCommandById("tab:next") },
  { name: "bprevious", short: "bp", usage: ":bp", help: "Go to the previous tab", run: () => runCommandById("tab:previous") },
  { name: "tabnext", short: "tabn", usage: ":tabn", help: "Go to the next tab", run: () => runCommandById("tab:next") },
  { name: "tabprevious", short: "tabp", usage: ":tabp", help: "Go to the previous tab", run: () => runCommandById("tab:previous") },
  { name: "cmd", short: "cmd", usage: ":cmd <command id>", help: "Run a command of the palette", run: (a) => command(a) },
  { name: "obcommand", short: "obcommand", usage: ":obcommand <command id>", help: "Run a command by its id", run: (a) => command(a) },
  { name: "vimrc", short: "vimrc", usage: ":vimrc", help: "Open the vimrc", run: () => void openVimrc() },
  { name: "help", short: "h", usage: ":help", help: "Show Vim's keys", run: () => showHelp() },
]

export function exNamed(name: string) {
  return EX.find((x) => x.name === name || (name.length >= x.short.length && x.name.startsWith(name) && name.startsWith(x.short)))
}

export function runEx(line: string) {
  const m = /^\s*:?\s*([a-zA-Z]+)(!?)\s*(.*)$/.exec(line)
  if (!m) return false
  const ex = exNamed(m[1])
  if (!ex) { notify(`Not a command: ${m[1]}`, { kind: "error" }); return false }
  ex.run(m[3].trim(), m[2] === "!")
  return true
}
