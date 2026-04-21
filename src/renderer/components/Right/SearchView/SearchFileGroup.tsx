import type { SearchFileResult, SearchMatch } from '../../../../shared/search'
import { IconChevronRight, IconChevronDown } from '@/components/shared/icons'
import { SearchResultRow } from './SearchResultRow'

interface Props {
  file: SearchFileResult
  collapsed: boolean
  showReplace: boolean
  worktreePath: string
  onToggleCollapsed: () => void
  onReplaceOne: (match: SearchMatch) => void
}

export function SearchFileGroup({
  file,
  collapsed,
  showReplace,
  worktreePath,
  onToggleCollapsed,
  onReplaceOne,
}: Props) {
  const segments = file.relativePath.split('/')
  const name = segments[segments.length - 1]
  const dir = segments.slice(0, -1).join('/')

  return (
    <div className="search-file-group">
      <button
        type="button"
        className="search-file-header"
        onClick={onToggleCollapsed}
      >
        {collapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
        <span className="search-file-name">{name}</span>
        {dir && <span className="search-file-dir">{dir}</span>}
        <span className="search-file-count">{file.matches.length}</span>
      </button>
      {!collapsed && (
        <div className="search-file-matches">
          {file.matches.map((match, idx) => (
            <SearchResultRow
              key={`${match.lineNumber}-${match.matchStart}-${idx}`}
              file={file}
              match={match}
              showReplace={showReplace}
              worktreePath={worktreePath}
              onReplaceOne={() => onReplaceOne(match)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
