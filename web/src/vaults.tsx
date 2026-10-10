// The desktop app's Manage vaults window (web/vaults.html, loaded from the built files: no vault, no server). Also works
// as a page of the web app (/vaults.html), on the server's list.
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { Tooltips } from "@/components/Tooltip"
import { ContextMenus } from "@/components/ContextMenu"
import { VaultManager, webVaults, type VaultBackend } from "@/components/VaultManager"
import { desktop } from "@/core/desktop"

// Light or dark like the system (the vaults' own settings are theirs).
const dark = matchMedia("(prefers-color-scheme: dark)")
const theme = () => document.documentElement.classList.toggle("dark", dark.matches)
theme()
dark.addEventListener("change", theme)

const app = desktop
const backend: VaultBackend = app ? {
  list: app.vaults, open: app.openVault, create: app.createVault, remove: app.removeVault,
  pick: app.pickFolder, reveal: (p) => { app.revealVault(p) }, connect: app.connectServer, playground: app.openSandbox,
} : webVaults

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="vault-manager-drag fixed inset-x-0 top-0 h-10" />
    <VaultManager backend={backend} wide />
    <Tooltips />
    <ContextMenus />
  </StrictMode>,
)
