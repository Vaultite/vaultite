// A choice Claude Code shows at the bottom of its screen, read as a question: its dialogs that no transcript line holds
// (a one-time notice, a read outside the working directories, a usage limit), so the Inbox can show and answer them.
import type { Question } from "../../../core/agents.ts"

const OPTION = /^\s*([❯›>])?\s*(\d{1,2})\.\s+(\S.*)$/
const RULE = /^[\s─━═╌┄-]*$/
/** The user's prompt, empty or typed in: below it nothing is asked. */
const PROMPT = /^\s*❯(\s*$|\s+(?!\d{1,2}\.\s))/
/** Lines a dialog may have under its options: hints ("Esc to cancel · Tab to amend"), blanks, rules. */
const FOOTER = 6

/** The dialog at the bottom of `screen`: its question (the nearest line above its options, one asking if there is) and
 *  its options numbered from 1, one of them chosen (❯); null when its bottom isn't one. */
export function dialogOn(screen: string): Question | null {
  const lines = screen.replace(/\s+$/, "").split("\n").map((l) => l.replace(/^\s*│|│\s*$/g, "").trimEnd())
  let last = -1
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 1 - FOOTER; i--) {
    if (PROMPT.test(lines[i])) return null
    if (OPTION.test(lines[i])) { last = i; break }
  }
  if (last < 0) return null
  // Up from the last option: each option, its wrapped lines (deeper than its number) joined to its label.
  const options: { n: number; label: string; chosen: boolean }[] = []
  let more: string[] = [], i = last
  for (; i >= 0; i--) {
    const m = OPTION.exec(lines[i])
    if (m) {
      const n = Number(m[2])
      if (options.length && n !== options[0].n - 1) return null
      options.unshift({ n, label: [m[3], ...more].join(" ").replace(/\s+/g, " ").trim(), chosen: !!m[1] })
      more = []
      if (n === 1) break
    } else if (lines[i].trim() && !RULE.test(lines[i]) && more.length < 4) more.unshift(lines[i].trim())
    else return null
  }
  if (options.length < 2 || options[0].n !== 1 || options.filter((o) => o.chosen).length !== 1) return null
  // Its question: the nearest line above asking one, else the nearest line of text.
  const above = lines.slice(Math.max(0, i - 8), i).map((l) => l.trim()).filter((l) => l && !RULE.test(l)).reverse()
  const question = above.find((l) => l.endsWith("?")) ?? above[0]
  if (!question) return null
  return { question: question.slice(0, 300), options: options.map((o) => ({ label: o.label.slice(0, 200) })) }
}
