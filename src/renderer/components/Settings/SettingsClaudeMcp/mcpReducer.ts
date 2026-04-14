import type { McpServerEntry, McpServerConfig, McpStdioConfig, McpSseConfig, McpHttpConfig, McpHealthResult, McpHealthStatus } from '@/types'

// ── Types ────────────────────────────────────────────────────────────────────

export type ServerType = 'stdio' | 'sse' | 'http'

export interface KvPair { key: string; value: string }

export interface FormState {
  name: string
  type: ServerType
  command: string
  args: string
  envPairs: KvPair[]
  url: string
  headerPairs: KvPair[]
  npmPackage: string
  nameError: string
  urlError: string
  commandError: string
}

export interface State {
  servers: McpServerEntry[]
  projectServers: McpServerEntry[]
  pluginServers: McpServerEntry[]
  loading: boolean
  editingName: string | null   // null = not editing; '' = new server form open
  form: FormState
  pendingDeleteName: string | null
  saving: boolean
  health: Record<string, { status: McpHealthStatus; error?: string }>
  healthChecking: boolean
  /** Name of server currently being authenticated via OAuth, or null */
  authenticatingServer: string | null
}

export type Action =
  | { type: 'setServers'; servers: McpServerEntry[] }
  | { type: 'setProjectServers'; servers: McpServerEntry[] }
  | { type: 'setPluginServers'; servers: McpServerEntry[] }
  | { type: 'setLoading'; loading: boolean }
  | { type: 'openNew' }
  | { type: 'openEdit'; server: McpServerEntry }
  | { type: 'closeForm' }
  | { type: 'setFormField'; field: keyof FormState; value: unknown }
  | { type: 'setEnvPair'; index: number; key: string; value: string }
  | { type: 'addEnvPair' }
  | { type: 'removeEnvPair'; index: number }
  | { type: 'setHeaderPair'; index: number; key: string; value: string }
  | { type: 'addHeaderPair' }
  | { type: 'removeHeaderPair'; index: number }
  | { type: 'fillNpm' }
  | { type: 'toggleServer'; name: string }
  | { type: 'confirmDelete'; name: string }
  | { type: 'cancelDelete' }
  | { type: 'deleteServer'; name: string }
  | { type: 'setSaving'; saving: boolean }
  | { type: 'saveServer' }
  | { type: 'setHealthChecking'; checking: boolean }
  | { type: 'setHealthResults'; results: McpHealthResult[] }
  | { type: 'startAuth'; name: string }
  | { type: 'authComplete'; name: string }
  | { type: 'authFailed'; name: string; error: string }

// ── Helpers ──────────────────────────────────────────────────────────────────

export function emptyForm(): FormState {
  return {
    name: '', type: 'stdio', command: '', args: '', envPairs: [],
    url: '', headerPairs: [], npmPackage: '', nameError: '', urlError: '', commandError: '',
  }
}

export function serverToForm(server: McpServerEntry): FormState {
  const cfg = server.config
  if (cfg.type === 'sse' || cfg.type === 'http') {
    return {
      ...emptyForm(),
      name: server.name,
      type: cfg.type,
      url: cfg.url,
      headerPairs: Object.entries(cfg.headers ?? {}).map(([key, value]) => ({ key, value })),
    }
  }
  const stdio = cfg as McpStdioConfig
  return {
    ...emptyForm(),
    name: server.name,
    type: 'stdio',
    command: stdio.command,
    args: (stdio.args ?? []).join(' '),
    envPairs: Object.entries(stdio.env ?? {}).map(([key, value]) => ({ key, value })),
  }
}

export function formToConfig(form: FormState): McpServerConfig {
  if (form.type === 'sse' || form.type === 'http') {
    const headers = form.headerPairs
      .filter((p) => p.key.trim())
      .reduce<Record<string, string>>((acc, p) => { acc[p.key.trim()] = p.value; return acc }, {})
    return form.type === 'sse'
      ? { type: 'sse', url: form.url.trim(), headers } satisfies McpSseConfig
      : { type: 'http', url: form.url.trim(), headers } satisfies McpHttpConfig
  }
  const args = form.args.trim() ? form.args.trim().split(/\s+/) : []
  const env = form.envPairs
    .filter((p) => p.key.trim())
    .reduce<Record<string, string>>((acc, p) => { acc[p.key.trim()] = p.value; return acc }, {})
  return { type: 'stdio', command: form.command.trim(), args, env } satisfies McpStdioConfig
}

