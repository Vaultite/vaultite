// HTML pages: an .html file is an interactive page (an artifact) on the vault's data, drawn sandboxed (no network, no
// reach into the app). An outside page gets nothing of the vault; off, an .html file is only its source, never run.
import { AppWindow } from "lucide-react"
import { definePlugin, type FileFormat } from "@vaultite"
import { ArtifactFrame } from "./Frame"

const format: FileFormat = {
  exts: ["html", "htm"], icon: AppWindow, code: "html", page: true, edit: "source", layout: "full",
  status: () => null,
  render: ({ path, place }) => <ArtifactFrame path={path} page={place === "page"} className={place === "page" ? undefined : "mt-2"} />,
  embed: ({ path, height }) => <ArtifactFrame path={path} height={height} />,
}

export default definePlugin({
  formats: { page: format },
})
