import { FolderGit2 } from "lucide-react"
import { definePlugin } from "@vaultite"
import { GitHubIcon } from "./GitHubIcon"
import { ProjectBlock, ProjectCards } from "./Projects"

export default definePlugin({
  // `icon: github` in a file, and plugins about GitHub (their manifests' icon).
  icons: { github: GitHubIcon },
  mock: () => ({
    projects: [{ id: "Projects/Demo app", name: "Demo app", slug: "demo-app", tagline: "A small open source tool", status: "building",
      repo: "example/demo", path: null, links: [], sort: 0, notes: "" }],
  }),
  files: {
    types: ["project"], folders: ["Projects"], icon: FolderGit2, tint: "var(--projects)",
    kicker: () => "Project",
  },
  // ```block-project: a project file's status, tagline and links. ```block-projects: a card per project (the Projects
  // dashboard, pages/Projects.md).
  blocks: { project: (ctx) => <ProjectBlock {...ctx} />, projects: (ctx) => <ProjectCards {...ctx} /> },
})
