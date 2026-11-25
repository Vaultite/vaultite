import { openMenu, type MenuItem } from "@/components/ContextMenu"
import { getStore, optimistic, vaultFolder } from "@/core/data"
import { relistVaults } from "@/core/desktopapp"
import { api } from "@/core/http"
import { onVaultChange } from "@/core/live"
import { isDesktop } from "@/core/platform"
import { share } from "@/core/share"
import { webVaults, type VaultBackend } from "@/core/webvaults"
import { NICKNAME_FILE, NICKNAME_HINT, NICKNAME_MAX, nicknameTyped } from "../../../core/vaultname.ts"

export const canSetNickname = () => { const s = getStore(); return !!s && !share && !s.vault.sandbox }

const save = (typed: string) => {
  const s = getStore()
  if (!s) return
  const name = nicknameTyped(typed, s.vault.path)
  void optimistic((now) => ({ ...now, vault: { ...now.vault, name: name ?? vaultFolder(now), nickname: name ?? undefined } }),
    () => api("PATCH", "config/vault", { name }), "Couldn't set the nickname").then(relistVaults, () => {})
}

const items = (): MenuItem[] => {
  const s = getStore()
  return s ? [{ label: "Nickname", run: () => {}, field: { value: s.vault.nickname ?? "", placeholder: vaultFolder(s), max: NICKNAME_MAX, hint: NICKNAME_HINT, save } }] : []
}

export function setNickname() {
  if (!canSetNickname()) return
  requestAnimationFrame(() => {
    const el = isDesktop() ? [...document.querySelectorAll<HTMLElement>("[data-vault-button]")].find((b) => b.checkVisibility({ visibilityProperty: true, opacityProperty: true })) : undefined
    const r = el?.getBoundingClientRect()
    openMenu(r ? { x: r.left, y: r.bottom + 4, flip: r.top - 4 } : { x: Math.max(8, innerWidth / 2 - 170), y: innerHeight * 0.16 }, items())
  })
}

export const nicknameItems = (): MenuItem[] => (canSetNickname() ? [{ label: "Set nickname…", run: setNickname }] : [])

export const appVaults: VaultBackend = {
  ...webVaults,
  nickname: (path, typed) => api("PATCH", "vaults", { path, nickname: typed }).then(relistVaults),
  watch: (fn) => onVaultChange((paths) => { if (!paths || paths.includes(NICKNAME_FILE)) fn() }),
}
