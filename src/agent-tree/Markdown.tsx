import type { ReactNode } from 'react'

/**
 * A small Markdown renderer for agent messages: paragraphs, headings, lists, quotes, code blocks,
 * tables as plain rows, and inline code, bold, italic, strikethrough and links. It builds React
 * elements, never HTML, so a message cannot inject markup. Links show their text only.
 */
export function Markdown({ text }: { text: string }) {
  return <>{blocks(text.replace(/\r\n?/g, '\n'))}</>
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/

function blocks(text: string): ReactNode[] {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const fence = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      const body: string[] = []
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i])
      i++
      out.push(<pre key={out.length}><code>{body.join('\n')}</code></pre>)
      continue
    }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      out.push(<p key={out.length} className="md-h">{inline(heading[1])}</p>)
      i++
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(<hr key={out.length} />)
      i++
      continue
    }
    if (LIST.test(line)) {
      const items: { depth: number; ordered: boolean; text: string }[] = []
      for (; i < lines.length && lines[i].trim(); i++) {
        const m = LIST.exec(lines[i])
        if (m) items.push({ depth: Math.min(3, Math.floor(m[1].replace(/\t/g, '  ').length / 2)), ordered: /\d/.test(m[2]), text: m[3] })
        else if (items.length) items[items.length - 1].text += ' ' + lines[i].trim()
      }
      const ordered = items[0].ordered
      const List = ordered ? 'ol' : 'ul'
      out.push(
        <List key={out.length}>
          {items.map((it, k) => (
            <li key={k} style={it.depth ? { marginLeft: it.depth * 14 } : undefined}>{inline(it.text)}</li>
          ))}
        </List>,
      )
      continue
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) body.push(lines[i].replace(/^\s*>\s?/, ''))
      out.push(<blockquote key={out.length}>{blocks(body.join('\n'))}</blockquote>)
      continue
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = []
      for (; i < lines.length && /^\s*\|/.test(lines[i]); i++) {
        if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) continue
        rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
      }
      out.push(
        <div key={out.length} className="md-table">
          {rows.map((r, k) => (
            <p key={k} className={k === 0 ? 'md-th' : undefined}>
              {r.map((c, n) => (
                <span key={n}>{n > 0 && ' · '}{inline(c)}</span>
              ))}
            </p>
          ))}
        </div>,
      )
      continue
    }
    // A paragraph runs until a blank line or another kind of block.
    const body: string[] = []
    for (; i < lines.length && lines[i].trim() && !LIST.test(lines[i]) && !/^\s*(#{1,6}\s|>|```|~~~|\|)/.test(lines[i]); i++) body.push(lines[i].trim())
    out.push(<p key={out.length}>{inline(body.join(' '))}</p>)
  }
  return out
}

const INLINE = /(`+)([^`]+?)\1|\*\*([^*]+?)\*\*|__([^_]+?)__|~~([^~]+?)~~|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    const k = out.length
    if (m[2] !== undefined) out.push(<code key={k}>{m[2]}</code>)
    else if (m[3] !== undefined || m[4] !== undefined) out.push(<strong key={k}>{inline(m[3] ?? m[4])}</strong>)
    else if (m[5] !== undefined) out.push(<s key={k}>{inline(m[5])}</s>)
    else if (m[6] !== undefined || m[7] !== undefined) out.push(<em key={k}>{inline(m[6] ?? m[7])}</em>)
    else if (m[8] !== undefined) out.push(<span key={k} className="md-link" title={m[9]}>{inline(m[8])}</span>)
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
