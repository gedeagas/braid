import { useMemo } from 'react'
import { HTML_PREVIEW_PARTITION } from '@shared/html-preview'
import { pathToFileUrl } from '@/lib/htmlPreview'

interface HtmlFilePreviewProps {
  filePath: string
  title: string
}

export function HtmlFilePreview({ filePath, title }: HtmlFilePreviewProps) {
  const src = useMemo(() => pathToFileUrl(filePath), [filePath])

  return (
    <div className="html-preview">
      <webview
        key={filePath}
        className="html-preview-frame"
        title={title}
        src={src}
        partition={HTML_PREVIEW_PARTITION}
      />
    </div>
  )
}
