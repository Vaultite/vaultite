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
