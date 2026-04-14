import { useEffect, useRef, useState, useCallback } from 'react'
import type { Monaco } from '@monaco-editor/react'
import type { editor as EditorNS } from 'monaco-editor'
import * as ipc from '@/lib/ipc'
import type { LspServerHandle, LspDiagnostic, LspDetectedServer } from '@/types'

interface Props {
  monacoInstance: Monaco | null
  editorRef: React.MutableRefObject<EditorNS.IStandaloneCodeEditor | null>
  filePath: string | null
  projectRoot: string | null
  languageId: string
  content: string
}

interface Return {
  statuses: LspServerHandle[]
  uninstalledServers: LspDetectedServer[]
  retryInstall: () => void
}

const CHANGE_DEBOUNCE_MS = 300

export function useLspProviders({ monacoInstance, editorRef, filePath, projectRoot, languageId, content }: Props): Return {
  const [uninstalledServers, setUninstalledServers] = useState<LspDetectedServer[]>([])
  const [retryCount, setRetryCount] = useState(0)
  const retryInstall = useCallback(() => setRetryCount(c => c + 1), [])
  const providersRegistered = useRef(false)
  const prevFilePath = useRef<string | null>(null)
  const prevLspRoot = useRef<string | null>(null)
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // ── Status tracking ──────────────────────────────────────────────────────────
  const [statuses, setStatuses] = useState<LspServerHandle[]>([])
  // Per-file resolved LSP root (nearest ancestor with go.mod / tsconfig.json etc.)
  // Stored in a ref so hover/definition providers (registered once) always read fresh.
  const lspRootRef = useRef<string | null>(null)

  useEffect(() => {
    const cleanup = ipc.lsp.onStatusUpdate((update) => {
      setStatuses(prev => {
        const entry: LspServerHandle = {
          configId: update.configId,
          languageId: update.languageId,
          projectRoot: update.projectRoot,
          status: update.status,
          error: update.error,
        }
        const idx = prev.findIndex(
          s => s.configId === update.configId && s.projectRoot === update.projectRoot
        )
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = entry
          return next
        }
        return [...prev, entry]
      })
    })
    return cleanup
  }, [])

  // ── Diagnostics push → Monaco markers ───────────────────────────────────────
  useEffect(() => {
    const cleanup = ipc.lsp.onDiagnosticsUpdate((update) => {
      if (!monacoInstance || !editorRef.current) return
      if (update.filePath !== filePath) return

      const model = editorRef.current.getModel()
      if (!model) return

      applyDiagnostics(monacoInstance, model, update.diagnostics)
    })
    return cleanup
  }, [monacoInstance, editorRef, filePath])

  // ── Monaco provider registration (once per monacoInstance) ──────────────────
  useEffect(() => {
    if (!monacoInstance || providersRegistered.current) return
    providersRegistered.current = true

    // Hover provider — uses lspRootRef so it always has the current file's module root
    monacoInstance.languages.registerHoverProvider('*', {
      async provideHover(model, position) {
        const fp = uriToFsPath(model.uri.toString())
        const pr = lspRootRef.current
        if (!pr || !fp) return null

        try {
          const result = await ipc.lsp.hover(pr, fp, position.lineNumber - 1, position.column - 1)
          if (!result) return null
          return {
            range: new monacoInstance.Range(
              result.startLine + 1, result.startCol + 1,
              result.endLine + 1, result.endCol + 1
            ),
            contents: [{ value: result.contents, isTrusted: true, supportThemeIcons: true }],
          }
        } catch { return null }
      },
    })

    // Definition provider — same lspRootRef pattern
    monacoInstance.languages.registerDefinitionProvider('*', {
      async provideDefinition(model, position) {
        const fp = uriToFsPath(model.uri.toString())
        const pr = lspRootRef.current
        if (!pr || !fp) return null

        try {
          const locations = await ipc.lsp.definition(pr, fp, position.lineNumber - 1, position.column - 1)
          if (!locations || locations.length === 0) return null

          return locations.map(loc => ({
            uri: monacoInstance.Uri.file(loc.filePath),
            range: {
              startLineNumber: loc.startLine + 1,
              startColumn: loc.startCol + 1,
              endLineNumber: loc.endLine + 1,
              endColumn: loc.endCol + 1,
            },
          }))
        } catch { return null }
      },
    })
  }, [monacoInstance]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle definition navigation: open the target file when Monaco resolves a definition
  useEffect(() => {
    if (!monacoInstance || !editorRef.current) return
    const editor = editorRef.current

    const disposable = editor.onDidChangeCursorPosition((_e) => {
      // Monaco handles definition navigation internally via F12 / CMD+click.
      // The registerDefinitionProvider callback already returns proper URIs.
    })

    return () => disposable.dispose()
  }, [monacoInstance, editorRef])

  // ── didOpen / didClose on filePath change ────────────────────────────────────
  useEffect(() => {
    const prevPath = prevFilePath.current
    const prevRoot = prevLspRoot.current   // use the resolved root for the file being closed

    // Close previous file at its resolved LSP root
    if (prevPath && prevRoot) {
      ipc.lsp.closeFile(prevRoot, prevPath).catch(() => {})
    }

    prevFilePath.current = filePath

    if (!filePath || !projectRoot) {
      lspRootRef.current = null
      prevLspRoot.current = null
      return
    }

    // Default until detectServersForFile resolves — ensures prevLspRoot is always
    // set even when all servers are uninstalled (so the next file open closes correctly).
    lspRootRef.current = projectRoot
    prevLspRoot.current = projectRoot

    // Walk up from the file to find the nearest module root per language server.
    // Handles monorepos where go.mod / tsconfig.json live in subdirectories.
    ipc.lsp.detectServersForFile(filePath, projectRoot).then(detected => {
      setUninstalledServers(detected.filter(d => !d.installed))

      for (const { config, resolvedRoot } of detected.filter(d => d.installed)) {
        const root = resolvedRoot ?? projectRoot
        lspRootRef.current = root
        prevLspRoot.current = root

        // startServer IPC awaits the full LSP handshake — openFile and initial
        // diagnostics must be chained AFTER it resolves, not fired in parallel.
        // The server is keyed by resolvedRoot, so all calls must use that root.
        ipc.lsp.startServer(root, config.id, [])
          .then(() => ipc.lsp.openFile(root, filePath, content, languageId))
          .then(() => ipc.lsp.getDiagnostics(root, filePath))
          .then(diagnostics => {
            if (!monacoInstance || !editorRef.current) return
            const model = editorRef.current.getModel()
            if (model) applyDiagnostics(monacoInstance, model, diagnostics)
          })
          .catch(() => {})
      }
    }).catch(() => {})

    return () => {
      // close handled at next effect run
    }
  }, [filePath, projectRoot, retryCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── didChange on content change (debounced) ──────────────────────────────────
  useEffect(() => {
    if (!filePath || !projectRoot) return
    if (changeTimer.current) clearTimeout(changeTimer.current)

    changeTimer.current = setTimeout(() => {
      const root = lspRootRef.current ?? projectRoot
      ipc.lsp.changeFile(root, filePath, content).then(() => {
        return ipc.lsp.getDiagnostics(root, filePath)
      }).then(diagnostics => {
        if (!monacoInstance || !editorRef.current) return
        const model = editorRef.current.getModel()
        if (model) applyDiagnostics(monacoInstance, model, diagnostics)
      }).catch(() => {})
    }, CHANGE_DEBOUNCE_MS)

    return () => {
      if (changeTimer.current) clearTimeout(changeTimer.current)
    }
  }, [content, filePath, projectRoot, monacoInstance, editorRef])

  // ── Cleanup on unmount ───────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (prevFilePath.current && prevLspRoot.current) {
        ipc.lsp.closeFile(prevLspRoot.current, prevFilePath.current).catch(() => {})
      }
      if (changeTimer.current) clearTimeout(changeTimer.current)
    }
  }, [])

  return { statuses, uninstalledServers, retryInstall }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function uriToFsPath(uri: string): string | null {
  if (!uri.startsWith('file://')) return null
  return decodeURIComponent(uri.replace(/^file:\/\//, ''))
}

function applyDiagnostics(
  monaco: Monaco,
  model: EditorNS.ITextModel,
  diagnostics: LspDiagnostic[]
): void {
  monaco.editor.setModelMarkers(model, 'lsp', diagnostics.map(d => ({
    startLineNumber: d.startLine + 1,
    startColumn: d.startCol + 1,
    endLineNumber: d.endLine + 1,
    endColumn: d.endCol + 1,
    message: d.message,
    severity: d.severity,
    code: d.code?.toString(),
    source: d.source,
  })))
}