export function validateForm(form: FormState, servers: McpServerEntry[], editingName: string | null): FormState {
  let nameError = ''
  let urlError = ''
  let commandError = ''

  if (!form.name.trim()) nameError = 'Name is required'
  else if (!/^[a-zA-Z0-9_-]+$/.test(form.name.trim())) nameError = 'Only letters, numbers, - and _ allowed'
  else if (editingName === '' && servers.some((s) => s.name === form.name.trim())) nameError = 'Name already in use'

  if (form.type === 'stdio' && !form.command.trim()) commandError = 'Command is required'
  if ((form.type === 'sse' || form.type === 'http') && !form.url.trim()) urlError = 'URL is required'

  return { ...form, nameError, urlError, commandError }
}

// ── Reducer ──────────────────────────────────────────────────────────────────

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setServers':
      return { ...state, servers: action.servers }
    case 'setProjectServers':
      return { ...state, projectServers: action.servers }
    case 'setPluginServers':
      return { ...state, pluginServers: action.servers }
    case 'setLoading':
      return { ...state, loading: action.loading }
    case 'openNew':
      return { ...state, editingName: '', form: emptyForm(), pendingDeleteName: null }
    case 'openEdit':
      return { ...state, editingName: action.server.name, form: serverToForm(action.server), pendingDeleteName: null }
    case 'closeForm':
      return { ...state, editingName: null, form: emptyForm() }
    case 'setFormField':
      return { ...state, form: { ...state.form, [action.field]: action.value } }
    case 'setEnvPair': {
      const envPairs = state.form.envPairs.map((p, i) =>
        i === action.index ? { key: action.key, value: action.value } : p
      )
      return { ...state, form: { ...state.form, envPairs } }
    }
    case 'addEnvPair':
      return { ...state, form: { ...state.form, envPairs: [...state.form.envPairs, { key: '', value: '' }] } }
    case 'removeEnvPair':
      return { ...state, form: { ...state.form, envPairs: state.form.envPairs.filter((_, i) => i !== action.index) } }
    case 'setHeaderPair': {
      const headerPairs = state.form.headerPairs.map((p, i) =>
        i === action.index ? { key: action.key, value: action.value } : p
      )
      return { ...state, form: { ...state.form, headerPairs } }
    }
    case 'addHeaderPair':
      return { ...state, form: { ...state.form, headerPairs: [...state.form.headerPairs, { key: '', value: '' }] } }
    case 'removeHeaderPair':
      return { ...state, form: { ...state.form, headerPairs: state.form.headerPairs.filter((_, i) => i !== action.index) } }
    case 'fillNpm': {
      const pkg = state.form.npmPackage.trim()
      if (!pkg) return state
      return {
        ...state,
        form: { ...state.form, command: 'npx', args: `-y ${pkg}`, npmPackage: '' },
      }
    }
    case 'toggleServer': {
      const servers = state.servers.map((s) =>
        s.name === action.name ? { ...s, enabled: !s.enabled } : s
      )
      return { ...state, servers }
    }
    case 'confirmDelete':
      return { ...state, pendingDeleteName: action.name }
    case 'cancelDelete':
      return { ...state, pendingDeleteName: null }
    case 'deleteServer':
      return { ...state, servers: state.servers.filter((s) => s.name !== action.name), pendingDeleteName: null }
    case 'setSaving':
      return { ...state, saving: action.saving }
    case 'setHealthChecking':
      return { ...state, healthChecking: action.checking }
    case 'setHealthResults': {
      const health: Record<string, { status: McpHealthStatus; error?: string }> = {}
      for (const r of action.results) {
        health[r.name] = { status: r.status, error: r.error }
      }
      return { ...state, health, healthChecking: false }
    }
    case 'startAuth':
      return { ...state, authenticatingServer: action.name }
    case 'authComplete': {
      const health = { ...state.health }
      health[action.name] = { status: 'ok' }
      return { ...state, authenticatingServer: null, health }
    }
    case 'authFailed': {
      const health = { ...state.health }
      health[action.name] = { status: 'auth_required', error: action.error }
      return { ...state, authenticatingServer: null, health }
    }
    case 'saveServer': {
      const validated = validateForm(state.form, state.servers, state.editingName)
      if (validated.nameError || validated.commandError || validated.urlError) {
        return { ...state, form: validated }
      }
      const entry: McpServerEntry = {
        name: validated.name.trim(),
        enabled: true,
        config: formToConfig(validated),
      }
      let servers: McpServerEntry[]
      if (state.editingName === '') {
        servers = [...state.servers, entry]
      } else {
        servers = state.servers.map((s) => s.name === state.editingName ? entry : s)
      }
      return { ...state, servers, editingName: null, form: emptyForm() }
    }
    default:
      return state
  }
}
