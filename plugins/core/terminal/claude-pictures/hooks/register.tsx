import type { ElementTable, Register } from 'claude-code'
import { decoded, drawn, type Picture } from './picture.ts'

type Got = Picture | { why: string }

const PASTED_MAX = 32 << 20
const KEPT = 20
/** By the prompt's text: UserMessage's render gets only its text. */
const pasted = new Map<string, { bytes?: Uint8Array; got?: Got }[]>()
const reads = new Map<string, Got>()

const keep = <V,>(m: Map<string, V>, key: string, v: V) => {
  m.set(key, v)
  while (m.size > KEPT) m.delete(m.keys().next().value!)
  return v
}

function readPicture(output: unknown): Got | null {
  const o = output as { type?: string; file?: { base64?: string } } | undefined
  const b64 = o?.type === 'image' ? o.file?.base64 : undefined
  if (!b64) return null
  return reads.get(b64) ?? keep(reads, b64, decoded(Uint8Array.fromBase64(b64)))
}

export const register: Register = on => {
  // $.prompt.media answers only while the prompt goes in.
  on('prompt.submit', async ($, e, next) => {
    const got: { bytes?: Uint8Array; got?: Got }[] = []
    for (const a of e.attachments ?? []) {
      if (a.type !== 'image' || !a.id) continue
      const parts: string[] = []
      let at: number | undefined = 0, why = ''
      while (at !== undefined) {
        const m = await $.prompt.media({ id: a.id, offset: at })
        if (!m.base64) { why = m.unreadable ?? m.deny ?? 'not readable'; break }
        if (m.size > PASTED_MAX) { why = 'too many bytes'; break }
        parts.push(m.base64); at = m.next
      }
      got.push(why ? { got: { why } } : { bytes: Uint8Array.fromBase64(parts.join('')) })
    }
    if (got.length) keep(pasted, e.text, got)
    return next(e)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const pics = pasted.get(e.props.text)
    if (!pics || e.surface !== 'terminal') return next(e)
    for (const p of pics) if (!p.got) { p.got = decoded(p.bytes!); p.bytes = undefined }
    const { Box, Image, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {await next(e)}
        {pics.map((p, i) => shown({ Image, Text }, p.got!, pics.length, `pasted-${i}`, 'pasted picture'))}
      </Box>
    )
  })

  // Only the terminal surface has Image.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.tool !== 'Read' || e.props.isErrored) return next(e)
    const p = readPicture(e.props.output)
    if (!p) return next(e)
    const { Box, Image, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {await next(e)}
        {shown({ Image, Text }, p, 1, 'read', 'picture')}
      </Box>
    )
  })
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded || e.surface !== 'terminal') return next(e)
    const pics = e.props.calls.filter((c) => c.tool === 'Read' && !c.isErrored).map((c) => readPicture(c.output)).filter((p) => p !== null)
    if (!pics.length) return next(e)
    const { Box, Image, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {await next(e)}
        {pics.map((p, i) => shown({ Image, Text }, p, pics.length, `read-${i}`, 'picture'))}
      </Box>
    )
  })
}

function shown({ Image, Text }: Pick<ElementTable<'terminal'>, 'Image' | 'Text'>, p: Got, share: number, key: string, alt: string) {
  if ('why' in p) return <Text key={key} dimColor>[{alt} not shown: {p.why}]</Text>
  const d = drawn(p, share)
  return <Image key={key} source={d.source} columns={d.columns} rows={d.rows} alt={`[${alt}]`} />
}
