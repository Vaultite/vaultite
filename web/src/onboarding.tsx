import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { Onboarding } from "@/components/Onboarding"
import { Tooltips } from "@/components/Tooltip"
import { followSystemTheme } from "@/lib/utils"

followSystemTheme()

const setup = window.vaultite?.onboarding

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {setup ? <Onboarding setup={setup} /> : <p className="p-8 text-[13px] text-muted-foreground">This window is the desktop app's.</p>}
    <Tooltips />
  </StrictMode>,
)
