// A page waiting on a passkey from a phone (electron/browser/passkeys.ts): drawn in the page's place, as its errors are,
// with the QR code the phone's camera scans, then how it's going, and Cancel.
import { useMemo } from "react"
import { KeyRound } from "lucide-react"
import { encode } from "uqr"
import { isMac, webPages } from "@vaultite"
import type { PasskeyAsk } from "./state"

const SAY: Record<string, string> = {
  scan: "Scan this with your phone's camera. Bluetooth needs to be on, on both.",
  connecting: "Connecting to your phone…",
  phone: "Continue on your phone.",
  "bluetooth-off": `Turn on Bluetooth on this ${isMac ? "Mac" : "computer"} to use your phone's passkey.`,
  "bluetooth-denied": "Vaultite needs Bluetooth to find your phone: allow it in System Settings, Privacy & Security, Bluetooth.",
  unavailable: "Passkeys from a phone need Xcode's Command Line Tools on this Mac (xcode-select --install).",
}

export function Passkey({ ask }: { ask: PasskeyAsk }) {
  const cancel = () => void Promise.resolve(webPages?.engine?.("passkey:cancel", ask.ask)).catch(() => {})
  return (
    <div className="absolute inset-0 flex flex-col items-center overflow-auto bg-background px-8 pt-16 pb-8 text-center" data-web-passkey={ask.state}>
      <KeyRound className="size-8 text-tertiary" strokeWidth={1.5} />
      <p className="mt-4 text-[15px] text-foreground">{ask.create ? `Save a passkey for ${ask.site} on your phone` : `Sign in to ${ask.site} with your phone`}</p>
      <p className="mt-1 max-w-[340px] text-[13px] text-muted-foreground">{SAY[ask.state] ?? ""}</p>
      {ask.state === "scan" && ask.qr && <Qr text={ask.qr} />}
      <button type="button" onClick={cancel} data-web-passkey-cancel
        className="mt-5 cursor-pointer rounded-[6px] border-[0.5px] border-border px-3 py-1.5 text-[13px] hover:bg-foreground/[0.06]">Cancel</button>
    </div>
  )
}

/** Dark on light whatever the theme: phones' cameras read it so. */
function Qr({ text }: { text: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(text, { ecc: "L", border: 2 })
    let d = ""
    qr.data.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x} ${y}h1v1h-1z` }))
    return { path: d, size: qr.size }
  }, [text])
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mt-5 aspect-square w-[220px] max-w-full shrink-0 rounded-[8px] bg-white" shapeRendering="crispEdges" role="img" aria-label="QR code for your phone" data-web-passkey-qr={text}>
      <path d={path} fill="black" />
    </svg>
  )
}
