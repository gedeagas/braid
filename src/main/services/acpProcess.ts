/**
 * UtilityProcess entry point for ACP agents.
 * Mirrors agentProcess.ts but uses AcpWorker instead of AgentWorker.
 *
 * Spawned by the coordinator when a session uses an ACP backend.
 *
 * Only Node.js APIs are available - no Electron imports.
 */

import { AcpWorker } from './acpWorker'
import type { WorkerCommand } from './agentProcessTypes'

const worker = new AcpWorker((event) => {
  process.parentPort!.postMessage(event)
})

process.parentPort!.on('message', (e: { data: WorkerCommand }) => {
  const cmd = e.data
  switch (cmd.type) {
    case 'startSession':
      worker.startSession(
        cmd.sessionId, cmd.worktreeId, cmd.projectName,
        cmd.worktreePath, cmd.prompt, cmd.model,
        cmd.thinking, cmd.planMode, cmd.sessionName, cmd.settings,
        cmd.images, cmd.additionalDirectories, cmd.linkedWorktreeContext,
        cmd.connectedDeviceId, cmd.mobileFramework, cmd.backend,
        cmd.agentConfig
      )
      break
    case 'sendMessage':
      worker.sendMessage(
        cmd.sessionId, cmd.message, cmd.sdkSessionId, cmd.cwd,
        cmd.model, cmd.planMode, cmd.sessionName, cmd.settings,
        cmd.images, cmd.additionalDirectories, cmd.linkedWorktreeContext,
        cmd.connectedDeviceId, cmd.mobileFramework
      )
      break
    case 'stopSession':
      worker.stopSession(cmd.sessionId)
      break
    case 'closeSession':
      worker.closeSession(cmd.sessionId)
      break
    case 'answerToolInput':
      worker.answerToolInput(cmd.sessionId, cmd.result)
      break
    case 'answerElicitation':
      worker.answerElicitation(cmd.sessionId, cmd.result)
      break
    case 'updateSessionName':
      worker.updateSessionName(cmd.sessionId, cmd.name)
      break
    // ACP agents don't support ephemeral operations (generateCommitMessage,
    // generateSessionTitle, getSlashCommands). Those always use Claude SDK
    // via agentProcess.ts.
  }
})
