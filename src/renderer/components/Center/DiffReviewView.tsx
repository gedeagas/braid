/**
 * DiffReviewView - Interactive diff viewer with line-level and multiline comments.
 * Rendered inside ChatView (replacing the message list) when in changes mode.
 *
 * GitHub-style selection model:
 *  - Hover a line to reveal a "+" affordance in the gutter
 *  - Click a line to open a single-line comment editor
 *  - Click-drag across lines in the same hunk to select a range
 *  - The comment editor appears below the last line in the selection
 *  - Lines with existing comments show a blue dot in the gutter
 *  - Collapsed unmodified lines between hunks can be expanded and commented
 */
import { Fragment, useReducer, useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Spinner, Badge } from '@/components/ui'
import { parseDiff, type DiffLine } from '@/lib/diffUtils'
import { DiffCommentEditor } from './DiffCommentEditor'
import { computeGaps, buildGapLines, type GapInfo } from './diffGapUtils'
import { reducer, initialState } from './diffReviewReducer'
import { BinaryDiffView } from '@/components/shared/BinaryDiffView'
import { isBinaryFile, isGitBinaryDiff } from '@/lib/binaryFile'
import { useShikiHighlight } from '@/hooks/useShikiHighlight'
import * as ipc from '@/lib/ipc'
import type { DiffComment } from '@/types'
import { useUIStore, type GitStatusCode } from '@/store/ui'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function lineNo(line: DiffLine): number | null {
  return line.type === 'del' ? line.oldNo : line.newNo
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface DiffReviewViewProps {
  filePath: string | null
  worktreePath: string
  /** Git status code for the file ('M', 'A', 'D', 'R', '?'). Defaults to 'M'. */
  fileStatus?: GitStatusCode
  /** Whether the file is staged. Defaults to false. */
  fileStaged?: boolean
  onCommentsChange: (comments: DiffComment[]) => void
  onRegisterClear?: (clearFn: () => void) => void
  initialComments?: DiffComment[]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DiffReviewView({ filePath, worktreePath, fileStatus = 'M', fileStaged = false, onCommentsChange, onRegisterClear, initialComments }: DiffReviewViewProps) {
  const { t } = useTranslation('center')
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    comments: initialComments ?? [],
  })

  // True while the mouse button is held (drag in progress). useState so CSS class updates.
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ hunkIdx: number; anchorLineIdx: number } | null>(null)

  const fileComments = useMemo(
    () => (filePath ? state.comments.filter((c) => c.file === filePath) : []),
    [state.comments, filePath],
  )

  // Subscribe to diff revision so we re-fetch when changes are detected (e.g. new stage/unstage)
  const diffRevision = useUIStore((s) => s.diffRevisionByWorktree[worktreePath] ?? 0)

  useEffect(() => { onCommentsChange(state.comments) }, [state.comments, onCommentsChange])
  useEffect(() => { onRegisterClear?.(() => dispatch({ type: 'CLEAR_COMMENTS' })) }, [onRegisterClear])

  // ─── Fetch diff ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!worktreePath || !filePath) return
    let cancelled = false
    async function load() {
      dispatch({ type: 'LOADING' })

      // Detect binary by extension before attempting a text read
      if (isBinaryFile(filePath!)) {
        if (!cancelled) dispatch({ type: 'LOADED_BINARY' })
        return
      }

      try {
        const raw = await ipc.git.getFileDiff(worktreePath, filePath!, fileStatus, fileStaged) as string
        if (cancelled) return

        // Git may report binary even if the extension wasn't recognized
        if (isGitBinaryDiff(raw)) {
          dispatch({ type: 'LOADED_BINARY' })
          return
        }

        const hunks = parseDiff(raw)
        let add = 0, del = 0
        for (const line of raw.split('\n')) {
          if (line.startsWith('+') && !line.startsWith('+++')) add++
          else if (line.startsWith('-') && !line.startsWith('---')) del++
        }
        dispatch({ type: 'LOADED', diff: raw, hunks, stats: { add, del } })
      } catch {
        if (!cancelled) dispatch({ type: 'ERROR' })
      }
    }
    load()
    return () => { cancelled = true }
  }, [worktreePath, filePath, fileStatus, fileStaged, diffRevision])

  // ─── Gap expansion ─────────────────────────────────────────────────────────

  const gaps = useMemo(
    () => computeGaps(state.hunks, state.fileLines?.length ?? 0),
    [state.hunks, state.fileLines],
  )

  const gapMap = useMemo(() => {
    const map = new Map<number, GapInfo>()
    for (const gap of gaps) {
      if (!state.expandedGaps.has(gap.index)) map.set(gap.index, gap)
    }
    return map
  }, [gaps, state.expandedGaps])

  const handleExpandGap = useCallback(async (gap: GapInfo) => {
    let cached = state.fileLines
    if (!cached && filePath) {
      try {
        const content = await ipc.git.readFile(`${worktreePath}/${filePath}`)
        const parsed = content.split('\n')
        dispatch({ type: 'FILE_LOADED', lines: parsed })
        cached = parsed
      } catch { return }
    }
    if (!cached) return
    const gapLines = buildGapLines(cached, gap.startNewNo, gap.startOldNo, gap.count)
    dispatch({ type: 'EXPAND_GAP', gapIndex: gap.index, lines: gapLines })
  }, [state.fileLines, filePath, worktreePath])

  // ─── Comment lookup ──────────────────────────────────────────────────────────

  const commentForLine = useCallback((line: DiffLine): DiffComment | undefined => {
    const ln = lineNo(line)
    if (ln === null) return undefined
    const isDel = line.type === 'del'
    return fileComments.find((c) => {
      if ((c.lineType === 'del') !== isDel) return false
      const cEnd = c.endLine ?? c.line
      return ln >= c.line && ln <= cEnd
    })
  }, [fileComments])

  const isInEditingRange = useCallback((hunkIdx: number, lineIdx: number): boolean => {
    if (!state.editing) return false
    return state.editing.hunkIdx === hunkIdx &&
      lineIdx >= state.editing.startLineIdx &&
      lineIdx <= state.editing.endLineIdx
  }, [state.editing])

  /** Find the hunk line index corresponding to the start of a multiline comment. */
  const findCommentStartIdx = useCallback((hunkIdx: number, endLineIdx: number, comment: DiffComment): number => {
    if (comment.endLine == null) return endLineIdx
    const hunkLines = state.hunks[hunkIdx]?.lines
    if (!hunkLines) return endLineIdx
    const isDel = comment.lineType === 'del'
    for (let j = endLineIdx - 1; j >= 0; j--) {
      const l = hunkLines[j]
      if (!l || l.type === 'hunk' || l.type === 'meta') continue
      if (lineNo(l) === comment.line && (l.type === 'del') === isDel) return j
    }
    return endLineIdx
  }, [state.hunks])

  // ─── Drag interaction ────────────────────────────────────────────────────────

  useEffect(() => {
    const handleMouseUp = () => {
      if (!dragRef.current) return
      dragRef.current = null
      setDragging(false)
      dispatch({ type: 'FINISH_DRAG' })
    }
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [])

  const handleGutterMouseDown = useCallback((e: React.MouseEvent, hunkIdx: number, lineIdx: number) => {
    e.preventDefault()
    dragRef.current = { hunkIdx, anchorLineIdx: lineIdx }
    setDragging(true)
    dispatch({ type: 'START_DRAG', hunkIdx, lineIdx })
  }, [])

  const handleLineMouseEnter = useCallback((hunkIdx: number, lineIdx: number) => {
    if (!dragRef.current || dragRef.current.hunkIdx !== hunkIdx) return
    dispatch({ type: 'EXTEND_DRAG', lineIdx })
  }, [])

  // ─── Save / delete ──────────────────────────────────────────────────────────

  const handleSaveComment = useCallback(() => {
    if (!state.editing || !state.commentDraft.trim() || !filePath) return
    const hunk = state.hunks[state.editing.hunkIdx]
    if (!hunk) return

    const startLine = hunk.lines[state.editing.startLineIdx]
    const endLine = hunk.lines[state.editing.endLineIdx]
    if (!startLine || !endLine) return
    const lt = startLine.type
    if (lt === 'hunk' || lt === 'meta') return

    const startNo = lineNo(startLine)
    const endNo = lineNo(endLine)
    if (startNo === null || endNo === null) return

    const lineContents: string[] = []
    for (let i = state.editing.startLineIdx; i <= state.editing.endLineIdx; i++) {
      const l = hunk.lines[i]
      if (l && l.type !== 'hunk' && l.type !== 'meta') lineContents.push(l.content)
    }

    const isRange = startNo !== endNo
    const comment: DiffComment = {
      id: `dc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      file: filePath,
      line: startNo,
      endLine: isRange ? endNo : undefined,
      lineType: lt,
      lineContent: startLine.content,
      lineContents: isRange ? lineContents : undefined,
      text: state.commentDraft.trim(),
      createdAt: Date.now(),
    }
    dispatch({ type: 'ADD_COMMENT', comment })
    dispatch({ type: 'CLOSE_EDITOR' })
  }, [state.editing, state.commentDraft, state.hunks, filePath])

  const handleDeleteComment = useCallback(() => {
    if (!state.editing) return
    const hunk = state.hunks[state.editing.hunkIdx]
    const line = hunk?.lines[state.editing.startLineIdx]
    if (!line) return
    const existing = commentForLine(line)
    if (existing) dispatch({ type: 'REMOVE_COMMENT', commentId: existing.id })
    dispatch({ type: 'CLOSE_EDITOR' })
  }, [state.editing, state.hunks, commentForLine])

  // ─── Syntax highlighting ────────────────────────────────────────────────────

  // Build flat array of content strings + index map for Shiki highlighting.
  // Each renderable diff line gets a slot; hunk/meta lines are skipped.
  const { contentLines, indexMap } = useMemo(() => {
    const contents: string[] = []
    const map = new Map<string, number>() // "hunkIdx-lineIdx" -> flat index
    for (let hi = 0; hi < state.hunks.length; hi++) {
      const hunk = state.hunks[hi]
      for (let li = 0; li < hunk.lines.length; li++) {
        const line = hunk.lines[li]
        if (line.type === 'hunk' || line.type === 'meta') continue
        map.set(`${hi}-${li}`, contents.length)
        contents.push(line.content)
      }
    }
    return { contentLines: contents, indexMap: map }
  }, [state.hunks])

  const highlightedLines = useShikiHighlight(contentLines, filePath)

  // ─── Render helpers ─────────────────────────────────────────────────────────

  const fileName = useMemo(() => filePath?.split('/').pop() ?? '', [filePath])
  const showEditor = state.editing !== null && !dragging

  const editorProps = useMemo(() => {
    if (!state.editing) return null
    const hunk = state.hunks[state.editing.hunkIdx]
    if (!hunk) return null

    const hi = state.editing.hunkIdx
    const lines: Array<{ content: string; lineNumber: number; lineType: 'add' | 'del' | 'ctx'; highlightedHtml?: string }> = []
    for (let i = state.editing.startLineIdx; i <= state.editing.endLineIdx; i++) {
      const l = hunk.lines[i]
      if (!l || l.type === 'hunk' || l.type === 'meta') continue
      const flatIdx = indexMap.get(`${hi}-${i}`)
      const html = flatIdx != null && highlightedLines ? highlightedLines[flatIdx] : undefined
      lines.push({ content: l.content, lineNumber: lineNo(l) ?? 0, lineType: l.type, highlightedHtml: html })
    }

    const firstLine = hunk.lines[state.editing.startLineIdx]
    const existing = firstLine ? commentForLine(firstLine) : undefined
    return { lines, existingText: existing?.text, existingId: existing?.id }
  }, [state.editing, state.hunks, commentForLine, highlightedLines, indexMap])

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (!filePath) {
    return <div className="diff-review diff-review--empty"><span>{t('selectFileToReview')}</span></div>
  }
  if (state.loading) {
    return <div className="diff-review diff-review--loading"><Spinner size="md" /><span>{t('loadingDiff')}</span></div>
  }
  if (state.isBinary) {
    return (
      <div className="diff-review">
        <div className="diff-review-header">
          <span className="diff-review-filename">{fileName}</span>
          <span className="diff-review-filepath">{filePath}</span>
        </div>
        <div className="diff-review-scroll">
          <BinaryDiffView filePath={filePath} worktreePath={worktreePath} status={fileStatus} staged={fileStaged} />
        </div>
      </div>
    )
  }
  if (state.hunks.length === 0) {
    return <div className="diff-review diff-review--empty"><span>{t('noDiffForReview')}</span></div>
  }

  const trailingGap = gapMap.get(state.hunks.length)

  return (
    <div className={`diff-review${dragging ? ' diff-review--dragging' : ''}`}>
      {/* Header */}
      <div className="diff-review-header">
        <span className="diff-review-filename">{fileName}</span>
        <span className="diff-review-filepath">{filePath}</span>
        {state.stats && (
          <div className="diff-review-stats">
            <span className="diff-stat-add">+{state.stats.add}</span>
            <span className="diff-stat-del">-{state.stats.del}</span>
          </div>
        )}
        {fileComments.length > 0 && (
          <Badge variant="accent">{t('diffCommentCount', { count: fileComments.length })}</Badge>
        )}
      </div>

      {/* Diff hunks with gap expanders */}
      <div className="diff-review-scroll">
        {state.hunks.map((hunk, hi) => {
          const gapBefore = gapMap.get(hi)
          return (
            <Fragment key={hi}>
              {gapBefore && (
                <GapExpander gap={gapBefore} onExpand={handleExpandGap} t={t} />
              )}
              <div className="diff-review-hunk">
                <div className="diff-hunk-header">
                  <span className="diff-hunk-range">{hunk.header.match(/@@ .+? @@/)?.[0] ?? hunk.header}</span>
                  <span className="diff-hunk-ctx">{hunk.header.match(/@@ [^@]+ @@(.*)/)?.[1]?.trim()}</span>
                </div>
                <div className="diff-review-lines">
                  {hunk.lines.map((line, li) => {
                    if (line.type === 'hunk' || line.type === 'meta') return null
                    const inRange = isInEditingRange(hi, li)
                    const isRangeEnd = state.editing?.hunkIdx === hi && state.editing?.endLineIdx === li
                    const existingComment = commentForLine(line)
                    const hasComment = !!existingComment
                    const showCommentDisplay = existingComment && !inRange && (() => {
                      const ln = lineNo(line)
                      return ln !== null && ln === (existingComment.endLine ?? existingComment.line)
                    })()

                    return (
                      <div key={`${hi}-${li}`}>
                        <div
                          className={`diff-review-line diff-line-${line.type}${inRange ? ' diff-review-line--selected' : ''}`}
                          onMouseEnter={() => handleLineMouseEnter(hi, li)}
                        >
                          <span
                            className={`diff-review-gutter${hasComment ? ' diff-review-gutter--has-comment' : ''}`}
                            onMouseDown={(e) => handleGutterMouseDown(e, hi, li)}
                          >
                            <span className="diff-review-gutter-icon">
                              {hasComment ? '●' : '+'}
                            </span>
                          </span>
                          <span className="diff-line-num diff-line-num-old">{line.oldNo ?? ''}</span>
                          <span className="diff-line-num diff-line-num-new">{line.newNo ?? ''}</span>
                          <span className="diff-line-gutter">
                            {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                          </span>
                          <DiffLineContent
                            content={line.content}
                            highlightedHtml={highlightedLines?.[indexMap.get(`${hi}-${li}`) ?? -1]}
                          />
                        </div>

                        {showCommentDisplay && (
                          <CommentDisplay
                            comment={existingComment}
                            onOpen={() => {
                              const startLi = findCommentStartIdx(hi, li, existingComment)
                              dispatch({ type: 'OPEN_EXISTING', hunkIdx: hi, lineIdx: startLi, endLineIdx: li, existingText: existingComment.text })
                            }}
                          />
                        )}

                        {showEditor && isRangeEnd && editorProps && (
                          <DiffCommentEditor
                            lines={editorProps.lines}
                            draft={state.commentDraft}
                            existingText={editorProps.existingText}
                            onDraftChange={(text) => dispatch({ type: 'SET_DRAFT', text })}
                            onSave={handleSaveComment}
                            onCancel={() => dispatch({ type: 'CLOSE_EDITOR' })}
                            onDelete={editorProps.existingId ? handleDeleteComment : undefined}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </Fragment>
          )
        })}
        {trailingGap && (
          <GapExpander gap={trailingGap} onExpand={handleExpandGap} t={t} />
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/** Renders a single diff line's content - highlighted HTML when available, plain text otherwise. */
function DiffLineContent({ content, highlightedHtml }: { content: string; highlightedHtml?: string }) {
  if (highlightedHtml) {
    return <span className="diff-line-content" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
  }
  return <span className="diff-line-content">{content}</span>
}

function GapExpander({ gap, onExpand, t }: { gap: GapInfo; onExpand: (g: GapInfo) => void; t: (key: string, opts?: Record<string, unknown>) => string }) {
  return (
    <div
      className="diff-review-gap-expander"
      role="button"
      tabIndex={0}
      onClick={() => onExpand(gap)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onExpand(gap) } }}
    >
      <span className="diff-review-gap-icon">⋯</span>
      <span>{t('hiddenLines', { count: gap.count })}</span>
    </div>
  )
}

function CommentDisplay({ comment, onOpen }: { comment: DiffComment; onOpen: () => void }) {
  return (
    <div
      className="diff-review-comment-display"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
    >
      {comment.endLine != null && (
        <span className="diff-review-comment-range">L{comment.line}-{comment.endLine}</span>
      )}
      <span className="diff-review-comment-text">{comment.text}</span>
    </div>
  )
}
