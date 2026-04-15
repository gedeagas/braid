import { useReducer, useEffect, useRef, useCallback } from 'react'
import Editor, { useMonaco, type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useShallow } from 'zustand/react/shallow'
import { Tooltip } from '@/components/shared/Tooltip'
import { StreamingMarkdown } from '@/components/Center/StreamingMarkdown'
import { IconEye } from '@/components/shared/icons'
import { OpenInDropdown } from '@/components/shared/OpenInDropdown'
import * as ipc from '@/lib/ipc'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { builtinThemes } from '@/themes/palettes'
import { buildMonacoTheme } from '@/themes/monaco'
import { MONACO_THEME_NAME } from '@/lib/appBrand'
import { EmptyState } from '@/components/ui'
import { useLspProviders } from '@/hooks/useLspProviders'
import { LspStatusBadge } from './LspStatusBadge'
import { LspInstallNudge } from './LspInstallNudge'
import { DiagnosticsPanel } from './DiagnosticsPanel'
import { BinaryImagePreview, BinaryPlaceholder } from './BinaryFilePreview'
import { isBinaryFile, isImageFile } from '@/lib/binaryFile'

interface Props {
  filePath: string | null
  /** Absolute path to the project root (git repo root) — enables LSP */
  projectRoot?: string | null
  onDirtyChange?: (filePath: string, isDirty: boolean) => void
}

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescriptreact',
  js: 'javascript', jsx: 'javascriptreact',
  json: 'json', md: 'markdown', css: 'css', scss: 'scss',
  html: 'html', yml: 'yaml', yaml: 'yaml', py: 'python',
  rs: 'rust', go: 'go', swift: 'swift', kt: 'kotlin', kts: 'kotlin',
  java: 'java', m: 'objective-c', mm: 'objective-c', php: 'php',
  sh: 'shell', bash: 'shell', zsh: 'shell', toml: 'ini',
  xml: 'xml', svg: 'xml', sql: 'sql', graphql: 'graphql',
  proto: 'protobuf', dockerfile: 'dockerfile',
}

function getLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const name = path.split('/').pop()?.toLowerCase() ?? ''
  if (name === 'dockerfile') return 'dockerfile'
  return EXT_TO_LANG[ext] ?? 'plaintext'
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

interface State {
  savedContent: string
  currentContent: string
  loading: boolean
  saving: boolean
  saveError: string | null
  isDirty: boolean
  diagnosticsOpen: boolean
  markerCount: number
  showPreview: boolean
}

type Action =
  | { type: 'loadStart' }
  | { type: 'loadDone'; content: string }
  | { type: 'loadFail' }
  | { type: 'change'; content: string; savedContent: string }
  | { type: 'saveStart' }
  | { type: 'saveDone'; content: string }
  | { type: 'saveFail'; error: string }
  | { type: 'setMarkerCount'; count: number }
  | { type: 'toggleDiagnostics' }
  | { type: 'togglePreview' }
  | { type: 'clearError' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loadStart':
      return { ...state, loading: true, isDirty: false, saveError: null, diagnosticsOpen: false, markerCount: 0 }
    case 'loadDone':
      return { ...state, loading: false, savedContent: action.content, currentContent: action.content }
    case 'loadFail':
      return { ...state, loading: false, savedContent: '// Failed to read file', currentContent: '// Failed to read file' }
    case 'change':
      return { ...state, currentContent: action.content, isDirty: action.content !== action.savedContent }
    case 'saveStart':
      return { ...state, saving: true, saveError: null }
    case 'saveDone':
      return { ...state, saving: false, savedContent: action.content, isDirty: false }
    case 'saveFail':
      return { ...state, saving: false, saveError: action.error }
    case 'setMarkerCount':
      return { ...state, markerCount: action.count }
    case 'toggleDiagnostics':
      return { ...state, diagnosticsOpen: !state.diagnosticsOpen }
    case 'togglePreview':
      return { ...state, showPreview: !state.showPreview }
    case 'clearError':
      return { ...state, saveError: null }
    default:
      return state
  }
}

