import { useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, Button, Checkbox } from '@/components/ui'

type PullStrategy = 'rebase' | 'merge'

interface Props {
  onConfirm: (strategy: PullStrategy, remember: boolean) => void
  onCancel: () => void
}

interface State {
  strategy: PullStrategy
  remember: boolean
}

type Action =
  | { type: 'setStrategy'; value: PullStrategy }
  | { type: 'toggleRemember' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setStrategy': return { ...state, strategy: action.value }
    case 'toggleRemember': return { ...state, remember: !state.remember }
  }
}

export function PullStrategyDialog({ onConfirm, onCancel }: Props) {
  const { t } = useTranslation('right')
  const [state, dispatch] = useReducer(reducer, { strategy: 'rebase', remember: false })

  return (
    <Dialog
      isOpen
      onClose={onCancel}
      title={t('pullDivergedTitle')}
      actions={
        <>
          <Button onClick={onCancel}>{t('cancel', { ns: 'common' })}</Button>
          <Button variant="primary" onClick={() => onConfirm(state.strategy, state.remember)}>
            {t('pull')}
          </Button>
        </>
      }
    >
      <p className="pull-strategy-description">{t('pullDivergedDescription')}</p>

      <div className="pull-strategy-options">
        <label
          className={`pull-strategy-option${state.strategy === 'rebase' ? ' selected' : ''}`}
          onClick={() => dispatch({ type: 'setStrategy', value: 'rebase' })}
        >
          <input
            type="radio"
            name="pullStrategy"
            checked={state.strategy === 'rebase'}
            onChange={() => dispatch({ type: 'setStrategy', value: 'rebase' })}
          />
          <div className="pull-strategy-option-text">
            <span className="pull-strategy-option-label">{t('pullStrategyRebase')}</span>
            <span className="pull-strategy-option-desc">{t('pullStrategyRebaseDesc')}</span>
          </div>
        </label>

        <label
          className={`pull-strategy-option${state.strategy === 'merge' ? ' selected' : ''}`}
          onClick={() => dispatch({ type: 'setStrategy', value: 'merge' })}
        >
          <input
            type="radio"
            name="pullStrategy"
            checked={state.strategy === 'merge'}
            onChange={() => dispatch({ type: 'setStrategy', value: 'merge' })}
          />
          <div className="pull-strategy-option-text">
            <span className="pull-strategy-option-label">{t('pullStrategyMerge')}</span>
            <span className="pull-strategy-option-desc">{t('pullStrategyMergeDesc')}</span>
          </div>
        </label>
      </div>

      <Checkbox
        checked={state.remember}
        onChange={() => dispatch({ type: 'toggleRemember' })}
        label={t('pullRememberChoice')}
        className="dialog-checkbox"
      />
    </Dialog>
  )
}
