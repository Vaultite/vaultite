// The desktop app's Set up Vaultite window (web/onboarding.html, loaded from the built files: no vault, no server).
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { Onboarding, type SetupApi } from "@/components/Onboarding"

// Light or dark like the system (a vault's own settings are its).
const dark = matchMedia("(prefers-color-scheme: dark)")
const theme = () => document.documentElement.classList.toggle("dark", dark.matches)
theme()
dark.addEventListener("change", theme)

const setup = (window as { vaultite?: { onboarding?: SetupApi } }).vaultite?.onboarding

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {setup ? <Onboarding setup={setup} /> : <p className="p-8 text-[13px] text-muted-foreground">This window is the desktop app's.</p>}
  </StrictMode>,
)
