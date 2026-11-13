import { defineRule, eslintCompatPlugin } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

const SLEEPS = new Set(["wait", "sleep", "waitForTimeout", "delay"])
const DIRECTIVE = /^\s*(oxlint|eslint)-(disable|enable)(-next-line|-line)?\b/

const isConst = (t: ESTree.TSType) => t.type === "TSTypeReference" && t.typeName.type === "Identifier" && t.typeName.name === "const"

function calleeName(callee: ESTree.Expression) {
  if (callee.type === "Identifier") return callee.name
  if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") return callee.property.name
  return ""
}

const noCast = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow `as` casts: they turn the compiler off where a check belongs." },
    messages: {
      cast: "An `as` cast stops the compiler checking. Parse outside data at its boundary with a zod schema, narrow with `in`, a discriminant or an `isX` guard, or check a literal with `satisfies`.",
    },
  },
  createOnce(context) {
    return {
      TSAsExpression(node) {
        if (!isConst(node.typeAnnotation)) context.report({ node, messageId: "cast" })
      },
      TSTypeAssertion(node) {
        if (!isConst(node.typeAnnotation)) context.report({ node, messageId: "cast" })
      },
    }
  },
})

const noSleep = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow fixed sleeps in QA scripts." },
    messages: {
      sleep: "A sleep guesses how long the app takes and fails when it's slower. Wait for the state itself: a locator's auto-wait, `page.waitForFunction`, or what web/qa/lib asks the app.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return
        const first = node.arguments[0]
        const timed = node.callee.type === "Identifier" || calleeName(node.callee) === "waitForTimeout" || (first?.type === "Literal" && /^[\d.]/.test(first.raw ?? ""))
        if (SLEEPS.has(calleeName(node.callee)) && timed) context.report({ node, messageId: "sleep" })
      },
    }
  },
})

const noNodeModuleMock = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow node:test's module mocks." },
    messages: { mock: "A module mock tests a copy of the wiring. Pass the dependency in (a parameter, a fake that does the real thing) and test through it." },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const c = node.callee
        if (c.type === "MemberExpression" && !c.computed && c.property.type === "Identifier" && c.property.name === "module"
          && c.object.type === "Identifier" && c.object.name === "mock") context.report({ node, messageId: "mock" })
      },
    }
  },
})

function isJsonCall(n: ESTree.Node | null): boolean {
  if (!n) return false
  if (n.type === "AwaitExpression" || n.type === "ParenthesizedExpression") return isJsonCall(n.type === "AwaitExpression" ? n.argument : n.expression)
  if (n.type !== "CallExpression" || n.callee.type !== "MemberExpression" || n.callee.computed || n.callee.property.type !== "Identifier") return false
  const { object, property } = n.callee
  return property.name === "json" || (property.name === "parse" && object.type === "Identifier" && object.name === "JSON")
}

function thenOf(n: ESTree.Node): ESTree.CallExpression | null {
  if (n.type !== "CallExpression" || n.callee.type !== "MemberExpression" || n.callee.computed) return null
  return n.callee.property.type === "Identifier" && n.callee.property.name === "then" ? n : null
}

/** `.then((j: T) => …)`: its callback's first parameter typed. */
function typesItsValue(then: ESTree.CallExpression) {
  const cb = then.arguments[0]
  if (!cb || (cb.type !== "ArrowFunctionExpression" && cb.type !== "FunctionExpression")) return false
  const p = cb.params[0]
  return p?.type === "Identifier" && !!p.typeAnnotation
}

/** `.then((r) => r.json())` */
function givesJson(then: ESTree.CallExpression | null) {
  const cb = then?.arguments[0]
  return cb?.type === "ArrowFunctionExpression" && cb.expression && isJsonCall(cb.body)
}

/** `p.then((j: T) => …)` where `p` gives parsed JSON: `x.json()`, or `.then((r) => r.json())`. */
function isTypedJsonThen(n: ESTree.CallExpression) {
  const then = thenOf(n)
  if (!then || !typesItsValue(then) || then.callee.type !== "MemberExpression") return false
  const before = then.callee.object
  return isJsonCall(before) || givesJson(thenOf(before))
}

