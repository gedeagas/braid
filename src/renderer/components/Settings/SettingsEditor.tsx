import { useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/store/ui'
import { TERMINAL_SCROLLBACK_MAX_LINES, TERMINAL_SCROLLBACK_MIN_LINES, clampTerminalScrollbackLines } from '@shared/terminal'

interface State {
  shellDraft: string
  scrollbackDraft: string
}

type Action =
  | { type: 'setShell'; value: string }
  | { type: 'setScrollback'; value: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setShell': return { ...state, shellDraft: action.value }
    case 'setScrollback': return { ...state, scrollbackDraft: action.value }
  }
}

export function SettingsEditor() {
  const { t } = useTranslation('settings')
  const terminalFontSize = useUIStore((s) => s.terminalFontSize)
  const setTerminalFontSize = useUIStore((s) => s.setTerminalFontSize)
  const terminalShell = useUIStore((s) => s.terminalShell)
  const setTerminalShell = useUIStore((s) => s.setTerminalShell)
  const terminalScrollback = useUIStore((s) => s.terminalScrollback)
  const setTerminalScrollback = useUIStore((s) => s.setTerminalScrollback)

  const [state, dispatch] = useReducer(reducer, {
    shellDraft: terminalShell,
    scrollbackDraft: String(terminalScrollback),
  })

  return (
    <div className="settings-section">
      <div className="settings-field settings-field--row">
        <label className="settings-label">{t('editor.fontSize')}</label>
        <div className="settings-stepper">
          <button className="btn" onClick={() => setTerminalFontSize(Math.max(8, terminalFontSize - 1))}>−</button>
          <span className="settings-stepper-value">{terminalFontSize}</span>
          <button className="btn" onClick={() => setTerminalFontSize(Math.min(32, terminalFontSize + 1))}>+</button>
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-label">{t('editor.shell')}</label>
        <span className="settings-hint">{t('editor.shellHint')}</span>
        <input
          className="settings-input"
          type="text"
          value={state.shellDraft}
          placeholder="/bin/zsh"
          onChange={(e) => dispatch({ type: 'setShell', value: e.target.value })}
          onBlur={() => setTerminalShell(state.shellDraft)}
        />
      </div>

      <div className="settings-field">
        <label className="settings-label">{t('editor.scrollback')}</label>
        <span className="settings-hint">{t('editor.scrollbackHint')}</span>
        <div className="settings-stepper">
          <button
            className="btn"
            onClick={() => {
              const n = Math.max(TERMINAL_SCROLLBACK_MIN_LINES, terminalScrollback - 1000)
              setTerminalScrollback(n)
              dispatch({ type: 'setScrollback', value: String(n) })
            }}
          >
            −
          </button>
          <input
            className="settings-stepper-input"
            type="text"
            inputMode="numeric"
            value={state.scrollbackDraft}
            onChange={(e) => dispatch({ type: 'setScrollback', value: e.target.value })}
            onBlur={() => {
              const n = parseInt(state.scrollbackDraft, 10)
              if (!isNaN(n)) {
                const clamped = clampTerminalScrollbackLines(n)
                setTerminalScrollback(clamped)
                dispatch({ type: 'setScrollback', value: String(clamped) })
              } else {
                dispatch({ type: 'setScrollback', value: String(terminalScrollback) })
              }
            }}
          />
          <button
            className="btn"
            onClick={() => {
              const n = Math.min(TERMINAL_SCROLLBACK_MAX_LINES, terminalScrollback + 1000)
              setTerminalScrollback(n)
              dispatch({ type: 'setScrollback', value: String(n) })
            }}
          >
            +
          </button>
        </div>
      </div>
    </div>
  )
}
