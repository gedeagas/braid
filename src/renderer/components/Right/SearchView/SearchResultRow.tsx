import { useTranslation } from 'react-i18next'
import type { SearchFileResult, SearchMatch } from '@shared/search'
import { useUIStore } from '@/store/ui'
import { pendingReveal } from '@/lib/pendingReveal'

interface Props {
  file: SearchFileResult
  match: SearchMatch
  showReplace: boolean
  onReplaceOne: () => void
}

export function SearchResultRow({ file, match, showReplace, onReplaceOne }: Props) {
  const { t } = useTranslation('right')
  const before = match.lineText.slice(0, match.matchStart)
  const middle = match.lineText.slice(match.matchStart, match.matchEnd)
  const after = match.lineText.slice(match.matchEnd)

  const handleClick = () => {
    // NOTE:
    // Stash the target in a module-level ref before opening the file. The
    // FileViewer is lazy-loaded, so on the first open its event listener
    // doesn't exist yet and the event would be lost. FileViewer reads from this
    // ref once it mounts. The event below remains as a fast-path for the case
    // where FileViewer is already mounted with the same file.
    const target = { path: file.path, line: match.lineNumber }
    pendingReveal.set(target)
    useUIStore.getState().openFile(file.path)
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('braid:revealLine', { detail: target }))
    })
  }

  return (
    <div
      className="search-result-row"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      }}
    >
      <span className="search-result-line-number">{match.lineNumber}</span>
      <span className="search-result-line-text">
        {before}
        <span className="search-match-highlight">{middle}</span>
        {after}
      </span>
      {showReplace && (
        <button
          type="button"
          className="search-result-replace-btn"
          onClick={(e) => {
            e.stopPropagation()
            onReplaceOne()
          }}
          title={t('searchReplaceOne')}
        >
          {t('searchReplaceOne')}
        </button>
      )}
    </div>
  )
}
