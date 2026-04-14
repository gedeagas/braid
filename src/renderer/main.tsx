import './lib/i18n'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'

// Suppress react-virtuoso "Zero-sized element" warnings that fire when the
// chat panel is hidden (e.g. Mission Control or web app active). Harmless —
// Virtuoso works fine at zero size, it just logs noise.
const _warn = console.warn
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('Zero-sized element')) return
  _warn.apply(console, args)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
