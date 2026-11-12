import { type ESTree, parseSync, Visitor } from "rolldown/utils"

export const METRICS = [
  ["cast", "`as` casts (not `as const`)"],
  ["unknownCast", "`as unknown as`"],
  ["any", "`any`"],
  ["console", "`console.*` calls"],
  ["try", "`try` blocks"],
  ["comment", "comment lines"],
  ["looseRecord", "`Record<string, unknown>`"],
  ["uncheckedParse", "JSON parsed with a cast"],
  ["moduleMock", "module mocks"],
  ["sleep", "sleeps (wait, sleep, waitForTimeout)"],
  ["disable", "lint and type-check disables"],
] as const

export type Metric = (typeof METRICS)[number][0]
export type Counts = Record<Metric | "lines", number>
const KEYS = ["lines", ...METRICS.map(([k]) => k)] as const

const SLEEPS = new Set(["wait", "sleep", "waitForTimeout", "delay"])
const MOCKS = new Set(["vi.mock", "vi.doMock", "jest.mock", "jest.doMock", "mock.module"])
const DISABLE = /\b(oxlint-disable|eslint-disable)|@ts-(ignore|expect-error|nocheck)/g

export const empty = (): Counts => ({
  lines: 0, cast: 0, unknownCast: 0, any: 0, console: 0, try: 0, comment: 0,
  looseRecord: 0, uncheckedParse: 0, moduleMock: 0, sleep: 0, disable: 0,
})

export function add(into: Counts, from: Counts) {
  for (const k of KEYS) into[k] += from[k]
}

export const isCode = (file: string) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(file) && !file.endsWith(".d.ts")

const unparen = (n: ESTree.Expression): ESTree.Expression => (n.type === "ParenthesizedExpression" ? unparen(n.expression) : n)

function dotted(n: ESTree.Node | ESTree.TSTypeName): string {
  if (n.type === "Identifier") return n.name
  if (n.type === "MemberExpression" && !n.computed) return `${dotted(n.object)}.${dotted(n.property)}`
  if (n.type === "TSQualifiedName") return `${dotted(n.left)}.${dotted(n.right)}`
  return ""
}

function isJsonParse(e: ESTree.Expression) {
  const inner = unparen(e)
  const call = inner.type === "AwaitExpression" ? unparen(inner.argument) : inner
  if (call.type !== "CallExpression") return false
  const callee = dotted(call.callee)
  return callee === "JSON.parse" || callee.endsWith(".json")
}

function cast(c: Counts, n: ESTree.TSAsExpression | ESTree.TSTypeAssertion) {
  const t = n.typeAnnotation
  if (t.type === "TSTypeReference" && dotted(t.typeName) === "const") return
  c.cast++
  if (unparen(n.expression).type === "TSAsExpression") c.unknownCast++
  if (isJsonParse(n.expression)) c.uncheckedParse++
}

function call(c: Counts, n: ESTree.CallExpression) {
  const callee = dotted(n.callee)
  if (callee.startsWith("console.")) c.console++
  if (MOCKS.has(callee)) c.moduleMock++
  if (SLEEPS.has(callee.split(".").pop() ?? "")) c.sleep++
}

function looseRecord(c: Counts, n: ESTree.TSTypeReference) {
  const [key, value] = n.typeArguments?.params ?? []
  if (dotted(n.typeName) === "Record" && key?.type === "TSStringKeyword" && (value?.type === "TSUnknownKeyword" || value?.type === "TSAnyKeyword")) c.looseRecord++
}

function commentLines(text: string, comments: ReturnType<typeof parseSync>["comments"]) {
  const lines = new Set<number>()
  let line = 0
  let at = 0
  for (const { start, end } of comments) {
    for (; at < start; at++) if (text.charCodeAt(at) === 10) line++
    lines.add(line)
    for (; at < end; at++) if (text.charCodeAt(at) === 10) lines.add(++line)
  }
  return lines.size
}

/** Counts one file's patterns. A file that doesn't parse counts only its lines. */
export function measure(file: string, text: string): Counts {
  const c = empty()
  c.lines = text.split("\n").length
  const parsed = parseSync(file, text)
  if (parsed.errors.some((e) => e.severity === "Error")) return c
  new Visitor({
    TSAsExpression: (n) => cast(c, n),
    TSTypeAssertion: (n) => cast(c, n),
    TSAnyKeyword: () => { c.any++ },
    TryStatement: () => { c.try++ },
    CallExpression: (n) => call(c, n),
    TSTypeReference: (n) => looseRecord(c, n),
  }).visit(parsed.program)
  c.comment = commentLines(text, parsed.comments)
  c.disable = parsed.comments.reduce((n, k) => n + (k.value.match(DISABLE)?.length ?? 0), 0)
  return c
}
