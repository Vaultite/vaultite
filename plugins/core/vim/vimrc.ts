import { notify, openFile, post, readFile, notifyError } from "@vaultite"
import type { CodeMirrorV } from "@replit/codemirror-vim"
import type { CM, Vim } from "./editor"
import { VIMRC } from "./state"

export const TEMPLATE = `" Vim's commands for every editor, run before you type (like Neovim's init.vim).
" One per line; a line starting with a double quote is a comment. Some examples:
"
"   nmap j gj
"   nmap k gk
"   let mapleader = ","
"   nmap <leader>s :cmd switcher:open<CR>
"   exmap today cmd templates:insert
"   set tabstop=4
`

const MAP = /^(n|v|i|o|x|s|c)?(nore)?map!?$/
const UNMAP = /^(n|v|i|o|x|s|c)?unmap!?$/
const CLEAR = /^(n|v|i|o|x|s|c)?mapclear$/
const SET = /^(se|set|setlocal|setglobal)$/

let text: string | null = null
let applied: string | null = null
const open = new Set<CM>()
export function editorOpen(cm: CM, on: boolean) { if (on) open.add(cm); else open.delete(cm) }

async function fetchText() {
  try { return (await readFile(VIMRC)).text } catch { return "" }
}

const hasVim = (cm: CM): cm is CM & CodeMirrorV => !!cm.state.vim

function run(cm: CM, vim: Vim, src: string) {
  const problems: string[] = []
  let leader = "\\"
  src.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('"')) return
    const word = line.split(/\s+/, 1)[0]
    const rest = line.slice(word.length).trim()
    try {
      if (word === "let") {
        const m = /^mapleader\s*=\s*(["'])(.*)\1$/.exec(rest)
        if (!m) throw new Error("only `let mapleader = \"x\"`")
        leader = m[2] === " " ? "<Space>" : m[2]
      } else if (word === "exmap") {
        const m = /^(\w+)\s+(.+)$/.exec(rest)
        if (!m) throw new Error("exmap <name> <command line>")
        const cmdline = m[2]
        vim.defineEx(m[1], m[1], (c) => vim.handleEx(c, cmdline))
      } else if (MAP.test(word) || UNMAP.test(word) || CLEAR.test(word) || SET.test(word)) {
        if (!hasVim(cm)) throw new Error("Vim is off in this editor")
        vim.handleEx(cm, line.replaceAll(/<leader>/gi, leader))
      } else throw new Error(`not a vimrc command: ${word}`)
    } catch (e) {
      problems.push(`line ${i + 1}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })
  return problems
}

export async function applyVimrc(cm: CM) {
  text ??= await fetchText()
  if (applied === text) return
  const { installKeys, loadVim } = await import("./editor")
  const { Vim } = await loadVim()
  if (applied !== null) { Vim.mapclear(); installKeys(Vim) }
  applied = text
  const problems = run(cm, Vim, text)
  if (problems.length) notify(`init.vim: ${problems.length === 1 ? "a line" : `${problems.length} lines`} Vim can't run (${problems.join("; ")})`, { kind: "error" })
}

export async function reloadVimrc() {
  const next = await fetchText()
  if (next === text) return
  text = next
  const cm = [...open].find((c) => c.cm6.dom.isConnected)
  if (cm) await applyVimrc(cm)
}

export async function openVimrc() {
  try { await readFile(VIMRC) } catch {
    try { await post("file", { path: VIMRC, text: TEMPLATE }) } catch (e) { notifyError(e, `Couldn't make ${VIMRC}`); return }
  }
  openFile(VIMRC)
}
