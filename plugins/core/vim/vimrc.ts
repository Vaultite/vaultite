// The vimrc (.vaultite/plugins/vim/init.vim; Obsidian's .obsidian.vimrc works): map/noremap and friends, unmap, set,
// let mapleader, exmap, run in every editor before you type and again when it changes; a bad line is reported once.
import { notify, openFile, post, readFile } from "@vaultite"
import type { CM, Vim } from "./editor"
import { installKeys, loadVim } from "./editor"
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
/** The editors open now: the vimrc runs again in one of them when it changes. */
const open = new Set<CM>()
/** An editor with Vim opened (true) or closed (false). */
export function editorOpen(cm: CM, on: boolean) { if (on) open.add(cm); else open.delete(cm) }

async function fetchText() {
  try { return (await readFile(VIMRC)).text } catch { return "" }
}

/** Run the vimrc's lines; the ones it couldn't run, with their line numbers. */
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
        vim.handleEx(cm as never, line.replaceAll(/<leader>/gi, leader))
      } else throw new Error(`not a vimrc command: ${word}`)
    } catch (e) {
      problems.push(`line ${i + 1}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })
  return problems
}

/** Run the vimrc in Vim, if this text hasn't run yet (mappings are shared by every editor); `cm` is an editor's. */
export async function applyVimrc(cm: CM) {
  text ??= await fetchText()
  if (applied === text) return
  const { Vim } = await loadVim()
  // A vimrc that ran before: its mappings go (and this plugin's own keys come back) before the new one runs.
  if (applied !== null) { Vim.mapclear(); installKeys(Vim) }
  applied = text
  const problems = run(cm, Vim, text)
  if (problems.length) notify(`init.vim: ${problems.length === 1 ? "a line" : `${problems.length} lines`} Vim can't run (${problems.join("; ")})`, { kind: "error" })
}

/** The vimrc changed (on disk, in an editor): read it again and run it in the editors that are open. */
export async function reloadVimrc() {
  const next = await fetchText()
  if (next === text) return
  text = next
  const cm = [...open].find((c) => c.cm6.dom.isConnected)
  if (cm) await applyVimrc(cm)
}

/** Open the vimrc, making it first (with examples) when there's none. */
export async function openVimrc() {
  try { await readFile(VIMRC) } catch {
    try { await post("file", { path: VIMRC, text: TEMPLATE }) } catch (e) { notify(`Couldn't make ${VIMRC}: ${e instanceof Error ? e.message : String(e)}`, { kind: "error" }); return }
  }
  openFile(VIMRC)
}
