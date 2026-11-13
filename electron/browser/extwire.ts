import { z } from "zod"

const TEXTS = z.array(z.string().catch("")).transform((a) => a.filter(Boolean)).optional().catch(undefined)
const WORDS = z.string().optional().catch(undefined)
const BUTTON = z.object({ default_title: z.unknown().optional(), default_icon: z.unknown().optional(), default_popup: WORDS }).optional().catch(undefined)
export const MANIFEST = z.object({
  name: WORDS, version: WORDS, manifest_version: z.number().optional().catch(undefined), description: WORDS, default_locale: WORDS, icons: z.unknown().optional(),
  permissions: TEXTS, optional_permissions: TEXTS, host_permissions: TEXTS, optional_host_permissions: TEXTS, action: BUTTON, browser_action: BUTTON,
  options_ui: z.object({ page: WORDS }).optional().catch(undefined), options_page: WORDS,
  commands: z.record(z.string(), z.object({ description: z.unknown().optional() }).catch({})).optional().catch(undefined),
  key: WORDS, theme: z.unknown().optional(),
})
export type Manifest = z.infer<typeof MANIFEST>

export const RAW_MANIFEST = z.record(z.string(), z.unknown())
export type RawManifest = z.infer<typeof RAW_MANIFEST>
const CONTENT_SCRIPT = z.looseObject({ js: z.array(z.unknown()).min(1), world: z.unknown().optional() })
export function prepared(raw: RawManifest, shim: string, key?: string): RawManifest {
  const out = { ...raw }
  if (key && !raw.key) out.key = key
  if (Array.isArray(raw.content_scripts)) out.content_scripts = raw.content_scripts.map((cs) => {
    const c = CONTENT_SCRIPT.safeParse(cs)
    return c.success && c.data.world !== "MAIN" && c.data.js[0] !== shim ? { ...c.data, js: [shim, ...c.data.js] } : cs
  })
  return out
}

export const MESSAGES = z.record(z.string(), z.object({ message: WORDS }).catch({})).catch({})
export const NATIVE_HOST = z.object({ path: z.string(), allowed_origins: z.array(z.unknown()) })
export const PROFILE_NAMES = z.object({ profile: z.object({ info_cache: z.record(z.string(), z.object({ name: WORDS }).catch({})) }) })
  .transform((s) => s.profile.info_cache).catch({})

export const ID = /^[a-p]{32}$/
const INSTALLED = z.looseObject({
  id: z.string().regex(ID), dir: z.string(), name: z.string().catch(""), version: z.string().catch(""), on: z.boolean().catch(false), pinned: z.boolean().catch(false),
  from: z.enum(["store", "folder"]).catch("folder"), added: z.number().catch(0), granted: z.array(z.string()).optional().catch(undefined),
  managed: z.object({ source: z.string(), sig: z.string().optional() }).optional().catch(undefined),
})
export const STATE = z.object({
  list: z.array(z.unknown()).catch([]).transform((a) => a.flatMap((x) => { const i = INSTALLED.safeParse(x); return i.success ? [i.data] : [] })),
  checked: z.number().catch(0), seen: z.record(z.string(), z.record(z.string(), z.string()).catch({})).catch({}), partitions: z.record(z.string(), z.string()).catch({}),
}).catch({ list: [], checked: 0, seen: {}, partitions: {} })

const TAB = z.number().optional().catch(undefined)
const ANY = z.unknown().optional()
export const BUTTON_ASK = z.object({ tabId: TAB, title: ANY, text: ANY, color: ANY, popup: ANY, path: ANY,
  imageData: z.record(z.string(), z.instanceof(Uint8Array).catch(new Uint8Array())).optional().catch(undefined) }).catch({})
export type ButtonAsk = z.infer<typeof BUTTON_ASK>
export const TABS_QUERY = z.object({ active: ANY, highlighted: ANY, currentWindow: ANY, lastFocusedWindow: ANY, windowId: TAB, status: WORDS, title: WORDS, index: TAB,
  audible: z.boolean().optional().catch(undefined), pinned: ANY, discarded: ANY, url: ANY }).default({})
export const TAB_CREATE = z.object({ windowId: TAB, url: ANY, active: ANY }).default({})
export const TAB_UPDATE = z.object({ url: ANY, muted: z.boolean().optional().catch(undefined), active: ANY, highlighted: ANY }).catch({})
export const TAB_HIGHLIGHT = z.object({ tabs: ANY }).default({})
export const POPULATE = z.object({ populate: ANY }).optional().catch(undefined)
export const WINDOW_CREATE = z.object({ url: ANY }).default({})
export const WINDOW_UPDATE = z.object({ focused: ANY }).default({})
export const PERMISSIONS = z.object({ permissions: z.array(z.string()).optional(), origins: z.array(z.string()).optional() }).default({})
export type Permissions = z.infer<typeof PERMISSIONS>
export const FRAME_ASK = z.object({ tabId: ANY, frameId: ANY }).default({})
export const NAMED_COOKIE = z.object({ url: ANY, name: ANY }).default({})
const TEXT = z.string().optional(), FLAG = z.boolean().optional()
export const COOKIE_FILTER = z.object({ url: TEXT, name: TEXT, domain: TEXT, path: TEXT, secure: FLAG, session: FLAG, httpOnly: FLAG }).default({})
export const COOKIE_SET = z.object({ url: z.string(), name: TEXT, value: TEXT, domain: TEXT, path: TEXT, secure: FLAG, httpOnly: FLAG, expirationDate: z.number().optional(),
  sameSite: z.enum(["unspecified", "no_restriction", "lax", "strict"]).optional() })
export const PAGE_ASK = z.object({ url: ANY }).default({})
export const LISTENER_FILTER = z.object({ urls: ANY, types: ANY, tabId: ANY, windowId: ANY }).default({})
const HEADERS = z.array(z.object({ name: z.string(), value: z.string().optional().catch(undefined) })).optional().catch(undefined)
export const REPLY = z.object({ cancel: FLAG.catch(undefined), redirectUrl: WORDS, requestHeaders: HEADERS, responseHeaders: HEADERS,
  authCredentials: z.object({ username: z.string(), password: z.string() }).optional().catch(undefined) }).nullable().catch(null)
export type Reply = z.infer<typeof REPLY>
export const NOTE = z.object({ title: ANY, message: ANY, silent: ANY }).catch({})
