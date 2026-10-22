import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { api, check } = $
  // The user's devices (plugins/core/tabs): each app and browser's tabs, named by what it is and where, renamed by the
  // user, closed from another device only while it's open.
  const from = (ua: string, extra: Record<string, string> = {}) =>
    ({ headers: { "user-agent": ua, ...extra }, socket: { remoteAddress: "127.0.0.1" } }) as Any
  const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
  const tabs = [{ to: "file:Notes/Idea.md" }, { to: "view:connections", label: "Connections" }]
  await api("PUT", "tabs/devices/brave0000001", { tabs }, from(MAC, { "sec-ch-ua": '"Brave";v="155", "Chromium";v="155", "Not(A:Brand";v="24"' }))
  await api("PUT", "tabs/devices/chromium0001", { tabs }, from(MAC, { "sec-ch-ua": '"Chromium";v="155", "Not(A:Brand";v="24"' }))
  await api("PUT", "tabs/devices/iphone000001", { tabs }, from(IPHONE, { "sec-ch-ua": '"Chromium";v="155"' }))
  const named = async () => Object.fromEntries((((await api("GET", "tabs/devices"))[1] as Any).devices as Any[]).map((d) => [d.id, d]))
  let all = await named()
  check("devices: a Chromium browser is named by its brand, not \"Chrome\"", all.brave0000001?.name === "Brave on Mac" && all.chromium0001?.name === "Chromium on Mac", all)
  check("devices: a phone's browser by its system (and its user agent, whatever hints come with it)", all.iphone000001?.name === "Safari on iPhone" && all.iphone000001.kind === "phone", all.iphone000001)
  check("devices: none is open (no window says it's that device)", Object.values(all).every((d: Any) => !d.live))
  await api("POST", "tabs/devices/brave0000001/label", { label: "Desk" })
  await api("PUT", "tabs/devices/brave0000001", { tabs: tabs.slice(0, 1) }, from(MAC, { "sec-ch-ua": '"Brave";v="155"' }))
  all = await named()
  check("devices: the user's name for one stays as it sends its tabs", all.brave0000001?.label === "Desk" && all.brave0000001.tabs.length === 1, all.brave0000001)
  await api("POST", "tabs/devices/brave0000001/label", { label: "" })
  check("devices: and an empty one gives it its own back", !(await named()).brave0000001?.label)
  const [status] = await api("POST", "tabs/devices/brave0000001/close", {})
  check("devices: tabs can't be closed on a device that isn't open", status === 409, status)
  const [, here] = await api("GET", "tabs/devices/here")
  check("devices: the server says which devices have windows open on it", Array.isArray(here?.devices), here)
  const [, listed] = await api("POST", "ops/tabs.devices", {})
  check("devices: vau tabs devices lists them with their tabs", listed?.devices?.length === 3 && listed.devices[0].tabs.length === 1, listed)
  const [shut, why] = await api("POST", "ops/tabs.device-close", { device: "safari on iphone" })
  check("devices: vau tabs device-close finds one by name, and says it isn't open", shut === 409 && /Safari on iPhone isn't open now/.test(why?.error), [shut, why])
  for (const id of ["brave0000001", "chromium0001", "iphone000001"]) await api("DELETE", `tabs/devices/${id}`)
  check("devices: forgotten, they're gone", !Object.keys(await named()).length)
}
