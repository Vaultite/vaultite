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
        if (SLEEPS.has(calleeName(node.callee))) context.report({ node, messageId: "sleep" })
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

export default eslintCompatPlugin({
  meta: { name: "vaultite" },
  rules: { "no-cast": noCast, "no-sleep": noSleep, "no-node-module-mock": noNodeModuleMock, "no-unchecked-json": noUncheckedJson, "disable-reason": disableReason },
})
