export const RESEARCH = "research"
export const PAPER = "Papers/Paper machines/Draft.md"

export function spaceOf(asked: string | null): string {
  const b = (asked ?? "").toLowerCase()
  if ((/^gh:vaultite\/vaultite\/bundles\/([\w-]+)$/.exec(b)?.[1] ?? b) === RESEARCH) return RESEARCH
  return b.startsWith("gh:") ? b : ""
}
