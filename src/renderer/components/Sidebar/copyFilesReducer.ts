export interface CopyFileEntry {
  path: string
  exists: boolean
  size: number
  checked: boolean
}

export interface CopyFilesState {
  savedFiles: CopyFileEntry[]
  discoveredFiles: CopyFileEntry[]
  loading: boolean
  sourceBranch: string
}

export type CopyFilesAction =
  | { type: 'startLoading' }
  | { type: 'setFiles'; saved: CopyFileEntry[]; discovered: CopyFileEntry[]; sourceBranch: string }
  | { type: 'toggle'; group: 'saved' | 'discovered'; path: string }

export function copyFilesReducer(state: CopyFilesState, action: CopyFilesAction): CopyFilesState {
  switch (action.type) {
    case 'startLoading':
      return { ...state, loading: true }
    case 'setFiles':
      return { savedFiles: action.saved, discoveredFiles: action.discovered, loading: false, sourceBranch: action.sourceBranch }
    case 'toggle': {
      const key = action.group === 'saved' ? 'savedFiles' : 'discoveredFiles'
      return {
        ...state,
        [key]: state[key].map((f) =>
          f.path === action.path && f.exists ? { ...f, checked: !f.checked } : f
        )
      }
    }
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
