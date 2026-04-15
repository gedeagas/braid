import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join, basename } from 'path'
import { buildEnrichedPath, findBinary, pathToFileUri, fileUriToPath, writeMessage, parseSeverity } from './helpers'
import { resolveConfigs, detectServers, detectServersForFile } from './detect'
import { installServer } from './download'
import { waitForEnrichedEnv } from '../../lib/enrichedEnv'
import * as ops from './operations'
import type {
  LspServerStatus, LspServerConfig, LspDetectedServer,
  LspDiagnostic, LspHoverResult, LspLocation, LspRenameResult,
  ServerInstance,
} from './types'

export class LspServerPool extends EventEmitter {
  private servers = new Map<string, ServerInstance>()
  private enrichedPath = buildEnrichedPath()

  constructor() {
    super()
    // buildEnrichedPath() reads enrichedEnv() which may return a fallback PATH
    // before the login-shell probe settles. Refresh once the probe is done so
    // LSP detection/spawning sees nvm, pyenv, rbenv, etc.
    waitForEnrichedEnv().then(() => {
      this.enrichedPath = buildEnrichedPath()
    })
  }

  private serverKey(projectRoot: string, configId: string): string {
    return `${projectRoot}::${configId}`
  }

  // ── Delegated detection & install ──────────────────────────────────────────

  resolveConfigs(userConfigs: LspServerConfig[]): LspServerConfig[] {
    return resolveConfigs(userConfigs)
  }

  detectServers(projectPath: string, userConfigs: LspServerConfig[]): LspDetectedServer[] {
    return detectServers(projectPath, userConfigs, this.enrichedPath)
  }

  detectServersForFile(filePath: string, boundary: string, userConfigs: LspServerConfig[]): LspDetectedServer[] {
    return detectServersForFile(filePath, boundary, userConfigs, this.enrichedPath)
  }

  async installServer(configId: string, userConfigs: LspServerConfig[]): Promise<void> {
    const result = await installServer(configId, userConfigs, this.enrichedPath)
    this.enrichedPath = result.newEnrichedPath
  }

  // ── Status ──────────────────────────────────────────────────────────────────

  getStatuses(projectRoot: string): Array<{ configId: string; languageId: string; status: LspServerStatus; error?: string }> {
    const result: Array<{ configId: string; languageId: string; status: LspServerStatus; error?: string }> = []
    for (const [key, instance] of this.servers) {
      if (key.startsWith(projectRoot + '::')) {
        result.push({ configId: instance.config.id, languageId: instance.config.languageId, status: instance.status, error: undefined })
      }
    }
    return result
  }

  // ── Server lifecycle ───────────────────────────────────────────────────────

  async ensureServer(projectRoot: string, configId: string, userConfigs: LspServerConfig[]): Promise<void> {
    const key = this.serverKey(projectRoot, configId)
    const existing = this.servers.get(key)
    if (existing && existing.status !== 'stopped' && existing.status !== 'error') return

    const configs = resolveConfigs(userConfigs)
    const config = configs.find(c => c.id === configId)
    if (!config) throw new Error(`No LSP config found for id: ${configId}`)

    const binary = findBinary(config.command, this.enrichedPath)
    if (!binary) throw new Error(`LSP binary not found: ${config.command}`)

    await this.startServer(projectRoot, config, binary)
  }

  private async startServer(projectRoot: string, config: LspServerConfig, binary: string): Promise<void> {
    const key = this.serverKey(projectRoot, config.id)
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: this.enrichedPath }

    // Python venv detection
    if (config.id === 'python') {
      for (const venvDir of ['.venv', 'venv']) {
        const venvPath = join(projectRoot, venvDir)
        if (existsSync(join(venvPath, 'pyvenv.cfg'))) {
          env.VIRTUAL_ENV = venvPath
          env.PATH = join(venvPath, 'bin') + ':' + this.enrichedPath
          break
        }
      }
    }

    const proc = spawn(binary, config.args, { cwd: projectRoot, env, stdio: 'pipe' })
    const instance: ServerInstance = {
      process: proc, config, projectRoot, status: 'starting',
      requestId: 1, pending: new Map(), buffer: Buffer.alloc(0),
      initialized: false, openDocuments: new Map(), diagnosticsCache: new Map(),
    }

