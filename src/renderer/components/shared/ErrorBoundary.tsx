import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
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

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 32,
            color: '#f85149',
            background: '#0d1117',
            height: '100%',
            fontFamily: 'monospace',
            fontSize: 13,
            whiteSpace: 'pre-wrap',
            overflow: 'auto'
          }}
        >
          <h2 style={{ marginBottom: 16 }}>Something went wrong</h2>
          <div style={{ color: '#e6edf3', marginBottom: 8 }}>{this.state.error.message}</div>
          <div style={{ color: '#8b949e', fontSize: 11 }}>{this.state.error.stack}</div>
          <button
            style={{
              marginTop: 16,
              padding: '8px 16px',
              background: '#58a6ff',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer'
            }}
            onClick={() => this.setState({ error: null })}
          >
            Try Again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
