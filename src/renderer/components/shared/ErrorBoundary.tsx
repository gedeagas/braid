import { Component, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'

type Scope = 'app' | 'panel'

interface Props {
  children: ReactNode
  /**
   * 'panel' renders a compact fallback that fills its slot so the rest of the
   * window keeps working. 'app' (default) is the last-resort full-window fallback.
   */
  scope?: Scope
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Braid] React error boundary caught:', error, info.componentStack)
  }

  private reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} scope={this.props.scope ?? 'app'} onReset={this.reset} />
    }
    return this.props.children
  }
}

function ErrorFallback({ error, scope, onReset }: { error: Error; scope: Scope; onReset: () => void }) {
  const { t } = useTranslation('common')
  const report = `${error.name}: ${error.message}\n\n${error.stack ?? ''}`
  const { copied, handleCopy } = useCopyToClipboard(report)

  return (
    <div className={`error-boundary error-boundary--${scope}`} role="alert">
      <div className="error-boundary__body">
        <h2 className="error-boundary__title">
          {t(scope === 'panel' ? 'errorBoundary.panelTitle' : 'errorBoundary.appTitle')}
        </h2>
        <p className="error-boundary__description">
          {t(scope === 'panel' ? 'errorBoundary.panelDescription' : 'errorBoundary.appDescription')}
        </p>
        <code className="error-boundary__message">{error.message}</code>
        {error.stack && (
          <details className="error-boundary__details">
            <summary>{t('errorBoundary.details')}</summary>
            <pre>{error.stack}</pre>
          </details>
        )}
        <div className="error-boundary__actions">
          <Button variant="primary" onClick={onReset}>{t('errorBoundary.tryAgain')}</Button>
          <Button onClick={handleCopy}>{copied ? t('copied') : t('errorBoundary.copyError')}</Button>
          <Button onClick={() => window.location.reload()}>{t('errorBoundary.reload')}</Button>
        </div>
      </div>
    </div>
  )
}
