import { z } from "zod"
import type { AXNode } from "./axlines.ts"

const AX_VALUE = z.object({ value: z.unknown().optional() })
const AX_NODE: z.ZodType<AXNode> = z.object({
  nodeId: z.string(), ignored: z.boolean().optional(), role: AX_VALUE.optional(), name: AX_VALUE.optional(), value: AX_VALUE.optional(),
  childIds: z.array(z.string()).optional(), backendDOMNodeId: z.number().optional(), properties: z.array(z.object({ name: z.string(), value: AX_VALUE })).optional(),
})
export const AX_TREE = z.object({ nodes: z.array(AX_NODE) })

export type DomNode = { backendNodeId: number; nodeName: string; nodeValue?: string; attributes?: string[]; documentURL?: string; children?: DomNode[]
  contentDocument?: DomNode; shadowRoots?: DomNode[]; templateContent?: DomNode }
const DOM_NODE: z.ZodType<DomNode> = z.object({
  backendNodeId: z.number(), nodeName: z.string(), nodeValue: z.string().optional(), attributes: z.array(z.string()).optional(), documentURL: z.string().optional(),
  get children() { return z.array(DOM_NODE).optional() }, get contentDocument() { return DOM_NODE.optional() },
  get shadowRoots() { return z.array(DOM_NODE).optional() }, get templateContent() { return DOM_NODE.optional() },
})
export const DOCUMENT = z.object({ root: DOM_NODE })
export const DESCRIBED = z.object({ node: DOM_NODE })
export const BOX = z.object({ model: z.object({ content: z.array(z.number()), border: z.array(z.number()), width: z.number(), height: z.number() }) })
export const RESOLVED = z.object({ object: z.object({ objectId: z.string() }) })
export const LAYOUT = z.object({ cssVisualViewport: z.object({ clientWidth: z.number(), clientHeight: z.number() }).optional() })
export const SCREENCAST_FRAME = z.object({ data: z.string(), sessionId: z.number(),
  metadata: z.object({ deviceWidth: z.number(), deviceHeight: z.number() }).optional() })
export const FRAME_TREE = z.object({ frameTree: z.object({ frame: z.object({ id: z.string() }) }) })
export const WORLD = z.object({ executionContextId: z.number() })
export const EVALUATED = z.object({ result: z.object({ type: z.string(), subtype: z.string().optional(), value: z.unknown().optional(), objectId: z.string().optional() }),
  exceptionDetails: z.object({ text: z.string(), exception: z.object({ description: z.string().optional() }).optional() }).optional() })
