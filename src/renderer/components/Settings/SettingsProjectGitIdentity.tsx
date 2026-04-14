import { useReducer, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import * as ipc from '@/lib/ipc'
import { flash } from '@/store/flash'
import { Toggle } from '@/components/shared/Toggle'

interface Props {
  projectPath: string
}

interface State {
  loading: boolean
  enabled: boolean
  name: string
  email: string
  globalName: string
  globalEmail: string
  saving: boolean
  nameError: string | null
  emailError: string | null
  dirty: boolean
}

type Action =
  | { type: 'loadStart' }
  | { type: 'loadDone'; globalName: string; globalEmail: string; localName: string | null; localEmail: string | null }
  | { type: 'setEnabled'; enabled: boolean }
  | { type: 'setName'; name: string }
  | { type: 'setEmail'; email: string }
  | { type: 'setNameError'; error: string | null }
  | { type: 'setEmailError'; error: string | null }
  | { type: 'savingStart' }
  | { type: 'savingDone' }

const INITIAL_STATE: State = {
  loading: true,
  enabled: false,
  name: '',
  email: '',
  globalName: '',
  globalEmail: '',
  saving: false,
  nameError: null,
  emailError: null,
  dirty: false,
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loadStart':
      return { ...INITIAL_STATE, loading: true }
    case 'loadDone': {
      const hasLocal = Boolean(action.localName || action.localEmail)
      return {
        ...state,
        loading: false,
        enabled: hasLocal,
        name: action.localName ?? '',
        email: action.localEmail ?? '',
        globalName: action.globalName,
        globalEmail: action.globalEmail,
        nameError: null,
        emailError: null,
        dirty: false,
      }
    }
    case 'setEnabled':
      return {
        ...state,
        enabled: action.enabled,
        // Pre-fill with global values when first enabling
        name: action.enabled && !state.name ? state.globalName : state.name,
        email: action.enabled && !state.email ? state.globalEmail : state.email,
        nameError: null,
        emailError: null,
        dirty: false,
      }
    case 'setName':
      return { ...state, name: action.name, dirty: true, nameError: null }
    case 'setEmail':
      return { ...state, email: action.email, dirty: true, emailError: null }
    case 'setNameError':
      return { ...state, nameError: action.error }
    case 'setEmailError':
      return { ...state, emailError: action.error }
    case 'savingStart':
      return { ...state, saving: true }
    case 'savingDone':
      return { ...state, saving: false, dirty: false }
    default:
      return state
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateName(name: string): string | null {
  if (!name.trim()) return 'nameRequired'
  if (name.length > 100) return 'nameTooLong'
  return null
}

function validateEmail(email: string): string | null {
  if (!email.trim()) return 'emailRequired'
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email.trim())) return 'emailInvalid'
  return null
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SettingsProjectGitIdentity({ projectPath }: Props) {
  const { t } = useTranslation('settings')
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)

  // Load current git config on mount or when projectPath changes
  useEffect(() => {
    if (!projectPath) return
    dispatch({ type: 'loadStart' })
    ipc.git
      .getGitUserConfig(projectPath)
      .then(({ global: g, local }) => {
        dispatch({
          type: 'loadDone',
          globalName: g.name,
          globalEmail: g.email,
          localName: local.name,
          localEmail: local.email,
        })
      })
      .catch(() => dispatch({ type: 'loadDone', globalName: '', globalEmail: '', localName: null, localEmail: null }))
  }, [projectPath])

  const handleToggle = useCallback(
    async (enabled: boolean) => {
      dispatch({ type: 'setEnabled', enabled })
      if (!enabled) {
        try {
          await ipc.git.clearGitUserConfig(projectPath)
        } catch (err) {
          // Roll back — local config wasn't actually cleared
          console.error('[git-identity] clearGitUserConfig failed:', err)
          dispatch({ type: 'setEnabled', enabled: true })
          flash('error', t('project.gitIdentity.clearError'))
        }
      }
    },
    [projectPath, t]
  )

  const handleNameBlur = useCallback(() => {
    const err = validateName(state.name)
    dispatch({ type: 'setNameError', error: err ? t(`project.gitIdentity.${err}`) : null })
  }, [state.name, t])

  const handleEmailBlur = useCallback(() => {
    const err = validateEmail(state.email)
    dispatch({ type: 'setEmailError', error: err ? t(`project.gitIdentity.${err}`) : null })
  }, [state.email, t])

  const handleSave = useCallback(async () => {
    const nameErr = validateName(state.name)
    const emailErr = validateEmail(state.email)

    dispatch({ type: 'setNameError', error: nameErr ? t(`project.gitIdentity.${nameErr}`) : null })
    dispatch({ type: 'setEmailError', error: emailErr ? t(`project.gitIdentity.${emailErr}`) : null })

    if (nameErr || emailErr) return

    dispatch({ type: 'savingStart' })
    try {
      await ipc.git.setGitUserConfig(projectPath, state.name.trim(), state.email.trim())
      dispatch({ type: 'savingDone' })
      flash('success', t('project.gitIdentity.savedSuccess'))
    } catch {
      dispatch({ type: 'savingDone' })
      flash('error', t('project.gitIdentity.saveError'))
    }
  }, [projectPath, state.name, state.email, t])

  const canSave = state.enabled && state.dirty && !state.saving && !state.nameError && !state.emailError

  return (
    <div className="settings-card">
      <h3 className="settings-card-title">{t('project.gitIdentity.title')}</h3>

      <div className="settings-field">
        <div className="settings-git-identity-toggle-row">
          <div>
            <div className="settings-label">{t('project.gitIdentity.overrideToggle')}</div>
            <span className="settings-hint">{t('project.gitIdentity.overrideHint')}</span>
          </div>
          <Toggle checked={state.enabled} disabled={state.loading} onChange={handleToggle} />
        </div>
      </div>

      {state.enabled && (
        <>
          <div className="settings-field">
            <label className="settings-label">{t('project.gitIdentity.nameLabel')}</label>
            <input
              className={`settings-input${state.nameError ? ' settings-input--error' : ''}`}
              type="text"
              value={state.name}
              placeholder={state.globalName || 'Your Name'}
              onChange={(e) => dispatch({ type: 'setName', name: e.target.value })}
              onBlur={handleNameBlur}
              disabled={state.saving}
            />
            {state.nameError ? (
              <span className="settings-git-identity-error">{state.nameError}</span>
            ) : state.globalName ? (
              <span className="settings-hint">{t('project.gitIdentity.globalFallback', { value: state.globalName })}</span>
            ) : null}
          </div>

          <div className="settings-field">
            <label className="settings-label">{t('project.gitIdentity.emailLabel')}</label>
            <input
              className={`settings-input${state.emailError ? ' settings-input--error' : ''}`}
              type="email"
              value={state.email}
              placeholder={state.globalEmail || 'you@example.com'}
              onChange={(e) => dispatch({ type: 'setEmail', email: e.target.value })}
              onBlur={handleEmailBlur}
              disabled={state.saving}
            />
            {state.emailError ? (
              <span className="settings-git-identity-error">{state.emailError}</span>
            ) : state.globalEmail ? (
              <span className="settings-hint">{t('project.gitIdentity.globalFallback', { value: state.globalEmail })}</span>
            ) : null}
          </div>

          <div className="settings-field">
            <button
              className="settings-git-identity-save-btn"
              onClick={handleSave}
              disabled={!canSave}
            >
              {t('project.gitIdentity.saveButton')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