    this.servers.set(key, instance)
    this.emitStatus(instance)

    proc.stdout?.on('data', (chunk: Buffer) => this.handleData(instance, chunk))
    proc.stderr?.on('data', () => { /* drain stderr silently */ })
    proc.on('exit', () => {
      instance.status = 'stopped'
      if (instance.readyTimer) clearTimeout(instance.readyTimer)
      for (const [, pending] of instance.pending) {
        clearTimeout(pending.timer)
        pending.reject(new Error('LSP server exited'))
      }
      instance.pending.clear()
      this.servers.delete(key)
      this.emitStatus(instance)
    })

    try {
      await this.initialize(instance, projectRoot)
    } catch (e) {
      instance.status = 'error'
      this.emitStatus(instance)
    }
  }

  private async initialize(instance: ServerInstance, projectRoot: string): Promise<void> {
    const rootUri = pathToFileUri(projectRoot)
    const result = await this.sendRequest(instance, 'initialize', {
      processId: process.pid, rootUri,
      capabilities: {
        textDocument: {
          hover: { dynamicRegistration: false, contentFormat: ['markdown', 'plaintext'] },
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: false },
          rename: { dynamicRegistration: false },
          synchronization: { dynamicRegistration: false, didOpen: true, didClose: true, didChange: 1 },
        },
        workspace: { workspaceFolders: true, symbol: { dynamicRegistration: false } },
      },
      workspaceFolders: [{ uri: rootUri, name: basename(projectRoot) }],
    }, 30_000)

    instance.initialized = true
    writeMessage(instance.process, { jsonrpc: '2.0', method: 'initialized', params: {} })

    if (instance.config.id === 'python') {
      writeMessage(instance.process, {
        jsonrpc: '2.0', method: 'workspace/didChangeConfiguration',
        params: { settings: { python: { analysis: { diagnosticMode: 'openFilesOnly' } } } },
      })
    }

    instance.status = 'indexing'
    this.emitStatus(instance)

    instance.readyTimer = setTimeout(() => {
      if (instance.status === 'indexing') {
        instance.status = 'ready'
        this.emitStatus(instance)
      }
    }, 30_000)

    void result
  }

  // ── Message processing ─────────────────────────────────────────────────────

  private handleData(instance: ServerInstance, chunk: Buffer): void {
    instance.buffer = Buffer.concat([instance.buffer, chunk])
    while (true) {
      const headerEnd = instance.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) break
      const header = instance.buffer.slice(0, headerEnd).toString()
      const match = header.match(/Content-Length:\s*(\d+)/i)
      if (!match) { instance.buffer = instance.buffer.slice(headerEnd + 4); break }
      const contentLength = parseInt(match[1], 10)
      const totalLength = headerEnd + 4 + contentLength
      if (instance.buffer.length < totalLength) break
      const body = instance.buffer.slice(headerEnd + 4, totalLength).toString('utf8')
      instance.buffer = instance.buffer.slice(totalLength)
      try {
        this.handleMessage(instance, JSON.parse(body))
      } catch { /* ignore parse errors */ }
    }
  }

  private handleMessage(instance: ServerInstance, msg: Record<string, unknown>): void {
    const id = msg.id as number | undefined
    const method = msg.method as string | undefined

    if (id !== undefined && method !== undefined) {
      writeMessage(instance.process, { jsonrpc: '2.0', id, result: null })
      return
    }
    if (id !== undefined) {
      const pending = instance.pending.get(id)
      if (pending) {
        instance.pending.delete(id)
        clearTimeout(pending.timer)
        if (msg.error) pending.reject(new Error((msg.error as { message: string }).message))
        else pending.resolve(msg.result)
      }
      return
    }
    if (method) this.handleNotification(instance, method, msg.params as Record<string, unknown>)
  }

  private handleNotification(instance: ServerInstance, method: string, params: Record<string, unknown>): void {
    switch (method) {
      case 'textDocument/publishDiagnostics': {
        const uri = params?.uri as string
        const rawDiags = (params?.diagnostics ?? []) as Array<Record<string, unknown>>
        const diagnostics: LspDiagnostic[] = rawDiags.map(d => {
          const r = d.range as Record<string, Record<string, number>>
          return {
            startLine: r.start.line, startCol: r.start.character,
            endLine: r.end.line, endCol: r.end.character,
            message: d.message as string, severity: parseSeverity(d.severity as number),
            code: d.code as string | number | undefined, source: d.source as string | undefined,
          }
        })
        instance.diagnosticsCache.set(uri, diagnostics)
        this.emit('diagnostics', { filePath: fileUriToPath(uri), diagnostics })
        break
      }
      case '$/progress': {
        const value = (params?.value ?? {}) as Record<string, unknown>
        if (value.kind === 'end' && instance.status === 'indexing') {
          if (instance.readyTimer) clearTimeout(instance.readyTimer)
          instance.status = 'ready'
          this.emitStatus(instance)
        }
        break
      }
      default: break
    }
  }

  sendRequest(instance: ServerInstance, method: string, params: unknown, timeout = 10_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = instance.requestId++
      const timer = setTimeout(() => {
        instance.pending.delete(id)
        reject(new Error(`LSP request timed out: ${method}`))
      }, timeout)
      instance.pending.set(id, { resolve, reject, timer })
      writeMessage(instance.process, { jsonrpc: '2.0', id, method, params })
    })
  }

  private emitStatus(instance: ServerInstance): void {
    this.emit('status', {
      configId: instance.config.id, languageId: instance.config.languageId,
      projectRoot: instance.projectRoot, status: instance.status,
    })
  }

  // ── Document sync & LSP operations (delegated to operations.ts) ────���──────

  async openFile(projectRoot: string, filePath: string, content: string, languageId: string): Promise<void> {
    return ops.openFile(projectRoot, filePath, content, languageId, this.servers, this.serverKey.bind(this))
  }

  async closeFile(projectRoot: string, filePath: string): Promise<void> {
    return ops.closeFile(projectRoot, filePath, this.servers, this.serverKey.bind(this))
  }

  async changeFile(projectRoot: string, filePath: string, content: string): Promise<void> {
    return ops.changeFile(projectRoot, filePath, content, this.servers, this.serverKey.bind(this))
  }

  async hover(projectRoot: string, filePath: string, line: number, col: number): Promise<LspHoverResult | null> {
    return ops.hover(projectRoot, filePath, line, col, this.servers, this.serverKey.bind(this), this.sendRequest.bind(this))
  }

  async gotoDefinition(projectRoot: string, filePath: string, line: number, col: number): Promise<LspLocation[] | null> {
    return ops.gotoDefinition(projectRoot, filePath, line, col, this.servers, this.serverKey.bind(this), this.sendRequest.bind(this))
  }

  getDiagnostics(projectRoot: string, filePath: string): LspDiagnostic[] {
    return ops.getDiagnostics(projectRoot, filePath, this.servers, this.serverKey.bind(this))
  }

  async rename(projectRoot: string, filePath: string, line: number, col: number, newName: string): Promise<LspRenameResult | null> {
    return ops.rename(projectRoot, filePath, line, col, newName, this.servers, this.serverKey.bind(this), this.sendRequest.bind(this))
  }

  // ── Shutdown ───────────────────────────────────────────────────────────────

  shutdown(projectRoot: string): void {
    for (const [key, instance] of this.servers) {
      if (key.startsWith(projectRoot + '::')) {
        this.shutdownInstance(instance)
        this.servers.delete(key)
      }
    }
  }

  shutdownAll(): void {
    for (const instance of this.servers.values()) this.shutdownInstance(instance)
    this.servers.clear()
  }

  private shutdownInstance(instance: ServerInstance): void {
    if (instance.readyTimer) clearTimeout(instance.readyTimer)
    for (const [, pending] of instance.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('LSP server shutting down'))
    }
    instance.pending.clear()
    try {
      writeMessage(instance.process, { jsonrpc: '2.0', id: instance.requestId++, method: 'shutdown', params: null })
      writeMessage(instance.process, { jsonrpc: '2.0', method: 'exit', params: null })
    } catch { /* ignore if already dead */ }
    setTimeout(() => {
      try { instance.process.kill('SIGTERM') } catch { /* ignore */ }
    }, 2000)
  }
}
