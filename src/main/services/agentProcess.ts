/**
 * UtilityProcess entry point — loaded by utilityProcess.fork() in the coordinator.
 * Runs AgentWorker in an isolated child process.
 *
 * ⚠️  DO NOT import from 'electron' here — this runs in a UtilityProcess,
 * not the main process.  Only Node.js APIs and non-Electron modules are available.
 */

import { AgentWorker } from './agentWorker'
import type { WorkerCommand } from './agentProcessTypes'
import { resolveBraidDataRequest, rejectBraidDataRequest } from './braidMcp'
import { isEpipe } from '../lib/errors'

// EPIPE is expected when the SDK aborts an in-flight request — the claude CLI
// subprocess pipe closes before all writes drain.  Without these handlers Node.js
// crashes the UtilityProcess with exit code 1.
//
// stdout/stderr get explicit 'error' listeners because Node.js v22 does NOT route
// pipe-close EPIPEs from process.stdout/stderr through 'uncaughtException' — it
// throws directly on the Socket, bypassing the global hook.
process.stdout.on('error', (err) => { if (!isEpipe(err)) throw err })
process.stderr.on('error', (err) => { if (!isEpipe(err)) throw err })
process.on('uncaughtException', (err) => {
  if (isEpipe(err)) return
  throw err
})
process.on('unhandledRejection', (reason) => {
  if (isEpipe(reason)) return
  throw reason
})

function postToParent(msg: unknown): void {
  try {
    process.parentPort!.postMessage(msg)
  } catch (e) {
    // Parent IPC channel gone — EPIPE is expected; other errors are re-thrown.
    if (!isEpipe(e)) throw e
  }
}

const worker = new AgentWorker(postToParent)

process.parentPort!.on('message', (e: { data: WorkerCommand }) => {
  const cmd = e.data
  switch (cmd.type) {
    case 'startSession':
      // Fire-and-forget — events stream back via emit → parentPort
      worker.startSession(
        cmd.sessionId, cmd.worktreeId, cmd.projectName,
        cmd.worktreePath, cmd.prompt, cmd.model,
        cmd.thinking, cmd.extendedContext, cmd.effortLevel, cmd.planMode, cmd.sessionName, cmd.settings,
        cmd.images, cmd.additionalDirectories, cmd.linkedWorktreeContext,
        cmd.connectedDeviceId, cmd.mobileFramework
      )
      break
    case 'sendMessage':
      worker.sendMessage(
        cmd.sessionId, cmd.message, cmd.sdkSessionId, cmd.cwd,
        cmd.model, cmd.extendedContext, cmd.effortLevel, cmd.planMode, cmd.sessionName, cmd.settings,
        cmd.images, cmd.additionalDirectories, cmd.linkedWorktreeContext,
        cmd.connectedDeviceId, cmd.mobileFramework, cmd.resumeSessionAt
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
    case 'generateCommitMessage':
    case 'generateSessionTitle':
    case 'getSlashCommands':
      handleRequestResponse(cmd)
      break
    case 'braidDataResponse':
      resolveBraidDataRequest(cmd.requestId, cmd.value)
      break
    case 'braidDataError':
      rejectBraidDataRequest(cmd.requestId, cmd.message)
      break
  }
})

type RequestCommand = Extract<WorkerCommand, { requestId: string }>

async function handleRequestResponse(cmd: RequestCommand): Promise<void> {
  try {
    let value: unknown
    switch (cmd.type) {
      case 'generateCommitMessage':
        value = await worker.generateCommitMessage(cmd.worktreePath, cmd.settings)
        break
      case 'generateSessionTitle':
        value = await worker.generateSessionTitle(
          cmd.userMessage, cmd.assistantSummary, cmd.settings, cmd.currentTitle
        )
        break
      case 'getSlashCommands':
        value = await worker.getSlashCommands(cmd.cwd)
        break
    }
    postToParent({ type: 'result', requestId: cmd.requestId, value })
  } catch (err) {
    postToParent({
      type: 'result_error',
      requestId: cmd.requestId,
      message: err instanceof Error ? err.message : String(err)
    })
  }
}
