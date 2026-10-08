## Provenance (`origin`)
Who wrote a Markdown file, one frontmatter key: by default `origin: human` (the user wrote it), `reviewed` (an AI wrote
it, the user read it through), `mixed` (the user and an AI both wrote it), `ai` (an AI wrote it, unreviewed); no key is
unlabeled, which is the user's own unless the vault labels theirs (`label_user`, below). A label, not a lock. Edit a
file marked `origin: human`, or an unlabeled one, only when the user asks; mark notes you write `origin: ai` (an agent's
new notes through the API get it by themselves; the user's, made in the app or the CLI by hand, get `human` only with
`label_user` on) and never set `human`, `reviewed` or `mixed` yourself. Leave the
key alone when you edit a file: the user relabels.
Database views filter on it like any key (`where: origin = ai`, `where: not has origin`).

Files that aren't Markdown (images, videos, SVG, audio, PDFs, any attachment) have the same label, kept in
`.vaultite/plugins/provenance/files.json` (`{"<vault path>": "<value>"}`), never in the file: relabelling never
rewrites the user's photos. Read and set it with `vau origin <path>` / `vau origin set <path> ai` (the ops
`provenance.get`, `provenance.set`, for notes too), not by editing that list. A file you upload (`upload_file`,
`vau upload`) is labelled `ai` by itself, and a new PNG, JPEG, WebP, MP4/MOV or SVG gets the IPTC mark for AI-made
media inside (XMP `Iptc4xmpExt:DigitalSourceType` = trainedAlgorithmicMedia). An unlabelled file whose bytes carry that
mark (or a C2PA manifest saying so: ChatGPT's and Gemini's images) reads as `ai` (`from: file`). Labels follow files
moved with `vau move` or the app. Agents set only `ai`: `provenance.set` refuses human, reviewed, mixed and removing a
label from an agent. A database view over every file (a `.base`) filters attachments on `origin` too.

The values are the vault's to change, in `.vaultite/plugins/provenance/data.json` (or its settings sheet):
`values: [{value, label, icon, tint, hint}]` in the menu's order (`icon` a name like `pen-line`, `tint` a colour token:
gray, red, orange, yellow, green, teal, blue, indigo, purple, pink), `agent` (the value agents' notes get, `ai` by
default), `label_agents: false` (agents' notes aren't labelled) and `label_user: true` (the user's are, with the first
value: off by default, when a file's header shows no label for them). With no `values`, the four above.
