import { Fragment, useMemo, type MouseEvent, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parseMarkdownBlocks } from '@/lib/parseMarkdownBlocks'
import { resolveSafeExternalUrl } from '@/lib/safeExternalUrl'
import * as ipc from '@/lib/ipc'

const markdownPlugins = [remarkGfm]
type TableCellAlignment = 'left' | 'center' | 'right' | 'justify'

const TABLE_CELL_ALIGNMENTS = new Set<TableCellAlignment>(['left', 'center', 'right', 'justify'])
const SAFE_HTML_BLOCK_TAGS = new Set([
  'article',
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'del',
  'details',
  'div',
  'dl',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'kbd',
  'mark',
  'ol',
  'p',
  'pre',
  's',
  'section',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'table',
  'ul',
])
const BLOCKED_HTML_TAGS = new Set([
  'audio',
  'base',
  'button',
  'canvas',
  'embed',
  'form',
  'iframe',
  'img',
  'input',
  'link',
  'math',
  'meta',
  'object',
  'option',
  'picture',
  'script',
  'select',
  'source',
  'style',
  'svg',
  'template',
  'textarea',
  'video',
])

function createMarkdownComponents(baseUrl?: string): Components {
  return {
    a: ({ href, children }) => {
      const safeUrl = resolveSafeExternalUrl(href, baseUrl)
      const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault()
        event.stopPropagation()
        if (safeUrl) ipc.shell.openExternal(safeUrl)
      }
      return <a href={safeUrl ?? undefined} onClick={onClick}>{children}</a>
    },
    img: () => null,
    table: ({ children }) => (
      <div className="task-detail-markdown-table-wrap">
        <table className="task-detail-markdown-table">{children}</table>
      </div>
    ),
  }
}

export function TaskMarkdown({ body, baseUrl }: { body: string; baseUrl?: string }) {
  const components = useMemo(() => createMarkdownComponents(baseUrl), [baseUrl])
  const chunks = useMemo(() => parseMarkdownBlocks(body), [body])
  return (
    <div className="task-detail-markdown">
      {chunks.map((chunk, index) => {
        if (isSafeHtmlBlock(chunk)) {
          return <SafeHtmlBlock key={`html:${index}`} html={chunk} baseUrl={baseUrl} />
        }
        return (
          <ReactMarkdown key={`markdown:${index}`} remarkPlugins={markdownPlugins} components={components}>
            {chunk}
          </ReactMarkdown>
        )
      })}
    </div>
  )
}

export function TaskAvatar({ author, avatarUrl }: { author: string; avatarUrl?: string }) {
  const fallback = (author || '?').trim().charAt(0).toUpperCase() || '?'
  return (
    <span className="task-activity-avatar" aria-hidden="true">
      {avatarUrl ? <img src={avatarUrl} alt="" /> : fallback}
    </span>
  )
}

function isSafeHtmlBlock(block: string): boolean {
  const match = block.trimStart().match(/^<([a-z][\w-]*)(?:\s|>|\/)/i)
  return Boolean(match && SAFE_HTML_BLOCK_TAGS.has(match[1].toLowerCase()))
}

function SafeHtmlBlock({ html, baseUrl }: { html: string; baseUrl?: string }) {
  const content = useMemo(() => parseSafeHtmlBlock(html, baseUrl), [baseUrl, html])
  return <>{content}</>
}

function parseSafeHtmlBlock(html: string, baseUrl?: string): ReactNode {
  if (typeof DOMParser === 'undefined') return null
  const document = new DOMParser().parseFromString(html, 'text/html')
  return renderSafeHtmlNodes(Array.from(document.body.childNodes), baseUrl, 'html')
}

function renderSafeHtmlTable(table: HTMLTableElement, baseUrl: string | undefined, key: string): ReactNode {
  const caption = table.caption ? renderSafeInlineNodes(Array.from(table.caption.childNodes), baseUrl, 'caption') : null
  const headRows = table.tHead ? Array.from(table.tHead.rows).map((row, index) => renderTableRow(row, baseUrl, `head:${index}`)) : []
  const bodyRows = Array.from(table.tBodies)
    .flatMap((section, sectionIndex) => Array.from(section.rows).map((row, rowIndex) => renderTableRow(row, baseUrl, `body:${sectionIndex}:${rowIndex}`)))
  const footRows = table.tFoot ? Array.from(table.tFoot.rows).map((row, index) => renderTableRow(row, baseUrl, `foot:${index}`)) : []
  const directRows = bodyRows.length > 0 || headRows.length > 0 || footRows.length > 0
    ? []
    : Array.from(table.rows).map((row, index) => renderTableRow(row, baseUrl, `row:${index}`))

  if (headRows.length === 0 && bodyRows.length === 0 && footRows.length === 0 && directRows.length === 0) return null

  return (
    <div key={key} className="task-detail-markdown-table-wrap">
      <table className="task-detail-markdown-table">
        {caption && <caption>{caption}</caption>}
        {headRows.length > 0 && <thead>{headRows}</thead>}
        {(bodyRows.length > 0 || directRows.length > 0) && <tbody>{bodyRows.length > 0 ? bodyRows : directRows}</tbody>}
        {footRows.length > 0 && <tfoot>{footRows}</tfoot>}
      </table>
    </div>
  )
}

function renderTableRow(row: HTMLTableRowElement, baseUrl: string | undefined, key: string): ReactNode {
  return (
    <tr key={key}>
      {Array.from(row.cells).map((cell, index) => renderTableCell(cell, baseUrl, `${key}:${index}`))}
    </tr>
  )
}

