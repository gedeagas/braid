/**
 * DiffCommentEditor - Inline comment editor shown below a diff line or range.
 * Renders a reference preview of the selected line(s) + textarea + actions.
 */
import { useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui'

interface EditorLine {
  content: string
  lineNumber: number
  lineType: 'add' | 'del' | 'ctx'
  /** Pre-highlighted HTML for syntax coloring (from Shiki) */
  highlightedHtml?: string
}

interface DiffCommentEditorProps {
  /** One or more lines the comment applies to */
  lines: EditorLine[]
  draft: string
  existingText?: string
  onDraftChange: (text: string) => void
  onSave: () => void
  onCancel: () => void
  onDelete?: () => void
}

export function DiffCommentEditor({
  lines,
  draft,
  existingText,
  onDraftChange,
  onSave,
  onCancel,
  onDelete,
}: DiffCommentEditorProps) {
  const { t } = useTranslation('center')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (draft.trim()) onSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  const isRange = lines.length > 1
  const first = lines[0]
  const last = lines[lines.length - 1]

  return (
    <div className="diff-review-comment-editor">
      {/* Reference: single line or collapsed range */}
      <div className={`diff-review-comment-editor-ref${isRange ? ' diff-review-comment-editor-ref--range' : ''}`}>
        {isRange ? (
          <>
            <span className="diff-review-comment-editor-range-label">
              L{first.lineNumber}-{last.lineNumber} ({lines.length} lines)
            </span>
            <div className="diff-review-comment-editor-range-lines">
              {lines.map((l, i) => (
                <div key={i} className="diff-review-comment-editor-range-line">
                  <span className={`diff-review-comment-editor-gutter diff-line-${l.lineType}`}>
                    {l.lineType === 'add' ? '+' : l.lineType === 'del' ? '-' : ' '}
                  </span>
                  <code
                    className="diff-review-comment-editor-code"
                    {...(l.highlightedHtml
                      ? { dangerouslySetInnerHTML: { __html: l.highlightedHtml } }
                      : { children: l.content }
                    )}
                  />
                </div>
              ))}
            </div>
          </>
        ) : first && (
          <>
            <span className={`diff-review-comment-editor-gutter diff-line-${first.lineType}`}>
              {first.lineType === 'add' ? '+' : first.lineType === 'del' ? '-' : ' '}
            </span>
            <code
              className="diff-review-comment-editor-code"
              {...(first.highlightedHtml
                ? { dangerouslySetInnerHTML: { __html: first.highlightedHtml } }
                : { children: first.content }
              )}
            />
            <span className="diff-review-comment-editor-line">L{first.lineNumber}</span>
          </>
        )}
      </div>
      <textarea
        ref={textareaRef}
        className="diff-review-comment-textarea"
        placeholder={t('commentPlaceholder')}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
      />
      <div className="diff-review-comment-actions">
        <Button variant="primary" size="sm" disabled={!draft.trim()} onClick={onSave}>
          {existingText ? t('saveComment') : t('addComment')}
        </Button>
        <Button variant="default" size="sm" onClick={onCancel}>
          {t('cancelComment')}
        </Button>
        {onDelete && (
          <Button variant="default" size="sm" onClick={onDelete} className="diff-review-comment-delete">
            {t('deleteComment')}
          </Button>
        )}
      </div>
    </div>
  )
}
