/**
 * Message protocol between AgentCoordinator (main process) and
 * UtilityProcess children running AgentWorker.
 *
 * ⚠️  DO NOT import from 'electron' here — this file is shared
 * between main process and UtilityProcess.
 */

import type { AcpAgentConfig, AgentBackend, AgentSettings, SlashCommand } from './agentTypes'

/** Commands sent from coordinator (main) → UtilityProcess child. */
export type WorkerCommand =
  | {
      type: 'startSession'; sessionId: string; worktreeId: string; projectName: string
      worktreePath: string; prompt: string
      model: string; thinking: boolean; planMode: boolean; sessionName: string
      settings: AgentSettings; images?: string[]; additionalDirectories?: string[]
      linkedWorktreeContext?: string; connectedDeviceId?: string; mobileFramework?: string
      backend?: AgentBackend
      /** ACP agent config resolved by coordinator (main process). Avoids Electron import in UtilityProcess. */
      agentConfig?: AcpAgentConfig
    }
  | {
      type: 'sendMessage'; sessionId: string; message: string; sdkSessionId: string
      cwd: string; model: string; planMode: boolean; sessionName: string
      settings: AgentSettings; images?: string[]; additionalDirectories?: string[]
      linkedWorktreeContext?: string; connectedDeviceId?: string; mobileFramework?: string
    }
  | { type: 'stopSession'; sessionId: string }
  | { type: 'closeSession'; sessionId: string }
  | { type: 'answerToolInput'; sessionId: string; result: Record<string, unknown> }
  | { type: 'answerElicitation'; sessionId: string; result: { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> } }
  | { type: 'updateSessionName'; sessionId: string; name: string }
  | { type: 'setAcpModel'; sessionId: string; modelId: string }
  | {
      type: 'generateCommitMessage'; requestId: string
      worktreePath: string; settings: AgentSettings
    }
  | {
      type: 'generateSessionTitle'; requestId: string
      userMessage: string; assistantSummary: string
      settings: AgentSettings; currentTitle?: string
    }
  | { type: 'getSlashCommands'; requestId: string; cwd: string }
  | { type: 'braidDataResponse'; requestId: string; value: unknown }
  | { type: 'braidDataError'; requestId: string; message: string }

/** Responses for request/reply operations (alongside WorkerEvent for streaming). */
export type WorkerResult =
  | { type: 'result'; requestId: string; value: unknown }
  | { type: 'result_error'; requestId: string; message: string }
