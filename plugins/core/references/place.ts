export type RefsPlace = "div" | "heading" | "end"

export const REFS_DIV = /^:::\s*\{#refs[^}]*\}\s*\n(?:[^\n]*\n)*?:::\s*$/m
const NAMES = "references|bibliography|works cited|literature cited|cited works|literature|sources|literaturverzeichnis|bibliographie|références|referencias|bibliografia"
const LAST_HEADING = new RegExp(`(?:^|\\n)#{1,6}[ \\t]+(?:${NAMES})[ \\t]*#*\\s*$`, "i")

export function refsPlace(text: string): RefsPlace {
  if (REFS_DIV.test(text)) return "div"
  return LAST_HEADING.test(text) ? "heading" : "end"
}
