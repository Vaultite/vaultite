import { useEffect, useState } from "react"
import { afterSheets, isViewOpen, openView, Section, SettingRow } from "@vaultite"
import { call, fileName, hasPasswords } from "./store"
import type { Status } from "./types"

const showPasswords = () => afterSheets(() => openView("passwords", { newTab: !isViewOpen("view:passwords") }))

export function PasswordsSetting() {
  const [status, setStatus] = useState<Status | undefined>(undefined)
  useEffect(() => { if (hasPasswords()) void call("status").then(setStatus, () => setStatus(null)) }, [])
  return (
    <div data-setting="passwords" className="mt-6">
      <Section title="Passwords">
        <SettingRow label="Your passwords" value={status === undefined ? "" : status ? fileName(status.file) : "Not set up"} onClick={showPasswords} />
      </Section>
    </div>
  )
}
