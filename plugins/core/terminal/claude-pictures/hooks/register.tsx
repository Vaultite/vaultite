// A Claude Code mod: the pictures Claude reads (Read of a PNG) and the ones the person pastes, drawn under their rows
// (Image: kitty graphics). Vaultite's terminals load it (CLAUDE_CODE_PLUGIN_DIRS, terminal/plugin.ts env).
import type { ImageSource, Register } from 'claude-code'

/** The cells a picture takes at most; a cell is about twice as tall as it's wide. */
const MAX_COLUMNS = 48, MAX_ROWS = 16
/** Bytes an Image carries itself at most (decoded); a bigger PNG is named by its file. */
const BYTES_MAX = 2 << 20
/** Pasted pictures, by the prompt's text they came with (the row draws only its text): the last few. */
const pasted = new Map<string, string[]>()

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
/** A PNG's size, from its header (IHDR: width and height at bytes 16 and 20), in its base64. */
function pngSize(b64: string) {
  const bytes: number[] = []
  for (let i = 0; i + 4 <= Math.min(b64.length, 32); i += 4) {
    const n = [0, 1, 2, 3].reduce((v, k) => (v << 6) | Math.max(0, B64.indexOf(b64[i + k])), 0)
    bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255)
  }
  const u32 = (o: number) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0
  return bytes[1] === 0x50 && bytes[2] === 0x4e ? { width: u32(16), height: u32(20) } : null
}
/** Cells for a picture of `width` × `height` px: its shape kept, within MAX_COLUMNS × MAX_ROWS. */
function cells(width: number, height: number) {
  let columns = Math.min(MAX_COLUMNS, Math.max(1, Math.round(width / 8)))
  let rows = Math.max(1, Math.round((columns * height) / width / 2))
  if (rows > MAX_ROWS) { rows = MAX_ROWS; columns = Math.max(1, Math.round((rows * 2 * width) / height)) }
  return { columns, rows }
}
/** What draws a PNG: its bytes, or its file when they're too many to carry. */
function picture(b64: string, file?: string): { source: ImageSource; columns: number; rows: number } | null {
  const size = pngSize(b64)
  if (!size) return null
  const source: ImageSource = (b64.length * 3) / 4 <= BYTES_MAX ? { png: b64 } : file ? { file, format: 'png' } : null!
  return source ? { source, ...cells(size.width, size.height) } : null
}
/** A Read call's picture, when it read a PNG. */
function readPicture(input: unknown, output: unknown) {
  const o = output as { type?: string; file?: { base64?: string; type?: string } } | undefined
  if (o?.type !== 'image' || o.file?.type !== 'image/png' || !o.file.base64) return null
  const path = (input as { file_path?: unknown } | undefined)?.file_path
  return picture(o.file.base64, typeof path === 'string' && path.endsWith('.png') ? path : undefined)
}

export const register: Register = on => {
  // Pasted pictures: read while the prompt goes in, drawn under its row.
  on('prompt.submit', async ($, e, next) => {
    const pngs: string[] = []
    for (const a of e.attachments ?? []) {
      if (a.type !== 'image' || !a.id) continue
      let b64 = '', at: number | undefined = 0
      while (at !== undefined && b64.length < BYTES_MAX * 2) {
        const m = await $.prompt.media({ id: a.id, offset: at })
        if (!m.base64 || m.mediaType !== 'image/png') { b64 = ''; break }
        b64 += m.base64; at = m.next
      }
      if (b64) pngs.push(b64)
    }
    if (pngs.length) {
      pasted.set(e.text, pngs)
      while (pasted.size > 20) pasted.delete(pasted.keys().next().value!)
    }
    return next(e)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const pngs = pasted.get(e.props.text)
    if (!pngs) return next(e)
    const { Box, Image } = $.ui.resolve(e)
    const pics = pngs.map((b) => picture(b)).filter((p) => p !== null)
    return (
      <Box flexDirection="column">
        {await next(e)}
        {pics.map((p, i) => <Image key={`pasted-${i}`} source={p.source} columns={p.columns} rows={p.rows} alt="[pasted picture]" />)}
      </Box>
    )
  })

  // A standalone Read's result, and a run of reads folded into one line.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const p = e.props.tool === 'Read' && !e.props.isErrored ? readPicture(undefined, e.props.output) : null
    if (!p) return next(e)
    const { Box, Image } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {await next(e)}
        <Image key="read" source={p.source} columns={p.columns} rows={p.rows} alt="[picture]" />
      </Box>
    )
  })
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const pics = e.props.calls.filter((c) => c.tool === 'Read' && !c.isErrored).map((c) => readPicture(c.input, c.output)).filter((p) => p !== null)
    if (!pics.length) return next(e)
    const { Box, Image } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {await next(e)}
        {pics.map((p, i) => <Image key={`read-${i}`} source={p.source} columns={p.columns} rows={p.rows} alt="[picture]" />)}
      </Box>
    )
  })
}
