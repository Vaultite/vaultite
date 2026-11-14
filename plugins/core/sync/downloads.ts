import { AudioLines, Film, FileText, Image as ImageIcon, type LucideIcon } from "lucide-react"
import type { MediaKind } from "./phone.ts"

export const KINDS: { kind: MediaKind; name: string; tint: string; icon: LucideIcon }[] = [
  { kind: "video", name: "Video", tint: "var(--blue)", icon: Film }, { kind: "audio", name: "Audio", tint: "var(--orange)", icon: AudioLines },
  { kind: "pdf", name: "PDFs", tint: "var(--red)", icon: FileText }, { kind: "image", name: "Images", tint: "var(--green)", icon: ImageIcon },
]
export const size = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
export const nameOf = (p: string) => p.slice(p.lastIndexOf("/") + 1)
export const folderOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "Vault")
