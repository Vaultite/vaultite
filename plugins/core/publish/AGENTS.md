## Publish
Notes and folders the user chose, as public pages on their Vaultite Cloud site (`https://publish.vaultite.app/<handle>`),
for anyone with the address. Needs this machine signed in to Vaultite Cloud and a Publish plan (bought in a browser).
- Which ones: `published` in `.vaultite/plugins/publish/data.json` (vault paths, notes without `.md`; a folder takes its
  notes at any depth, not hidden or archived ones). The pages are Vaultite Cloud's, sent from here.
- `vau publish` lists them with their addresses; `vau publish add <note or folder>`, `vau publish remove <...>`;
  `vau publish sync` sends changes. Only when the user asks: it makes their notes public.
- Links to published notes stay links, others read as text; images are uploaded; `block-*` views and `%% comments %%`
  are left out. A note named Index is the site's home page.
