import { Group, Section, SettingRow, webPages } from "@vaultite"
import { PermissionsSection } from "./PermissionsSection"
import { SitesSettings } from "./Sites"
import { PasswordsSetting } from "./passwords/Setting"

export function DesktopSettings() {
  if (webPages?.sites && webPages.engine) return <><SitesSettings /><PermissionsSection /><PasswordsSetting /></>
  return (
    <Section title="In Vaultite's desktop app">
      <Group>
        <SettingRow label="Sites and logins" sub="Sign out of a site, or clear its trackers" data-setting="sites" />
        <SettingRow label="Site permissions" sub="Camera, microphone, location and notifications, by site" data-setting="permissions" />
        <SettingRow label="Passwords" sub="Your KeePass file, listed, edited and filled in pages" data-setting="passwords" />
      </Group>
    </Section>
  )
}