const noUncheckedJson = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow typing parsed JSON by hand instead of parsing it." },
    messages: {
      json: "This trusts outside JSON's shape without checking it, so a change on the other side fails here at run time. Parse it with a zod schema (`Reply.parse(await r.json())`), the one its sender's type comes from.",
    },
  },
  createOnce(context) {
    return {
      TSAsExpression(node) {
        if (!isConst(node.typeAnnotation) && isJsonCall(node.expression)) context.report({ node, messageId: "json" })
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && node.id.typeAnnotation && isJsonCall(node.init)) context.report({ node, messageId: "json" })
      },
      CallExpression(node) {
        if (isTypedJsonThen(node)) context.report({ node, messageId: "json" })
      },
    }
  },
})

const disableReason = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Require a reason on every lint disable comment." },
    messages: { reason: "Say why the rule is wrong here after ` -- `: `// oxlint-disable-next-line <rule> -- <why>`. Better, change the code so the rule holds." },
  },
  createOnce(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (DIRECTIVE.test(comment.value) && !/\s--\s*\S/.test(comment.value)) context.report({ loc: comment.loc, messageId: "reason" })
        }
      },
    }
  },
})

const isDirective = (value: string) => DIRECTIVE.test(value) || /^\s*@ts-|^\s*prettier-|^\/ </.test(value)

const commentLines = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Count comment lines, so a change can't add more than it removes." },
    messages: {
      line: "A comment the code could say instead goes stale. Rename, extract or type it so the code says it, and keep only what it can't: a constraint from outside we can't change. Adding one? Delete a narrating one in the files you touch.",
    },
  },
  createOnce(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (isDirective(comment.value)) continue
          for (let line = comment.loc.start.line; line <= comment.loc.end.line; line++) {
            context.report({ loc: { start: { line, column: 0 }, end: { line, column: 1 } }, messageId: "line" })
          }
        }
      },
    }
  },
})

function longComments(comments: ESTree.Comment[], lines: string[]) {
  const out: ESTree.Comment[] = []
  let run: ESTree.Comment[] = []
  const flush = () => {
    const lines = run.length ? run[run.length - 1].loc.end.line - run[0].loc.start.line + 1 : 0
    if (lines > 2) out.push(run[0])
    run = []
  }
  for (const c of comments) {
    const trailing = lines[c.loc.start.line - 1]?.slice(0, c.loc.start.column).trim() !== ""
    if (isDirective(c.value) || trailing) { flush(); continue }
    const last = run[run.length - 1]
    if (last && (c.type === "Block" || last.type === "Block" || c.loc.start.line !== last.loc.end.line + 1)) flush()
    run.push(c)
  }
  flush()
  return out
}

const commentLength = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Disallow comments over two lines." },
    messages: { long: "A comment of more than 2 lines is a paragraph: say it in at most 2, or move it into the code (a name, a type, a test)." },
  },
  createOnce(context) {
    return {
      Program() {
        for (const c of longComments(context.sourceCode.getAllComments(), context.sourceCode.lines)) context.report({ loc: c.loc, messageId: "long" })
      },
    }
  },
})

const OWN_TITLE = new Set(["svg", "title", "iframe", "abbr", "webview"])

const noTitleAttr = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow the browser's title= tooltip on an element." },
    messages: { title: "`title=` is the browser's tooltip: slow, unstyled, unlike the app's. Use data-tip (data-tip-trunc for cut-off text), components/Tooltip.tsx." },
  },
  createOnce(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || !/^[a-z]/.test(node.name.name) || OWN_TITLE.has(node.name.name)) return
        for (const a of node.attributes) {
          if (a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && a.name.name === "title") context.report({ node: a, messageId: "title" })
        }
      },
    }
  },
})

const SPAWNS = new Set(["execFileSync", "execFile", "spawnSync", "spawn", "exec"])

const gitEnv = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Require gitEnv() on every git the code runs." },
    messages: { env: "git without gitEnv() (core/gitenv.ts): a GIT_DIR it inherits from a hook or `git bisect run` points it at the wrong repository. Pass `env: gitEnv()`." },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || !SPAWNS.has(node.callee.name)) return
        const first = node.arguments[0]
        if (first?.type !== "Literal" || first.value !== "git") return
        if (!context.sourceCode.getText(node).includes("gitEnv(")) context.report({ node, messageId: "env" })
      },
    }
  },
})

export default eslintCompatPlugin({
  meta: { name: "vaultite" },
  rules: { "no-cast": noCast, "no-sleep": noSleep, "no-node-module-mock": noNodeModuleMock, "no-unchecked-json": noUncheckedJson, "disable-reason": disableReason,
    "comment-lines": commentLines, "comment-length": commentLength, "no-title-attr": noTitleAttr, "git-env": gitEnv },
})