const INITIAL_STATE: State = {
  savedContent: '',
  currentContent: '',
  loading: false,
  saving: false,
  saveError: null,
  isDirty: false,
  diagnosticsOpen: false,
  markerCount: 0,
  showPreview: false,
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FileViewer({ filePath, projectRoot = null, onDirtyChange }: Props) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const handleSaveRef = useRef<() => void>(() => {})
  const markersRef = useRef<editor.IMarker[]>([])
  const { t } = useTranslation('right')

  // Theme
  const monacoInstance = useMonaco()
  const { activeThemeId, customThemes } = useUIStore(
    useShallow((s) => ({ activeThemeId: s.activeThemeId, customThemes: s.customThemes }))
  )
  const activePalette =
    [...builtinThemes, ...customThemes].find((p) => p.id === activeThemeId) ?? builtinThemes[0]

  useEffect(() => {
    if (!monacoInstance) return
    monacoInstance.editor.defineTheme(MONACO_THEME_NAME, buildMonacoTheme(activePalette))
    monacoInstance.editor.setTheme(MONACO_THEME_NAME)
  }, [monacoInstance, activePalette])

  // Disable Monaco's built-in semantic validation for TS/JS — LSP provides
  // proper diagnostics with full project context (tsconfig paths, node_modules).
  // Monaco's in-browser checker doesn't know about path aliases like "@/"
  // and would produce false "Cannot find module" errors on every such import.
  // Syntax validation is kept since it needs no module resolution.
  useEffect(() => {
    if (!monacoInstance) return
    const noSemantic = { noSemanticValidation: true, noSyntaxValidation: false }
    monacoInstance.languages.typescript.typescriptDefaults.setDiagnosticsOptions(noSemantic)
    monacoInstance.languages.typescript.javascriptDefaults.setDiagnosticsOptions(noSemantic)
  }, [monacoInstance])

  // LSP integration
  const languageId = filePath ? getLanguage(filePath) : 'plaintext'
  const { statuses, uninstalledServers, retryInstall } = useLspProviders({
    monacoInstance,
    editorRef,
    filePath,
    projectRoot: projectRoot ?? null,
    languageId,
    content: state.currentContent,
  })

  // Track Monaco markers to update diagnostic count + panel
  useEffect(() => {
    if (!monacoInstance || !editorRef.current) return
    const model = editorRef.current.getModel()
    if (!model) return

    const updateMarkers = () => {
      const markers = monacoInstance.editor.getModelMarkers({ resource: model.uri })
      markersRef.current = markers
      dispatch({ type: 'setMarkerCount', count: markers.length })
    }

    const disposable = monacoInstance.editor.onDidChangeMarkers(() => updateMarkers())
    updateMarkers()
    return () => disposable.dispose()
  }, [monacoInstance, filePath])

  // Load file content whenever filePath changes
  useEffect(() => {
    if (!filePath) return
    // Binary files are handled by a dedicated viewer, skip Monaco loading
    if (isBinaryFile(filePath)) {
      dispatch({ type: 'loadDone', content: '' })
      return
    }
    dispatch({ type: 'loadStart' })
    ipc.git
      .readFile(filePath)
      .then((text: string) => {
        dispatch({ type: 'loadDone', content: text })
        editorRef.current?.setValue(text)
      })
      .catch(() => dispatch({ type: 'loadFail' }))
  }, [filePath])

  // Notify parent of dirty state changes
  useEffect(() => {
    if (filePath) onDirtyChange?.(filePath, state.isDirty)
  }, [state.isDirty, filePath, onDirtyChange])

  const handleSave = useCallback(async () => {
    if (!filePath || state.saving) return
    const currentValue = editorRef.current?.getValue() ?? ''
    if (currentValue === state.savedContent) return
    dispatch({ type: 'saveStart' })
    try {
      await ipc.git.writeFile(filePath, currentValue)
      dispatch({ type: 'saveDone', content: currentValue })
    } catch {
      dispatch({ type: 'saveFail', error: t('fileSaveError') })
    }
  }, [filePath, state.saving, state.savedContent, t])

  useEffect(() => { handleSaveRef.current = handleSave }, [handleSave])

  // Listen for save events dispatched via Electron menu shortcut (⌘S)
  useEffect(() => {
    const handler = () => handleSaveRef.current()
    window.addEventListener('braid:saveFile', handler)
    return () => window.removeEventListener('braid:saveFile', handler)
  }, [])

  const handleEditorMount: OnMount = useCallback((editorInstance, monaco) => {
    editorRef.current = editorInstance
    editorInstance.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => handleSaveRef.current()
    )
  }, [])

  const handleChange = useCallback((value: string | undefined) => {
    dispatch({ type: 'change', content: value ?? '', savedContent: state.savedContent })
  }, [state.savedContent])

  const handleJumpToDiagnostic = useCallback((line: number, col: number) => {
    if (!editorRef.current) return
    editorRef.current.revealLineInCenter(line)
    editorRef.current.setPosition({ lineNumber: line, column: col })
    editorRef.current.focus()
  }, [])

  if (!filePath) {
    return <EmptyState title={t('fileViewerEmpty')} />
  }

  if (state.loading) {
    return <EmptyState title={t('loading')} />
  }

  const fileName = filePath.split('/').slice(-2).join('/')
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const isMarkdown = ext === 'md' || ext === 'mdx'
  const isBinary = isBinaryFile(filePath)

  // Binary file rendering (images, fonts, etc.)
  if (isBinary) {
    return (
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="file-viewer-toolbar">
          <span className="file-viewer-path">{fileName}</span>
          <OpenInDropdown path={filePath} />
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {isImageFile(filePath) ? (
            <BinaryImagePreview filePath={filePath} />
          ) : (
            <BinaryPlaceholder filePath={filePath} />
          )}
        </div>
      </div>
    )
  }

  const errorCount = markersRef.current.filter(m => m.severity === 8).length
  const warnCount = markersRef.current.filter(m => m.severity === 4).length

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div className="file-viewer-toolbar">
        <span className="file-viewer-path">
          {state.isDirty && <span className="file-viewer-dirty">●</span>}
          {fileName}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* LSP status badge (running server) */}
          <LspStatusBadge statuses={statuses} languageId={languageId} />

          {/* Install nudge (server not on PATH) */}
          {projectRoot && uninstalledServers
            .filter(s => s.config.extensions.includes(filePath?.split('.').pop()?.toLowerCase() ?? ''))
            .map(server => (
              <LspInstallNudge
                key={server.config.id}
                server={server}
                projectRoot={projectRoot}
                onInstalled={retryInstall}
              />
            ))}

          {/* Diagnostics toggle button */}
          {state.markerCount > 0 && (
            <button
              className={`file-viewer-save-btn ${state.diagnosticsOpen ? 'active' : ''}`}
              onClick={() => dispatch({ type: 'toggleDiagnostics' })}
              title={`${errorCount} errors, ${warnCount} warnings`}
            >
              {errorCount > 0 && <span style={{ color: 'var(--red)' }}>{errorCount}✕</span>}
              {warnCount > 0 && <span style={{ color: 'var(--yellow, #e3b341)', marginLeft: errorCount > 0 ? 4 : 0 }}>{warnCount}⚠</span>}
            </button>
          )}

          {state.saveError && (
            <span style={{ fontSize: 13, color: 'var(--red)' }}>{state.saveError}</span>
          )}
          {isMarkdown && (
            <button
              className={`file-viewer-save-btn ${state.showPreview ? 'active' : ''}`}
              onClick={() => dispatch({ type: 'togglePreview' })}
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <IconEye size={13} />
              {state.showPreview ? t('filePreviewHide') : t('filePreviewShow')}
            </button>
          )}
          <OpenInDropdown path={filePath} />
          <Tooltip content={t('fileSaveTooltip')} shortcut={t('fileSaveShortcut')}>
            <button
              className={`file-viewer-save-btn ${state.isDirty ? 'active' : ''}`}
              onClick={handleSave}
              disabled={!state.isDirty || state.saving}
            >
              {state.saving ? t('fileSaving') : t('fileSave')}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Editor / Preview */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {isMarkdown && state.showPreview ? (
          <div className="md-preview">
            <StreamingMarkdown content={state.currentContent} enableAnimation={false} />
          </div>
        ) : (
          <Editor
            height="100%"
            language={languageId}
            defaultValue={state.savedContent}
            theme={MONACO_THEME_NAME}
            onMount={handleEditorMount}
            onChange={handleChange}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              renderWhitespace: 'selection',
              wordWrap: 'on',
              padding: { top: 10 },
              tabSize: 2,
            }}
          />
        )}
      </div>

      {/* Diagnostics panel */}
      {state.diagnosticsOpen && state.markerCount > 0 && (
        <DiagnosticsPanel
          markers={markersRef.current}
          onJump={handleJumpToDiagnostic}
        />
      )}
    </div>
  )
}
