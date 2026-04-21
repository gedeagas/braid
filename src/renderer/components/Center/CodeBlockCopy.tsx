import { isValidElement, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { IconCopy, IconCheckmark } from '@/components/shared/icons'

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (node == null || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (isValidElement<{ children?: React.ReactNode }>(node)) return extractText(node.props.children)
  return ''
}

export function CodeBlockWithCopy({ children, ...rest }: React.HTMLAttributes<HTMLPreElement>) {
  const { t } = useTranslation('common')
  const text = useMemo(() => extractText(children), [children])
  const { copied, handleCopy } = useCopyToClipboard(text)

  return (
    <div className="code-block-wrapper">
      <pre {...rest}>{children}</pre>
      <button
        className={`code-block-copy-btn${copied ? ' code-block-copy-btn--copied' : ''}`}
        onClick={handleCopy}
        title={copied ? t('copied') : t('copy')}
      >
        {copied ? <IconCheckmark size={14} /> : <IconCopy size={14} />}
      </button>
    </div>
  )
}
