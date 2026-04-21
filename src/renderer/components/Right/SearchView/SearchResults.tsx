import type { SearchFileResult, SearchMatch } from '../../../../shared/search'
import { SearchFileGroup } from './SearchFileGroup'

interface Props {
  files: SearchFileResult[]
  collapsed: Set<string>
  showReplace: boolean
  worktreePath: string
  onToggleCollapsed: (path: string) => void
  onReplaceOne: (file: SearchFileResult, match: SearchMatch) => void
}

export function SearchResults({
  files,
  collapsed,
  showReplace,
  worktreePath,
  onToggleCollapsed,
  onReplaceOne,
}: Props) {
  return (
    <div className="search-results">
      {files.map((file) => (
        <SearchFileGroup
          key={file.path}
          file={file}
          collapsed={collapsed.has(file.path)}
          showReplace={showReplace}
          worktreePath={worktreePath}
          onToggleCollapsed={() => onToggleCollapsed(file.path)}
          onReplaceOne={(match) => onReplaceOne(file, match)}
        />
      ))}
    </div>
  )
}
