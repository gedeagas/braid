import type { SessionStatus } from './session'

// ─── UI / Panel types ─────────────────────────────────────────────────────────

export type RightPanelTab = 'files' | 'changes' | 'overview' | 'notes' | 'simulator' | 'windowCapture'
export type TabDisplayMode = 'icons' | 'labels' | 'both'

export interface CaptureSource {
  id: string
  name: string
  appName: string
  thumbnailDataUrl: string
}

export type ToastSize = 'small' | 'medium' | 'large'
export type ToastPosition = 'bottom-right' | 'bottom-left' | 'top-center'
export type ToastDuration = 5 | 10 | 15

// ─── Mission Control (Overview Board) ────────────────────────────────────────

export type SessionColumnId = 'idle' | 'running' | 'need_attention' | 'done'
export type PrColumnId = 'pr_open' | 'pr_draft' | 'pr_merged_closed'
export type KanbanColumnId = SessionColumnId | PrColumnId
export type MissionControlTab = 'sessions' | 'prs'

export interface SessionCardData {
  kind: 'session'
  sessionId: string
  sessionName: string
  worktreeId: string
  projectId: string
  projectName: string
  branch: string
  status: SessionStatus
  activity: string | null
  runStartedAt: number | null
  column: SessionColumnId
}

export interface PrCardData {
  kind: 'pr'
  worktreeId: string
  projectId: string
  projectName: string
  branch: string
  path: string
  isMain: boolean
  pr: { number: number; title: string; state: string; url: string; isDraft: boolean }
  checksStatus: 'passing' | 'failing' | 'pending' | 'none'
  changeStats: { additions: number; deletions: number; total: number } | null
  column: PrColumnId
}

export type BoardCardData = SessionCardData | PrCardData

// ─── Embedded Web Apps ────────────────────────────────────────────────────────

export interface EmbeddedApp {
  id: string
  name: string
  url: string
  visible: boolean
}
