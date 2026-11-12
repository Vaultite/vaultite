# Upstream

- Source: https://github.com/dmmulroy/anti-slop, `skills/install-anti-slop/assets/anti-slop` (MIT, `LICENSE` here)
- Commit: `13909c9e07590f5a85d93c62712259fe14a883f7` (folder tree `54b50f11bed7f52ca1948f8802f4df591644762f`)
- Vendored as OpenCode did (`script/oxlint/anti-slop` there): the rules are ours to change now.

## Deviations
- In `tools/oxlint/anti-slop/`, beside the repo's own rules (`tools/oxlint/vaultite.ts`).
- The Effect rules are left out: Vaultite doesn't use Effect.
- `.oxlintrc.json` reports the rules as warnings; `tools/ratchet.ts` fails a change that adds more of any.
