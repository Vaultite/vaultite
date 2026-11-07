## Device sync
Each machine keeps the vault as plain files and trades their versions with the others: over the tailnet (the hub,
normally the M1, else any peer) and through the iCloud mailbox (`iCloud Drive/Vaultite sync/<vault id>/<device>/`, each
device writing only its own folder). Merges happen on the devices: text by line, JSON by key; where two devices changed
the same lines the later change stays and the note offers the other side (its banner) until it's settled.
- `vau sync` (status), `vau sync conflicts`, `vau sync compare` (shadow mode against the live vault), `vau sync release`
  (deletes held because many files went missing at once), `vau sync hub <machine>`, `vau sync snapshot` (the hub's git).
- Shadow mode (`vau sync shadow`): a private copy outside the vault, fed from it and compared with it; nothing serves it.
- Its state is the machine's (`<LOCAL>/sync/`), never the vault's. Don't edit sets.json or the store by hand.
