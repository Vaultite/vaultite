import { Scissors } from "lucide-react"
import { definePlugin, Panel } from "@vaultite"

function Preview() {
  return (
    <Panel title="Web clipper" icon={Scissors}>
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        Saves a web page as a note in Clippings: the article itself as Markdown, with where it's from, its author and when it was
        published. Ask an AI connected through MCP to clip a link, or run vau clip with its address.
      </p>
    </Panel>
  )
}

export default definePlugin({
  preview: () => <Preview />,
})
