# Passwords: the engine contract (electron/browser/passwords.ts, written by the lead session)

The user's own KeePass file ("Your passwords": the main database KeePassXC on the M4 and Strongbox on the iPhone also
open, in iCloud Drive) is set up per machine in the desktop app, like the agents' file (agentlogins.ts / logins.ts):
its path and its password, the password kept with safeStorage (the Keychain), never in the vault, never over the server.
The agents' file (agents.kdbx, a KeeShare export of the main file's Agents group) stays as it is: logins.ts fills agents
from it. After every write to the main file the engine also writes each group KeePassXC exports with KeeShare (its
"KeeShare/Reference" custom data), as KeePassXC would, so a change in Agents reaches agents at once.

All calls are window-only IPC, `webPages.engine("passwords:<name>", ...args)` from the app (never `serve`: the server
and agents never get a secret). Lock gate: the page's data needs the file "unlocked" (Touch ID on a Mac that can, or its
password typed), which lasts 10 minutes after the last call and ends when the Mac locks or sleeps. A call needing it
while locked throws an Error whose message is exactly "locked".

```ts
type Status = null | {            // null: not set up on this computer
  file: string                     // absolute path
  locked: boolean                  // the gate (above)
  touchId: boolean                 // can unlock with Touch ID now
  held?: boolean                   // no keyring: its password is held till the app quits
  error?: string                   // the file doesn't open (a sentence to show)
}
type Group = { id: string; name: string; parent: string | null; share: string | null /* file it's exported to (KeeShare) */; bin: boolean }
type Row = {
  id: string; group: string; title: string; username: string; urls: string[]; tags: string[]
  free: boolean                    // tagged agent-free: agents use it without asking
  shared: boolean                  // in a group exported to agents (a KeeShare export), so agents can use it at all
  expired: boolean; otp: boolean; modified: number /* ms */
}
type Full = Row & { password: string; notes: string; otp: string /* raw otp field, "" if none */; code: string | null /* the current one-time code */ }
type Change = { id?: string; group?: string; title: string; username: string; password: string; urls: string[]; tags: string[]; notes: string; otp?: string }

"passwords:status"            () => Status
"passwords:choose"            () => string | null        // the OS file dialog (.kdbx)
"passwords:set"               (file, password) => Status & { error?: string }   // checks it opens; also unlocks
"passwords:forget"            () => void
"passwords:unlock"            (password?: string) => { ok: true } | { error: string }   // no password: Touch ID
"passwords:lock"              () => void
"passwords:list"              () => { groups: Group[]; entries: Row[] }          // needs unlocked
"passwords:get"               (id) => Full                                        // needs unlocked
"passwords:save"              (change: Change) => { id: string }                  // needs unlocked; new when no id
"passwords:delete"            (id) => void                                        // to the recycle bin; needs unlocked
"passwords:for-page"          (pageId: number) => Row[]                           // entries for that page's site; needs unlocked
```
Windows are told `{ type: "engine:passwords:changed" }` after every write and every lock or unlock.

Agents' uses of logins (which agent used which entry, when, on which site, approved how): the server keeps them
(web-viewer plugin, shared kept state, so every machine sees the M1's agents): `GET /api/web-viewer/login-uses` →
`{ uses: { t: number; entry: { id?: string; title: string; username: string }; site: string; agent: string; task?: string; status: string; approved?: string; machine?: string }[] }`, newest first. Entry ids are the
KeePass UUIDs, the same in the main file and agents.kdbx (KeeShare keeps them).
