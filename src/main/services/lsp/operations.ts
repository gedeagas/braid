import { extname } from 'path'
import { pathToFileUri, fileUriToPath, writeMessage } from './helpers'
import { resolveConfigs } from './detect'
import type {
  LspServerConfig, LspDiagnostic, LspHoverResult, LspLocation, LspRenameResult,
  ServerInstance,
} from './types'

type SendRequestFn = (instance: ServerInstance, method: string, params: unknown, timeout?: number) => Promise<unknown>

/** Find the running server instance that handles the given file extension. */
export function findServer(
  projectRoot: string,
  ext: string,
  userConfigs: LspServerConfig[],
  servers: Map<string, ServerInstance>,
  serverKey: (projectRoot: string, configId: string) => string,
): ServerInstance | null {
  const configs = resolveConfigs(userConfigs)
  const config = configs.find(c => c.extensions.includes(ext))
  if (!config) return null
  return servers.get(serverKey(projectRoot, config.id)) ?? null
}

// ── Document sync ──────────────────────────────────────────────────────────

export async function openFile(
  projectRoot: string, filePath: string, content: string, languageId: string,
  servers: Map<string, ServerInstance>, serverKeyFn: (root: string, id: string) => string,
): Promise<void> {
  const ext = extname(filePath).slice(1).toLowerCase()
  const instance = findServer(projectRoot, ext, [], servers, serverKeyFn)
  if (!instance || !instance.initialized) return

  const uri = pathToFileUri(filePath)
  if (instance.openDocuments.has(uri)) return

  instance.openDocuments.set(uri, { version: 1, languageId })
  writeMessage(instance.process, {
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: { textDocument: { uri, languageId, version: 1, text: content } },
  })
}

export async function closeFile(
  projectRoot: string, filePath: string,
  servers: Map<string, ServerInstance>, serverKeyFn: (root: string, id: string) => string,
): Promise<void> {
  const ext = extname(filePath).slice(1).toLowerCase()
  const instance = findServer(projectRoot, ext, [], servers, serverKeyFn)
  if (!instance || !instance.initialized) return

  const uri = pathToFileUri(filePath)
  if (!instance.openDocuments.has(uri)) return

  instance.openDocuments.delete(uri)
  instance.diagnosticsCache.delete(uri)
  writeMessage(instance.process, {
    jsonrpc: '2.0',
    method: 'textDocument/didClose',
    params: { textDocument: { uri } },
  })
}

export async function changeFile(
  projectRoot: string, filePath: string, content: string,
  servers: Map<string, ServerInstance>, serverKeyFn: (root: string, id: string) => string,
): Promise<void> {
  const ext = extname(filePath).slice(1).toLowerCase()
  const instance = findServer(projectRoot, ext, [], servers, serverKeyFn)
  if (!instance || !instance.initialized) return

  const uri = pathToFileUri(filePath)
  const doc = instance.openDocuments.get(uri)
  if (!doc) return

  doc.version++
  writeMessage(instance.process, {
    jsonrpc: '2.0',
    method: 'textDocument/didChange',
    params: {
      textDocument: { uri, version: doc.version },
      contentChanges: [{ text: content }],
    },
  })
}

// ── LSP operations ──────────────────────────────────────────────────────────

export async function hover(
  projectRoot: string, filePath: string, line: number, col: number,
  servers: Map<string, ServerInstance>, serverKeyFn: (root: string, id: string) => string,
  sendRequest: SendRequestFn,
): Promise<LspHoverResult | null> {
  const ext = extname(filePath).slice(1).toLowerCase()
  const instance = findServer(projectRoot, ext, [], servers, serverKeyFn)
  if (!instance || instance.status !== 'ready') return null

  const uri = pathToFileUri(filePath)
  try {
    const result = await sendRequest(instance, 'textDocument/hover', {
      textDocument: { uri },
      position: { line, character: col },
    }) as Record<string, unknown> | null

    if (!result) return null
    const contents = result.contents as string | { value: string } | Array<{ value: string } | string>
    let text = ''
    if (typeof contents === 'string') text = contents
    else if (typeof contents === 'object' && 'value' in contents) text = (contents as { value: string }).value
    else if (Array.isArray(contents)) text = contents.map(c => typeof c === 'string' ? c : c.value).join('\n\n')
    if (!text) return null

    const range = result.range as { start: { line: number; character: number }; end: { line: number; character: number } } | undefined
    return {
      contents: text,
      startLine: range?.start.line ?? line,
      startCol: range?.start.character ?? col,
      endLine: range?.end.line ?? line,
      endCol: range?.end.character ?? col,
    }
  } catch { return null }
}

export async function gotoDefinition(
  projectRoot: string, filePath: string, line: number, col: number,
  servers: Map<string, ServerInstance>, serverKeyFn: (root: string, id: string) => string,
  sendRequest: SendRequestFn,
): Promise<LspLocation[] | null> {
  const ext = extname(filePath).slice(1).toLowerCase()
  const instance = findServer(projectRoot, ext, [], servers, serverKeyFn)
  if (!instance || instance.status !== 'ready') return null

  const uri = pathToFileUri(filePath)
  try {
    const result = await sendRequest(instance, 'textDocument/definition', {
      textDocument: { uri },
      position: { line, character: col },
    }) as Array<Record<string, unknown>> | Record<string, unknown> | null

    if (!result) return null
    const locations = Array.isArray(result) ? result : [result]
    return locations.map(loc => {
      const range = loc.range as { start: { line: number; character: number }; end: { line: number; character: number } }
      const targetUri = loc.uri as string
      return {
        filePath: fileUriToPath(targetUri),
        startLine: range.start.line,
        startCol: range.start.character,
        endLine: range.end.line,
        endCol: range.end.character,
      }
    })
  } catch { return null }
}

export function getDiagnostics(
  projectRoot: string, filePath: string,
  servers: Map<string, ServerInstance>, serverKeyFn: (root: string, id: string) => string,
): LspDiagnostic[] {
  const ext = extname(filePath).slice(1).toLowerCase()
  const instance = findServer(projectRoot, ext, [], servers, serverKeyFn)
  if (!instance) return []

  const uri = pathToFileUri(filePath)
  return instance.diagnosticsCache.get(uri) ?? []
}

export async function rename(
  projectRoot: string, filePath: string, line: number, col: number, newName: string,
  servers: Map<string, ServerInstance>, serverKeyFn: (root: string, id: string) => string,
  sendRequest: SendRequestFn,
): Promise<LspRenameResult | null> {
  const ext = extname(filePath).slice(1).toLowerCase()
  const instance = findServer(projectRoot, ext, [], servers, serverKeyFn)
  if (!instance || instance.status !== 'ready') return null

  const uri = pathToFileUri(filePath)
  try {
    const edit = await sendRequest(instance, 'textDocument/rename', {
      textDocument: { uri },
      position: { line, character: col },
      newName,
    }) as Record<string, unknown> | null

    if (!edit) return null
    const changes = (edit.changes ?? {}) as Record<string, Array<Record<string, unknown>>>
    const edits: LspRenameResult['edits'] = []

    for (const [editUri, fileEdits] of Object.entries(changes)) {
      for (const e of fileEdits) {
        const range = e.range as { start: { line: number; character: number }; end: { line: number; character: number } }
        edits.push({
          filePath: fileUriToPath(editUri),
          startLine: range.start.line,
          startCol: range.start.character,
          endLine: range.end.line,
          endCol: range.end.character,
          newText: e.newText as string,
        })
      }
    }

    return { edits }
  } catch { return null }
}
