import { check } from "../lib.ts"

// ---------- A vault's icon is the stone, never lucide's Vault (a safe; CLAUDE.md, UI) ----------
const { execFileSync } = await import("node:child_process"), { gitEnv } = await import("../../../core/gitenv.ts")
const hits = (re: string) => { try { return execFileSync("git", ["grep", "-n", "-E", re, "--", "web", "plugins", "electron", ":!*.md"], { encoding: "utf8", env: gitEnv() }).trim() } catch { return "" } }
const used = [hits(String.raw`import \{[^}]*\bVault\b[^}]*\} from "lucide-react"`), hits(String.raw`<Vault[ /]`), hits(String.raw`icon\("vault"\)`)].filter(Boolean).join("\n")
check("icons: lucide's Vault is used nowhere (a vault is the stone)", !used, used)
