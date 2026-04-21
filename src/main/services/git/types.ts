export interface WorktreeInfo {
  path: string
  branch: string
  isMain: boolean
}

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: FileEntry[]
}

export interface GitChangeInfo {
  file: string
  status: string
  staged: boolean
  additions?: number
  deletions?: number
}