function renderTableCell(cell: HTMLTableCellElement, baseUrl: string | undefined, key: string): ReactNode {
  const Tag = cell.tagName.toLowerCase() === 'th' ? 'th' : 'td'
  const align = normalizeTableAlignment(cell.getAttribute('align') ?? cell.style.textAlign)
  return (
    <Tag
      key={key}
      colSpan={normalizeTableSpan(cell.colSpan)}
      rowSpan={normalizeTableSpan(cell.rowSpan)}
      style={align ? { textAlign: align } : undefined}
    >
      {renderSafeHtmlNodes(Array.from(cell.childNodes), baseUrl, key)}
    </Tag>
  )
}

function normalizeTableSpan(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 1) return undefined
  return Math.min(Math.trunc(value), 100)
}

function normalizeTableAlignment(value: string): 'left' | 'center' | 'right' | 'justify' | undefined {
  const normalized = value.trim().toLowerCase()
  return TABLE_CELL_ALIGNMENTS.has(normalized as TableCellAlignment) ? normalized as TableCellAlignment : undefined
}

function renderSafeInlineNodes(nodes: Node[], baseUrl: string | undefined, keyPrefix: string): ReactNode[] {
  return renderSafeHtmlNodes(nodes, baseUrl, keyPrefix)
}

function renderSafeHtmlNodes(nodes: Node[], baseUrl: string | undefined, keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => renderSafeHtmlNode(node, baseUrl, `${keyPrefix}:${index}`)).filter((node): node is ReactNode => node !== null)
}

function renderSafeHtmlNode(node: Node, baseUrl: string | undefined, key: string): ReactNode | null {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent
  if (node.nodeType !== Node.ELEMENT_NODE) return null

  const element = node as HTMLElement
  const tagName = element.tagName.toLowerCase()
  if (BLOCKED_HTML_TAGS.has(tagName)) {
    return null
  }

  const children = renderSafeHtmlNodes(Array.from(element.childNodes), baseUrl, key)
  switch (tagName) {
    case 'table':
      return renderSafeHtmlTable(element as HTMLTableElement, baseUrl, key)
    case 'caption':
      return <caption key={key}>{children}</caption>
    case 'thead':
      return <thead key={key}>{children}</thead>
    case 'tbody':
      return <tbody key={key}>{children}</tbody>
    case 'tfoot':
      return <tfoot key={key}>{children}</tfoot>
    case 'tr':
      return <tr key={key}>{children}</tr>
    case 'th':
    case 'td':
      return renderTableCell(element as HTMLTableCellElement, baseUrl, key)
    case 'details':
      return <details key={key} open={element.hasAttribute('open')}>{children}</details>
    case 'summary':
      return <summary key={key}>{children}</summary>
    case 'blockquote':
      return <blockquote key={key}>{children}</blockquote>
    case 'pre':
      return <pre key={key}>{children}</pre>
    case 'p':
      return <p key={key}>{children}</p>
    case 'article':
    case 'div':
    case 'section':
      return <div key={key}>{children}</div>
    case 'h1':
      return <h1 key={key}>{children}</h1>
    case 'h2':
      return <h2 key={key}>{children}</h2>
    case 'h3':
      return <h3 key={key}>{children}</h3>
    case 'h4':
      return <h4 key={key}>{children}</h4>
    case 'h5':
      return <h5 key={key}>{children}</h5>
    case 'h6':
      return <h6 key={key}>{children}</h6>
    case 'hr':
      return <hr key={key} />
    case 'br':
      return <br key={key} />
    case 'ul':
      return <ul key={key}>{children}</ul>
    case 'ol':
      return <ol key={key} start={normalizeOrderedListStart(element.getAttribute('start'))}>{children}</ol>
    case 'li':
      return <li key={key}>{children}</li>
    case 'dl':
      return <dl key={key}>{children}</dl>
    case 'dt':
      return <dt key={key}>{children}</dt>
    case 'dd':
      return <dd key={key}>{children}</dd>
    case 'a':
      return renderSafeHtmlLink(element as HTMLAnchorElement, children, baseUrl, key)
    case 'strong':
    case 'b':
      return <strong key={key}>{children}</strong>
    case 'em':
    case 'i':
      return <em key={key}>{children}</em>
    case 'code':
      return <code key={key}>{children}</code>
    case 'del':
    case 's':
    case 'strike':
      return <del key={key}>{children}</del>
    case 'kbd':
      return <kbd key={key}>{children}</kbd>
    case 'mark':
      return <mark key={key}>{children}</mark>
    case 'small':
      return <small key={key}>{children}</small>
    case 'span':
      return <span key={key}>{children}</span>
    case 'sub':
      return <sub key={key}>{children}</sub>
    case 'sup':
      return <sup key={key}>{children}</sup>
    default:
      return <Fragment key={key}>{children}</Fragment>
  }
}

function normalizeOrderedListStart(value: string | null): number | undefined {
  if (!value) return undefined
  const start = Number.parseInt(value, 10)
  if (!Number.isFinite(start)) return undefined
  return Math.max(Math.min(start, 100000), -100000)
}

function renderSafeHtmlLink(element: HTMLAnchorElement, children: ReactNode[], baseUrl: string | undefined, key: string): ReactNode {
  const safeUrl = resolveSafeExternalUrl(element.getAttribute('href') ?? undefined, baseUrl)
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (safeUrl) ipc.shell.openExternal(safeUrl)
  }
  return <a key={key} href={safeUrl ?? undefined} onClick={onClick}>{children}</a>
}
