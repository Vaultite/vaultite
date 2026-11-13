import { webPages } from "@vaultite"
import type { AgentPage } from "./agentpages"
import type { Ext } from "./extstate"
import type { Found, ImportedBookmark, ImportSource, Removed, Suggestion, Visit } from "./history"
import type { Full, Group, Row, Status } from "./passwordstore"
import type { Run, Step } from "./steps"

export type ExtButton = { id: string; name: string; pinned: boolean; title: string; icon: string; badge: string; badgeColor: string; badgeTextColor: string; popup: boolean; enabled: boolean }
export type OtherExt = { browser: string; id: string; name: string; version: string; icon: string }
export type PageShields = { site: string; count: number }
export type FillLogin = { id: string; title: string; username: string; otp: boolean }
/** `held`: Linux without a keyring keeps the password only till the app quits. */
export type AgentLogins = { file: string; entries?: number; free?: number; error?: string; held?: boolean; locked?: boolean } | null
export type Passkey = { id: string; name: string; site: string; added: number }
export type LiveRun = { tab: number; appTab: string; by: string; task: string; summary: string; url: string; title: string; run: string | null; at: number | null
  step: Partial<Step> | null; paused: boolean; asking: string | null; shot: string | null }

type Unlocked = { ok?: boolean; error?: string }

/** What the desktop app's browser engine (electron/browser/) answers, by the call's name. */
type Answers = {
  "adblock:page": PageShields | null
  "adblock:pick": { selector: string } | null
  "agents:live": LiveRun[]
  "agents:pages": AgentPage[]
  "agents:run": Step[]
  "agents:runs": Run[]
  "agents:shots": Record<string, string | null>
  "agents:watch": { frame?: string }
  "ext:bar": ExtButton[]
  "ext:import": { name: string; settings: boolean }
  "ext:install": { id: string; name: string }
  "ext:list": Ext[]
  "ext:others": OtherExt[]
  "ext:policy": { problems: string[] }
  "ext:update": number
  "history:clear": number
  "history:list": { visits: Visit[]; more: boolean }
  "history:remove": Removed[]
  "history:remove-site": Removed[]
  "history:restore": number
  "history:search": Found
  "history:top": Suggestion[]
  "import:bookmarks": ImportedBookmark[]
  "import:history": { found: number; added: number }
  "import:sources": ImportSource[]
  "logins:choose": string | null
  "logins:passkey-start": { token: string }
  "logins:passkeys": Passkey[]
  "logins:set": { error?: string; entries?: number; free?: number; held?: boolean }
  "logins:status": AgentLogins
  "passwords:choose": string | null
  "passwords:fill": { locked?: boolean } | null
  "passwords:fill-list": FillLogin[] | null
  "passwords:get": Full
  "passwords:give": string
  "passwords:list": { groups: Group[]; entries: Row[] }
  "passwords:save": { id: string }
  "passwords:set": Status & { error?: string }
  "passwords:status": Status
  "passwords:unlock": Unlocked
}
export type Answer<K extends string> = K extends keyof Answers ? Answers[K] : unknown

const answered = <K extends string>(p: Promise<unknown>) => p as Promise<Answer<K>>

/** Ask the engine; undefined without one (the web, phones). */
export const engine = <K extends string>(name: K, ...args: unknown[]) =>
  (webPages?.engine ? answered<K>(webPages.engine(name, ...args)) : Promise.resolve(undefined))

/** Ask the engine, failing with `why` without one. */
export const needEngine = (why: string) => <K extends string>(name: K, ...args: unknown[]) =>
  (webPages?.engine ? answered<K>(webPages.engine(name, ...args)) : Promise.reject(new Error(why)))
